// Fauna Hunt -- the in-sim data source.
//
// Replaces the helper program that used to run beside the sim. A WebAssembly
// module inside the sim finds the animals and hands over their raw positions;
// everything else -- grouping into herds, looking up species, working out
// distances and where the player is looking -- happens here.
//
// This deliberately produces the SAME snapshot the helper's /contacts endpoint
// produced, field for field. Everything downstream in the panel then works
// untouched, and swapping data sources cannot change how the game plays.
//
// The helper program it replaced has been removed, so this is the only source
// of contacts. Its output still matches the shape the helper produced, because
// the rest of the panel was written against that and there is no reason to
// churn it.

const INSIM_EVENT_POLL = "FaunaHunt.Poll";
const INSIM_EVENT_DATA = "FaunaHunt.Data";

// EARTH_RADIUS_M and haversineM are NOT defined here on purpose. FaunaHunt.js
// already declares both at the top level of the same global scope, and a second
// `const` of the same name is a syntax error that kills the whole panel rather
// than one feature. They are used below and resolve at call time, so the load
// order in FaunaHunt.html is not load-bearing.
const HERD_RADIUS_M = 250.0;
const GRID_DEGREES = 0.005;
const VIEW_CONE_FRACTION = 0.5;
const EAGLE_TITLE = "Asobo PassiveAircraft Eagle";
const EAGLE_SPECIES = {
	common: "Golden Eagle", scientific: "Aquila chrysaetos",
	size: "small", tier: "rare", points: 200, rank: 4,
	region: "Global", group: "Golden Eagle",
};

// The sim answers with at most 250 objects per request.
const RESPONSE_CAP = 250;

// The panel has no field-of-view reading of its own, so it assumes a normal
// one. The helper could ask the sim directly; this is the one number the
// in-sim path estimates rather than measures.
const ASSUMED_FOV_DEG = 90;

// ------------------------------------------------------------------- maths
// Ports of the helper's helpers. Kept identical, including the rounding, so
// the two sources cannot drift apart in ways that only show up in play.

function bearingDeg(lat1, lon1, lat2, lon2) {
	const p1 = lat1 * Math.PI / 180, p2 = lat2 * Math.PI / 180;
	const dl = (lon2 - lon1) * Math.PI / 180;
	const y = Math.sin(dl) * Math.cos(p2);
	const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
	return (Math.atan2(y, x) * 180 / Math.PI + 360.0) % 360.0;
}

// Done in 3D, not on the compass alone: from 1000 ft an animal can be dead
// ahead and still 40 degrees below the nose, and someone staring at the sky
// should not be capturing it.
function angleBetween(viewHeading, viewPitch, targetBearing, targetElevation) {
	const r = Math.PI / 180;
	const vh = viewHeading * r, vp = viewPitch * r;
	const th = targetBearing * r, tp = targetElevation * r;
	const vx = Math.cos(vp) * Math.cos(vh);
	const vy = Math.cos(vp) * Math.sin(vh);
	const vz = Math.sin(vp);
	const tx = Math.cos(tp) * Math.cos(th);
	const ty = Math.cos(tp) * Math.sin(th);
	const tz = Math.sin(tp);
	const dot = Math.max(-1, Math.min(1, vx * tx + vy * ty + vz * tz));
	return Math.acos(dot) * 180 / Math.PI;
}

function clockPosition(relativeBearing) {
	const hour = Math.round(relativeBearing / 30.0) % 12;
	return hour === 0 ? 12 : hour;
}

function round(value, places) {
	const f = Math.pow(10, places);
	return Math.round(value * f) / f;
}

// -------------------------------------------------------------- view angle
//
// The "are you looking at it" rule is decided by ONE reading: the gameplay
// pitch/yaw variables, in a 2D cockpit view. They are correct there, covering
// mouse look, the built-in views and joystick-mapped views alike.
//
// Everywhere else the rule is switched OFF rather than replaced:
//
//   * IN VR, because the sim does not tell add-ons where the player's head is
//     pointing. Every reading available -- these variables, and the camera call
//     at all five of its reference points -- reports the AIRCRAFT. Proven by
//     turning the helicopter 90 degrees while looking at the same animals
//     throughout: the answer moved with the nose and ignored the head. Gating
//     on the nose would mean flying AT an animal to identify it, which is not
//     the game.
//   * In external and drone views, because there is no reading at all.
//
// A rule the player cannot see, steering by the wrong thing, is worse than no
// rule. So when we cannot tell where they are looking, we do not pretend to.

const CAMERA_STATE_COCKPIT = 2;

// Whether the player is in a headset. The gameplay pitch/yaw variables are
// perfect in 2D and useless in VR, so this decides which reading to trust
// rather than guessing from the numbers themselves.
let inVrMode = false;
try {
	if (typeof Coherent !== "undefined" && Coherent.on) {
		Coherent.on("SwitchVRModeState", (state) => { inVrMode = !!state; });
	}
} catch (err) {
	/* no VR signal available; 2D behaviour is the safe default */
}

// Where the aircraft is. Read HERE, in the panel, rather than asked of the
// module.
//
// The module used to ask the sim for the user's own position alongside the
// animals, and that request never came back -- the panel sat on "waiting for
// your aircraft's position" while animals were plainly in view. The animal
// request through the same call works, so whatever the cause, it is specific
// to asking for the user that way.
//
// There was never any need to. These are ordinary variables and the panel can
// read them itself, with no round trip and nothing in between to fail.
function readAircraft() {
	try {
		const lat = SimVar.GetSimVarValue("PLANE LATITUDE", "degrees");
		const lon = SimVar.GetSimVarValue("PLANE LONGITUDE", "degrees");
		const alt = SimVar.GetSimVarValue("PLANE ALTITUDE", "feet");
		const hdg = SimVar.GetSimVarValue("PLANE HEADING DEGREES TRUE", "degrees");
		const gs = SimVar.GetSimVarValue("GROUND VELOCITY", "knots");
		if (typeof lat !== "number" || typeof lon !== "number") return null;
		if (!isFinite(lat) || !isFinite(lon)) return null;
		if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
		// 0,0 is in the Atlantic: the flight has not loaded yet.
		if (Math.abs(lat) < 1e-6 && Math.abs(lon) < 1e-6) return null;
		return {
			lat: lat, lon: lon,
			alt_ft: (typeof alt === "number" && isFinite(alt)) ? alt : 0,
			hdg: (typeof hdg === "number" && isFinite(hdg)) ? hdg : 0,
			gs_kt: (typeof gs === "number" && isFinite(gs)) ? gs : 0,
		};
	} catch (err) {
		return null;
	}
}

function readView(aircraftHeading) {
	let state = 0;
	let pitch = 0;
	let yaw = 0;
	try {
		state = SimVar.GetSimVarValue("CAMERA STATE", "number");
		pitch = SimVar.GetSimVarValue("CAMERA GAMEPLAY PITCH YAW:0", "degree");
		yaw = SimVar.GetSimVarValue("CAMERA GAMEPLAY PITCH YAW:1", "degree");
	} catch (err) {
		return null;
	}
	if (state !== CAMERA_STATE_COCKPIT) return null;
	if (typeof aircraftHeading !== "number") return null;
	return {
		heading: (aircraftHeading - yaw + 360.0) % 360.0,
		pitch: pitch,
		source: "variables",
		cameraState: state,
	};
}

// ------------------------------------------------------------------ source

class FaunaInSimSource {
	constructor(speciesData) {
		this.table = speciesData || null;
		this.bus = null;
		this.busReady = false;
		this.pending = [];        // chunks of the reply being assembled
		this.snapshot = null;
		this.lastReplyAt = 0;
		this.everReplied = false;
		this.replies = 0;
		this.lastRowCount = 0;
		this.lastError = null;
		this.attached = false;
		this.polls = 0;
		this.callError = null;
		// null means "ask the sim". The tests set it directly so both modes
		// can be exercised without a headset.
		this.vr = null;
	}

	get available() {
		// One clean reply is the bar. Until then the panel keeps using the
		// helper, so a sim without the module never loses its game.
		return this.everReplied;
	}

	start() {
		if (typeof RegisterCommBusListener !== "function") return false;
		const attach = () => {
			if (this.attached || !this.bus) return;
			try {
				this.bus.on(INSIM_EVENT_DATA, (payload) => this.onData(payload));
				this.attached = true;
			} catch (err) {
				/* try again on the next poll */
			}
		};
		try {
			// The "ready" callback fires when the listener first connects. Close
			// and reopen the panel and it may never fire again, because the
			// connection is already up -- which left a reopened panel waiting
			// for the simulator forever with animals in plain view.
			//
			// So the handler is attached immediately as well, and polling does
			// not wait for a signal that may already have been and gone.
			this.bus = RegisterCommBusListener(() => {
				this.busReady = true;
				attach();
			});
		} catch (err) {
			this.bus = null;
			return false;
		}
		attach();
		return true;
	}

	poll() {
		if (!this.bus) return;
		// Deliberately NOT gated on the ready signal -- see start(). Asking
		// early is harmless; waiting for a signal that has already fired is
		// not.
		if (!this.attached) this.attach();
		try {
			this.bus.callWasm(INSIM_EVENT_POLL, "{}");
			this.polls++;
			this.callError = null;
		} catch (err) {
			// Counted rather than swallowed: "the panel stopped asking" and
			// "the module stopped answering" need opposite fixes, and they
			// look identical from the outside.
			this.callError = String(err);
		}
	}

	// Re-attaching is safe and idempotent; start() sets this up too.
	attach() {
		if (this.attached || !this.bus) return;
		try {
			this.bus.on(INSIM_EVENT_DATA, (payload) => this.onData(payload));
			this.attached = true;
		} catch (err) {
			/* try again next poll */
		}
	}

	onData(payload) {
		let msg;
		try {
			msg = typeof payload === "string" ? JSON.parse(payload) : payload;
		} catch (err) {
			this.pending = [];
			return;
		}
		if (!msg) return;

		// A reply arrives in as many messages as it takes. Out-of-order or
		// missing pieces mean a torn reply, so it is dropped rather than shown
		// half-complete -- the next poll is only a second away.
		if (msg.seq === 0) this.pending = [];
		if (msg.seq !== this.pending.length) {
			this.pending = [];
			if (msg.seq !== 0) return;
		}
		this.pending.push(msg);
		if (!msg.last) return;

		const rows = [];
		this.pending.forEach((part) => {
			(part.rows || []).forEach((r) => rows.push(r));
		});
		const head = this.pending[this.pending.length - 1];
		this.pending = [];
		this.everReplied = true;
		this.replies++;
		this.lastRowCount = rows.length;
		this.lastError = head.error || null;
		this.lastReplyAt = Date.now();
		this.snapshot = this.build(head, rows);
	}

	// ------------------------------------------------------- snapshot build

	resolve(title) {
		if (!this.table) return null;
		if (title === EAGLE_TITLE) return { root: "Eagle", info: EAGLE_SPECIES };
		const root = this.table.title_to_species[title];
		if (root === undefined) return null;   // people, dinosaurs, AnimalError
		return { root: root, info: this.table.species[root] };
	}

	sexOf(root, title) {
		const info = this.table && this.table.species[root];
		const variants = (info && info.variants) || [];
		for (let i = 0; i < variants.length; i++) {
			if (variants[i].title === title) return variants[i].sex;
		}
		return "unknown";
	}

	build(head, rows) {
		const user = readAircraft() || (head.haveUser ? head.user : null);
		const stats = { raw_returned: 0, individuals: 0, contacts: 0,
			capped: false, rejected: {} };

		if (!user || !this.table) {
			return {
				connected: true,
				status: this.table ? "waiting for the simulator" : "no species table",
				user: user, contacts: [], stats: stats, updated: Date.now() / 1000,
				view_cone_deg: null, fov_deg: null, source: "insim",
				module: {
					polls: this.polls,
					replies: this.replies,
					rows: this.lastRowCount,
					error: this.lastError || this.callError || null,
				},
			};
		}

		const kept = [];
		let streamingIn = 0;
		let notHuntable = 0;

		rows.forEach((row) => {
			const title = row[0], lat = row[1], lon = row[2], alt = row[3];
			// Still streaming in: the real position has not arrived, and the
			// animal would otherwise read as a contact 6000 km away.
			if (Math.abs(lat) < 1e-4 && Math.abs(lon) < 1e-4) { streamingIn++; return; }
			const hit = this.resolve(title);
			if (!hit) { notHuntable++; return; }
			kept.push({ title: title, root: hit.root, info: hit.info,
				lat: lat, lon: lon, alt_ft: alt });
		});

		stats.raw_returned = kept.length;
		stats.rejected = { streaming_in: streamingIn, not_huntable: notHuntable };
		// At the cap we are seeing an arbitrary subset, so the panel must never
		// claim the area holds nothing else.
		stats.capped = (head.returned || 0) >= RESPONSE_CAP;

		// In 2D the gameplay variables are known good -- mouse look, built-in
		// views and joystick-mapped views all tracked correctly. In VR they
		// report the aircraft's direction and ignore the head entirely, so the
		// module's camera is the only usable reading there.
		//
		// Preferring the module everywhere broke 2D in 1.3.1, so the choice is
		// made by which mode the player is in, not by which reading exists.
		const varView = readView(user.hdg);
		const vr = (this.vr === null || this.vr === undefined) ? inVrMode : this.vr;
		// IN VR THERE IS NO VIEW RULE. The sim does not tell add-ons where the
		// player's head is pointing -- every reading available, from the
		// gameplay variables to the camera call at all five of its reference
		// points, reports the AIRCRAFT. Proven by turning the helicopter 90
		// degrees while looking at the same animals throughout: the answer
		// moved with the nose and ignored the head.
		//
		// Gating on the nose instead would mean flying at an animal to
		// identify it, which is not the game -- the whole point is looking out
		// of the window. So in VR the rule is switched off rather than
		// silently replaced with a different one.
		// ONE reading is ever allowed to gate: the 2D cockpit variables. The
		// module's camera is kept for the readout but never steers the rule,
		// because it reports the aircraft rather than the player -- and an
		// external or drone view has no reading at all. In every case where we
		// cannot tell where the player is looking, the rule is switched off
		// rather than replaced by a different one they cannot see.
		const view = vr ? null : varView;
		const fovDeg = (view && view.fov) || ASSUMED_FOV_DEG;

		this.viewDebug = { using: view ? (view.source || "variables") : "none" };

		const byRoot = {};
		kept.forEach((m) => {
			(byRoot[m.root] = byRoot[m.root] || []).push(m);
		});

		const contacts = [];
		Object.keys(byRoot).forEach((root) => {
			this.cluster(byRoot[root]).forEach((herd) => {
				contacts.push(this.describe(root, herd, user, view));
			});
		});
		contacts.sort((a, b) => a.distance_m - b.distance_m);

		stats.contacts = contacts.length;
		stats.individuals = contacts.reduce((n, c) => n + c.count, 0);

		return {
			connected: true,
			status: "connected",
			module: {
				polls: this.polls,
				replies: this.replies,
				rows: this.lastRowCount,
				error: this.lastError || this.callError || null,
			},
			// Half the field of view is the cone that counts as looking at
			// something. Measured when the module gives us one -- so it adapts
			// between 2D and VR on its own -- and assumed otherwise.
			view_cone_deg: round(fovDeg * VIEW_CONE_FRACTION, 1),
			fov_deg: round(fovDeg, 1),
			user: user,
			contacts: contacts,
			stats: stats,
			updated: Date.now() / 1000,
			source: "insim",
			view_debug: this.viewDebug || null,
		};
	}

	// Greedy clustering -- fine at these counts, and herds are compact.
	cluster(members) {
		const remaining = members.slice();
		const clusters = [];
		while (remaining.length) {
			const seed = remaining.pop();
			const herd = [seed];
			const still = [];
			for (let i = 0; i < remaining.length; i++) {
				const other = remaining[i];
				if (haversineM(seed.lat, seed.lon, other.lat, other.lon) <= HERD_RADIUS_M) {
					herd.push(other);
				} else {
					still.push(other);
				}
			}
			remaining.length = 0;
			Array.prototype.push.apply(remaining, still);
			clusters.push(herd);
		}
		return clusters;
	}

	describe(root, herd, user, view) {
		let lat = 0, lon = 0, alt = 0;
		herd.forEach((m) => { lat += m.lat; lon += m.lon; alt += m.alt_ft; });
		lat /= herd.length; lon /= herd.length; alt /= herd.length;
		const info = herd[0].info;

		const distance = haversineM(user.lat, user.lon, lat, lon);
		// Capture is judged on the CLOSEST animal, not the middle of the herd:
		// a scattered group can have its centre 400 m away while one animal is
		// right under the wing, and that is the one you flew down to see.
		let nearest = Infinity;
		herd.forEach((m) => {
			const d = haversineM(user.lat, user.lon, m.lat, m.lon);
			if (d < nearest) nearest = d;
		});
		const bearing = bearingDeg(user.lat, user.lon, lat, lon);
		const relative = (bearing - user.hdg + 360.0) % 360.0;

		const sexes = {};
		herd.forEach((m) => {
			const sex = root === "Eagle" ? "unknown" : this.sexOf(root, m.title);
			sexes[sex] = (sexes[sex] || 0) + 1;
		});

		// How far the animal is from where the player is looking. Null when we
		// cannot tell -- outside the cockpit, say -- and the panel must then
		// let everything through rather than locking the player out.
		let offView = null;
		if (view) {
			const dropM = (user.alt_ft - alt) * 0.3048;
			const elevation = -Math.atan2(dropM, Math.max(1.0, nearest)) * 180 / Math.PI;
			offView = round(angleBetween(view.heading, view.pitch, bearing, elevation), 1);
		}

		const gLat = Math.round(lat / GRID_DEGREES) * GRID_DEGREES;
		const gLon = Math.round(lon / GRID_DEGREES) * GRID_DEGREES;

		return {
			// Stable across the sim's object-id churn: species plus a coarse
			// position grid. This is what the lifelist dedupes on.
			key: root + "@" + gLat.toFixed(3) + "," + gLon.toFixed(3),
			species: root,
			common: info.common,
			scientific: info.scientific,
			size: info.size,
			tier: info.tier !== undefined ? info.tier : "common",
			points: info.points !== undefined ? info.points : 20,
			rank: info.rank !== undefined ? info.rank : 2,
			group: info.group !== undefined ? info.group : (info.common || ""),
			region: info.region,
			count: herd.length,
			sexes: sexes,
			lat: round(lat, 6),
			lon: round(lon, 6),
			alt_ft: round(alt, 1),
			distance_m: round(distance, 1),
			nearest_m: round(nearest, 1),
			off_view_deg: offView,
			bearing_deg: round(bearing, 1),
			relative_bearing_deg: round(relative, 1),
			clock: clockPosition(relative),
			above: alt > user.alt_ft + 100,
		};
	}
}

// ONE source per session, not one per panel.
//
// The sim tears the panel's element down and builds it again -- opening the
// toolbar menu is enough. Each rebuild used to create a fresh connection to
// the module and start its counters from zero, so the panel could never get
// past the first exchange and there was no way to tell that from the module
// having died.
//
// Keeping it here means a rebuilt panel picks up the connection that is
// already working, along with everything it has already received.
function faunaInSimSource(speciesData) {
	if (!window.__faunaInSimSource) {
		const source = new FaunaInSimSource(speciesData);
		if (!source.start()) return null;
		window.__faunaInSimSource = source;
	}
	return window.__faunaInSimSource;
}

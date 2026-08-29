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
// If you change a rule here, change it in Service/fauna_service.py too, or the
// two sources will quietly disagree. That is the cost of keeping the helper
// working as a fallback, and it is worth paying until the in-sim path has been
// flown enough to trust.

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
// TWO sources, because neither covers both cases.
//
// 1. The module's camera reading. Used IN VR, where it is the only reading
//    that can follow the headset.
// 2. The gameplay pitch/yaw variables. These track the 2D camera perfectly,
//    including custom and joystick-mapped views. But IN VR THEY ARE USELESS:
//    tested in a headset, they report the aircraft's direction and take no
//    notice of where the player's head is pointing. Fallback only.
//
// Which one is used is decided by the MODE, not by which happens to be
// available. 1.3.1 preferred the module's camera everywhere and broke 2D --
// animals at 200 m dead ahead could not be identified. Getting this wrong is
// worse than a crash: the "look at the animal" rule silently judges the wrong
// direction, and the game just feels random.

const CAMERA_STATE_COCKPIT = 2;

// The field of view is the only value that arrives in radians.
const RADIANS_IF_FOV_BELOW = 6.3;

// What the camera reports, measured in the sim rather than assumed. Two
// surprises, both of which produced nonsense while they were being guessed at:
//
//   * The field of view is in RADIANS but the angles are in DEGREES. Reading
//     all three as one unit turned a 23 degree pitch into 1341, and geometry
//     built on that is meaningless -- which is why VR behaved randomly rather
//     than merely being offset.
//   * The heading is measured FROM THE NOSE even though the reading claims to
//     be world-referenced. So the referential it reports cannot be trusted,
//     and is deliberately ignored.
//
// Both were settled by taking a 2D reading beside the known-good one: aircraft
// on 331.6, view on 331.6, camera reporting 0.31. That is straight ahead in
// degrees and nothing else.
function readModuleView(cam, aircraftHeading) {
	if (!cam || !cam.ok) return null;
	if (typeof cam.fov !== "number" || cam.fov <= 0) return null;
	if (typeof aircraftHeading !== "number") return null;

	const fov = cam.fov <= RADIANS_IF_FOV_BELOW ? cam.fov * 180 / Math.PI : cam.fov;
	// An absurd field of view means the reading is not what we think it is,
	// and a wrong view direction is worse than none.
	if (fov < 20 || fov > 170) return null;
	// Degrees, so these stay small. Anything larger means the same thing.
	if (Math.abs(cam.p) > 180 || Math.abs(cam.h) > 360) return null;

	return {
		heading: (((aircraftHeading + cam.h) % 360) + 360) % 360,
		// Positive reads as nose-down, matching the sim's own convention for
		// aircraft pitch, so it is flipped to the "positive is up" this file
		// works in. UNCONFIRMED: needs a reading taken while looking clearly
		// down at the ground.
		pitch: -cam.p,
		fov: fov,
		source: "module",
		rotRef: cam.rotRef,
	};
}

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
		try {
			this.bus = RegisterCommBusListener(() => {
				this.busReady = true;
				this.bus.on(INSIM_EVENT_DATA, (payload) => this.onData(payload));
			});
		} catch (err) {
			this.bus = null;
			return false;
		}
		return true;
	}

	poll() {
		if (!this.busReady || !this.bus) return;
		try {
			this.bus.callWasm(INSIM_EVENT_POLL, "{}");
		} catch (err) {
			/* the module may not be loaded; the panel falls back on its own */
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
		const user = head.haveUser ? head.user : null;
		const stats = { raw_returned: 0, individuals: 0, contacts: 0,
			capped: false, rejected: {} };

		if (!user || !this.table) {
			return {
				connected: true,
				status: this.table ? "waiting for the simulator" : "no species table",
				user: user, contacts: [], stats: stats, updated: Date.now() / 1000,
				view_cone_deg: null, fov_deg: null, source: "insim",
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
		const moduleView = readModuleView(head.cam, user.hdg);
		const varView = readView(user.hdg);
		const vr = (this.vr === null || this.vr === undefined) ? inVrMode : this.vr;
		const view = vr ? (moduleView || varView) : (varView || moduleView);
		const fovDeg = (view && view.fov) || ASSUMED_FOV_DEG;

		// Kept so the panel can show what it is actually steering by. Working
		// this out by guessing has cost two flights already.
		this.viewDebug = {
			vr: vr,
			using: view ? (view.source || "variables") : "none",
			cam: head.cam || null,
			refs: head.refs || null,
			viewHeading: view ? round(view.heading, 1) : null,
			viewPitch: view ? round(view.pitch, 1) : null,
			aircraftHeading: round(user.hdg, 1),
			fov: round(fovDeg, 1),
		};
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

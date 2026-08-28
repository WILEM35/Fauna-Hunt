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
// 1. The module's camera reading. This is the one that works IN VR -- it
//    follows the headset. Preferred whenever it is available.
// 2. The gameplay pitch/yaw variables. These track the 2D camera perfectly,
//    including custom and joystick-mapped views. But IN VR THEY ARE USELESS:
//    tested in a headset, they report the aircraft's direction and take no
//    notice of where the player's head is pointing. Fallback only.
//
// Getting this wrong is not a crash, it is worse -- the "look at the animal"
// rule silently starts judging the wrong direction, which in VR meant you had
// to point the aeroplane at an animal to identify it.

const CAMERA_STATE_COCKPIT = 2;

// The camera call reports raw numbers and the SDK does not say in what units.
// The field of view settles it for all three: no sane view is 60 RADIANS wide,
// and no sane one is 1 DEGREE wide, so a small value means the set is radians.
const RADIANS_IF_FOV_BELOW = 6.3;

function readModuleView(cam) {
	if (!cam || !cam.ok) return null;
	if (typeof cam.fov !== "number" || cam.fov <= 0) return null;
	const toDeg = cam.fov <= RADIANS_IF_FOV_BELOW ? (180 / Math.PI) : 1;
	const fov = cam.fov * toDeg;
	// A camera claiming an absurd field of view means the reading is not what
	// we think it is, and a wrong view direction is worse than none.
	if (fov < 20 || fov > 170) return null;
	return {
		heading: ((cam.h * toDeg) % 360 + 360) % 360,
		pitch: cam.p * toDeg,
		fov: fov,
	};
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

		// The module's camera first -- it is the only one that follows a VR
		// headset. The variables are the fallback for 2D.
		const view = readModuleView(head.cam) || readView(user.hdg);
		const fovDeg = (view && view.fov) || ASSUMED_FOV_DEG;
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

// Fauna Hunt
//
// A wildlife-spotting game. The sim has 107 species of animal wandering
// around; this panel turns finding them into the point of the flight.
//
// It deliberately does NOT tell you where the animals are. Developer mode can
// already do that, and it removes the game. Instead the panel behaves like a
// spotter calling contacts over the intercom: a compass sector at long range,
// sharpening to an o'clock position up close, and never naming the species.
// Working out what you are looking at is your job.
//
// Positions arrive from the in-sim module exactly; ALL of the vagueness
// is applied here, in describeContact(). That means difficulty can be retuned
// by editing this file alone -- the service and the sim never need to change.

// Rewritten by build.ps1 from the package version, so it cannot drift.
// Shown in Settings: without it there is no way to tell which build is
// actually running, and a stale one looks exactly like a bug that will not die.
const PANEL_VERSION = "2.2.0";

const STORAGE_KEY = "FaunaHunt_State_v1";
const POLL_INTERVAL_MS = 1000;

// How close you have to be before a contact can be identified at all.
const IDENTIFY_RANGE_M = 1200;
// Backing out of an identification costs points: by then you have seen the
// four-way shortlist, so you could go and look again already knowing the
// answer is one of four. The shortlist and any wrong guesses are kept, so
// backing out cannot be used to re-roll an easier set of options.
const CANCEL_PENALTY = 5;
// How long a one-off message in the spot bar survives before the poll
// loop is allowed to replace it with the standing prompt.
const HINT_HOLD_MS = 6000;
// How long the contact list stops reordering after you touch it. Long enough
// to look up at the window, find the animal and tap the right row.
const LIST_HOLD_MS = 4000;
// How long a hover is believed without further sign of the pointer. VR
// pointers jitter constantly, so this only expires once the pointer has
// genuinely gone -- or has stopped telling us it is there.
const POINTER_STUCK_MS = 2500;

// How the contact list is ordered. In a helicopter anything is reachable, so
// nearest is right. In an aeroplane a contact behind you means a circuit, and
// by the time you are back the herd has moved -- so "ahead" lifts the
// 180-degree arc in front of the nose to the top. It SORTS rather than hides:
// something legendary behind you should never silently disappear.
const SORT_MODES = {
	near:  { label: "Nearest", blurb: "closest first" },
	ahead: { label: "Ahead",   blurb: "what you can fly at without turning" },
};
const DEFAULT_SORT = "near";

// The radar. A circular view at the top of the Hunt tab: you in the middle,
// nose up, each herd a smudge. Asked for so that a big group pulls the eye and
// a stray pair in an odd direction does not.
//
// It is drawn to EXACTLY the precision the words carry and no further. Bearing
// is quantised to the same step as the text for that tier, and each contact is
// spread across its whole distance bracket rather than marked at a point. A dot
// at the true position would be a map, and the game is built on not having one.
//
// Herd size is the one place the radar could say more than the text, because at
// long range the text withholds the count completely. So size is bucketed --
// on its own, a few, a lot -- which is enough to steer by and still not a
// number you could count on.
const RADAR_MODES = {
	off:   { label: "Off",   em: 0 },
	small: { label: "Small", em: 8.5 },
	large: { label: "Large", em: 13 },
};
const DEFAULT_RADAR = "small";

// Bearing precision per tier, matched to the words in describeContact(). If
// one of those steps ever changes, change it here too -- an arrow or a smudge
// finer than the sentence beside it is a leak.
const RADAR_STEPS = { sector: 45, coarse: 30, fine: 10, close: 30 };

// Smudge radius, as a fraction of the largest, by herd size.
const RADAR_BUCKETS = [
	{ upTo: 2, scale: 0.4 },
	{ upTo: 9, scale: 0.68 },
	{ upTo: Infinity, scale: 1 },
];
const RADAR_BLOB_MAX = 19;   // viewBox units
// The sim's stored data is not always readable the instant a panel opens.
// Keep looking for this long before concluding that nothing is saved.
const LOAD_RETRIES = 12;
const LOAD_RETRY_MS = 500;
// A contact's key includes its herd's averaged position, which drifts as
// individuals stream in and out -- so the same herd can cross a grid boundary
// and come back as a "new" contact the panel has never seen. Matching a logged
// sighting by species and proximity instead of by key exactly makes the
// identified state stick to the animals rather than to a string.
const LOGGED_MATCH_M = 500;
const EARTH_RADIUS_M = 6371000;

// Range tiers, in metres. Tuned against the real streaming behaviour: fauna
// appears within ~2.8 km on the deck but out to ~30 km at altitude, so the
// tiers have to cover a wide span. Each difficulty scales every threshold.
const TIERS = { close: 1000, fine: 3000, coarse: 8000 };

const DIFFICULTIES = {
	explorer: {
		label: "Explorer",
		scale: 1.6,          // tiers push outward -- detail arrives sooner
		scoreMult: 0.75,
		blurb: "Detail arrives early and bearings stay tight. Good for learning what a distant giraffe actually looks like.",
	},
	tracker: {
		label: "Tracker",
		scale: 1.0,
		scoreMult: 1.0,
		blurb: "The intended balance. Sector only at long range, an o'clock position once you are close.",
	},
	expert: {
		label: "Expert",
		scale: 0.45,         // tiers pull in -- you stay in the dark far longer
		scoreMult: 1.5,
		blurb: "Sector only until you are almost on top of it. No herd counts, no size class.",
	},
};

// Text size. "m" is the baseline that reads correctly in both 2D and VR --
// matched to the Flight Data Tiles panel. The others step around it.
const TEXT_SIZES = {
	xs: { label: "XS", base: 18 },
	s: { label: "S", base: 21 },
	m: { label: "M", base: 25 },
	l: { label: "L", base: 30 },
	xl: { label: "XL", base: 36 },
};
const DEFAULT_TEXT_SIZE = "m";

// How opaque the panel's own background is. The sim gives the window no
// background at all, so at low values the world behind bleeds through the
// text -- which is what made it unreadable in VR. "Slight" is the floor
// worth shipping; "Clear" is offered for anyone who wants the view back.
// The sim paints no background behind the panel at all, so this value is the
// only thing between the text and the world. 0.82 barely reads as transparent
// -- the range has to go a lot further down to be worth having. As it does,
// `shadow` fades a dark halo in behind the text so it stays legible over a
// bright sky instead of dissolving into it.
const BACKGROUNDS = {
	solid:  { label: "Solid",  opacity: 1,    halo: "transparent" },
	tinted: { label: "Tinted", opacity: 0.86, halo: "rgba(0, 0, 0, 0.4)" },
	clear:  { label: "Clear",  opacity: 0.62, halo: "rgba(0, 0, 0, 0.75)" },
	ghost:  { label: "Ghost",  opacity: 0.34, halo: "rgba(0, 0, 0, 0.95)" },
};
const DEFAULT_BACKGROUND = "tinted";

// Whether a species you have already identified is recognised on sight
// anywhere, or has to be worked out afresh at every new herd.
const RECOGNITION = {
	ask: {
		label: "Ask every time",
		blurb: "Every herd is its own puzzle. A species you know still has to be "
			+ "identified again somewhere new, and still scores.",
	},
	sight: {
		label: "Recognise on sight",
		blurb: "A species you have identified is named the moment it appears, "
			+ "anywhere. Those tiles cannot be identified again and score "
			+ "nothing — you are choosing to hunt only what is new.",
	},
};
const DEFAULT_RECOGNITION = "ask";

// Identifying is half the game. Getting close enough to capture is the other
// half, and it is what pulls people down to the deck where the sim looks best
// and the flying is interesting.
const CAPTURE_RANGE_M = 150;
// If the sim gives us no camera, everything passes. Never lock someone out of
// their own game because a reading failed.
const DEFAULT_VIEW_CONE_DEG = 45;
// A capture is worth the identification again, so a captured animal is double.
const CAPTURE_MULTIPLIER = 1.0;

// Points come from the species table now, not a table in here -- see
// probe/apply_rarity.py. Fallback only, for a table that predates tiers.
const TIER_POINTS = { everyday: 5, common: 20, regional: 60, rare: 200, legendary: 600 };
const TIER_LABEL = { everyday: "everyday", common: "common", regional: "regional",
	rare: "rare", legendary: "legendary" };
// Identifying it first go is worth far more than grinding down the shortlist.
const TRY_MULTIPLIER = [1.0, 0.5, 0.25, 0.1];
// Seeing a species you already have is worth something, but not much.
const REPEAT_MULT = 0.25;
// Only the eight legendary animals raise an alert. Anything commoner
// fires often enough to become wallpaper.
const ALERT_TIER = "legendary";

const SECTORS = ["north", "north-east", "east", "south-east",
	"south", "south-west", "west", "north-west"];

const SIZE_WORDS = {
	huge: "very large animal",
	large: "large animal",
	medium: "medium-sized animal",
	small: "small animal",
};

const REGION_ORDER = ["Global", "Europe", "Africa", "Asia", "N.America",
	"S.America", "Arctic", "Australia", "Ocean"];

// ------------------------------------------------------------- utilities


// A small arrow pointing where the animal is, relative to the nose.
//
// Quantised to the SAME step as the words beside it, always. The whole design
// rests on not marking the animal exactly, and an arrow drawn from the true
// bearing would quietly hand back the precision the text withholds -- at long
// range it would stop being a hint and become a marker. Coarse words, coarse
// arrow: it is the same information, just faster to read at a glance in VR.
//
// Drawn rather than written: a glyph would depend on the sim's font having it,
// and the sim's font is missing more than you would expect.
function directionArrow(relativeBearing, step) {
	const deg = quantise(relativeBearing, step) % 360;
	return "<svg class=\"dir-arrow\" viewBox=\"0 0 12 12\" aria-hidden=\"true\" "
		+ "style=\"transform: rotate(" + deg + "deg)\">"
		+ "<path d=\"M6 0.8 L10.6 11.2 L6 8.4 L1.4 11.2 Z\"/></svg>";
}


function sectorOf(bearing) {
	return SECTORS[Math.round(bearing / 45) % 8];
}

function quantise(value, step) {
	return Math.round(value / step) * step;
}

function distanceBracket(metres) {
	if (metres < 1000) {
		const low = Math.floor(metres / 250) * 250;
		return low + " to " + (low + 250) + " m";
	}
	const km = metres / 1000;
	return Math.floor(km) + " to " + Math.ceil(km === Math.floor(km) ? km + 1 : km) + " km";
}

// The same brackets distanceBracket() puts into words, as numbers -- so a
// smudge on the radar covers precisely the span the sentence claims and never
// a metre less.
function distanceBand(metres) {
	if (metres < 1000) {
		const low = Math.floor(metres / 250) * 250;
		return [low, low + 250];
	}
	const km = Math.floor(metres / 1000);
	return [km * 1000, (km + 1) * 1000];
}

function radarBucket(count) {
	const n = count || 1;
	for (let i = 0; i < RADAR_BUCKETS.length; i++) {
		if (n <= RADAR_BUCKETS[i].upTo) return RADAR_BUCKETS[i].scale;
	}
	return 1;
}

function rangeLabel(metres) {
	if (metres < 1000) return Math.round(metres) + " m";
	const km = metres / 1000;
	return (km < 10 ? km.toFixed(1) : String(Math.round(km))) + " km";
}

function roundTo(value, step) {
	return Math.round(value / step) * step;
}

function plural(count, one, many) {
	return count === 1 ? one : many;
}

function shuffle(list) {
	const out = list.slice();
	for (let i = out.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		const swap = out[i];
		out[i] = out[j];
		out[j] = swap;
	}
	return out;
}

function haversineM(lat1, lon1, lat2, lon2) {
	const toRad = Math.PI / 180;
	const p1 = lat1 * toRad, p2 = lat2 * toRad;
	const dp = p2 - p1;
	const dl = (lon2 - lon1) * toRad;
	const a = Math.sin(dp / 2) * Math.sin(dp / 2)
		+ Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);
	return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

function todayIso() {
	return new Date().toISOString().slice(0, 10);
}


// --------------------------------------------------------------- element

class IngamePanelFaunaHunt extends TemplateElement {
	constructor() {
		super();
		this.state = {
			score: 0,
			difficulty: "tracker",
			textSize: DEFAULT_TEXT_SIZE,
			background: DEFAULT_BACKGROUND,
			recognition: DEFAULT_RECOGNITION,
			sortMode: DEFAULT_SORT,
			radar: DEFAULT_RADAR,
			lifelist: {},   // species root -> { first, lat, lon, best, count }
			logged: {},     // contact key -> {species, lat, lon} once identified
			captured: {},   // contact key -> true once you got close enough
			attempts: {},   // contact key -> { tries, wrong[], options[] } across back-outs
		};
		this.species = null;      // the full table, fetched once
		this.snapshot = null;     // latest /contacts payload
		this.online = false;
		this.status = null;
		this.view = "hunt";
		this.hintHeldUntil = 0;
		this.listHeldUntil = 0;
		this.pointerOverList = false;
		this.pointerSeenAt = 0;
		this.alertFor = null;
		this.rows = {};
		this.cappedNote = null;
		this.quiz = null;
		this.pollTimer = undefined;
		this.resetArmed = false;
		this.loaded = false;
		this.loadAttempts = 0;
		this.loadTimer = undefined;
		// The in-sim data source. Null until started, and ignored until it has
		// answered once -- so a sim without the module keeps playing on the
		// helper exactly as before.
		this.inSim = null;
	}

	connectedCallback() {
		super.connectedCallback();
		this.cacheNodes();
		this.loadState();
		this.bindEvents();
		this.renderDifficulty();
		this.renderTextSize();
		this.applyTextSize();
		this.renderBackground();
		this.applyBackground();
		this.renderRecognition();
		this.renderScore();
		this.renderSort();
		this.renderRadar();
		this.showVersion();
		this.startInSim();
		this.fetchSpecies();
		this.pollTimer = setInterval(() => this.poll(), POLL_INTERVAL_MS);
		this.poll();
		// If the timer stops for any reason, start it again. Cheap insurance
		// against a silent freeze, which is the worst failure to diagnose.
		this.watchdog = setInterval(() => {
			const ticks = this.pollTicks || 0;
			if (ticks === this.lastSeenTicks) {
				clearInterval(this.pollTimer);
				this.pollTimer = setInterval(() => this.poll(), POLL_INTERVAL_MS);
			}
			this.lastSeenTicks = ticks;
		}, 5000);
	}

	disconnectedCallback() {
		if (this.loadTimer) {
			clearTimeout(this.loadTimer);
			this.loadTimer = undefined;
		}
		if (this.pollTimer) {
			clearInterval(this.pollTimer);
			this.pollTimer = undefined;
		}
		if (this.watchdog) {
			clearInterval(this.watchdog);
			this.watchdog = undefined;
		}
		super.disconnectedCallback();
	}

	cacheNodes() {
		const pick = (id) => this.querySelector("#" + id);
		this.nodes = {
			tabs: this.querySelectorAll(".tab"),
			scoreChip: pick("scoreChip"),
			offline: pick("offline"),
			offlineTitle: this.querySelector(".offline-title"),
			offlineBody: this.querySelector(".offline-body"),
			viewHunt: pick("viewHunt"),
			viewLifelist: pick("viewLifelist"),
			viewSettings: pick("viewSettings"),
			contactList: pick("contactList"),
			huntEmpty: pick("huntEmpty"),
			huntEmptyNote: pick("huntEmptyNote"),
			spotHint: pick("spotHint"),
			listHold: pick("listHold"),
			alert: pick("alert"),
			lifelistStats: pick("lifelistStats"),
			lifelistBody: pick("lifelistBody"),
			difficultyRow: pick("difficultyRow"),
			difficultyBlurb: pick("difficultyBlurb"),
			textSizeRow: pick("textSizeRow"),
			backgroundRow: pick("backgroundRow"),
			recognitionRow: pick("recognitionRow"),
			recognitionBlurb: pick("recognitionBlurb"),
			resetBtn: pick("resetBtn"),
			sortToggle: pick("sortToggle"),
			radarWrap: pick("radarWrap"),
			radar: pick("radar"),
			radarRow: pick("radarRow"),
			quizOverlay: pick("quizOverlay"),
			quizPrompt: pick("quizPrompt"),
			quizOptions: pick("quizOptions"),
			quizGiveUp: pick("quizGiveUp"),
			quizCancel: pick("quizCancel"),
			resultOverlay: pick("resultOverlay"),
			resultTitle: pick("resultTitle"),
			resultSpecies: pick("resultSpecies"),
			resultDetail: pick("resultDetail"),
			resultPoints: pick("resultPoints"),
			resultClose: pick("resultClose"),
		};
	}

	bindEvents() {
		this.nodes.tabs.forEach((tab) => {
			tab.addEventListener("click", () => this.setView(tab.dataset.view));
		});
		// Delegated: the list is rebuilt every poll, so per-row listeners
		// would be re-bound once a second for nothing.
		this.nodes.contactList.addEventListener("click", (event) => {
			const row = event.target.closest ? event.target.closest(".contact") : null;
			if (row && row.dataset.key) {
				this.holdList();
				this.tapContact(row.dataset.key);
			}
		});
		// Hovering holds the order. Mouse events are what the sim's VR
		// pointer generates too, so this works in the headset.
		const pointerHere = () => {
			this.pointerOverList = true;
			this.pointerSeenAt = Date.now();
			this.updateHoldNote();
		};
		this.nodes.contactList.addEventListener("mouseenter", pointerHere);
		this.nodes.contactList.addEventListener("mousemove", pointerHere);
		this.nodes.contactList.addEventListener("mouseleave", () => {
			this.pointerOverList = false;
			this.updateHoldNote();
		});
		this.nodes.quizGiveUp.addEventListener("click", () => this.resolveQuiz(null));
		this.nodes.quizCancel.addEventListener("click", () => this.cancelQuiz());
		this.nodes.resultClose.addEventListener("click", () => {
			this.nodes.resultOverlay.classList.add("hidden");
		});
		if (this.nodes.sortToggle) {
			this.nodes.sortToggle.addEventListener("click", (event) => {
				const btn = event.target.closest ? event.target.closest(".sort-btn") : null;
				if (!btn || !SORT_MODES[btn.dataset.sort]) return;
				this.state.sortMode = btn.dataset.sort;
				this.saveState();
				this.renderSort();
				// Reordering under a held list would be the one time the hold
				// is unwanted: the player just asked for a different order.
				this.listHeldUntil = 0;
				this.renderHunt();
			});
		}
		this.nodes.resetBtn.addEventListener("click", () => this.handleReset());
	}

	// ----------------------------------------------------------- storage

	// An empty read is NOT proof that nothing is saved -- the sim's storage
	// can still be coming up when a panel initialises, and it reliably is
	// during an SDK build, which launches its own copy of the game. Treating
	// an empty read as "first run" and then saving over it is how a lifelist
	// gets wiped, so nothing is written until we know what was already there.
	loadState() {
		const raw = this.readStored();
		if (raw) {
			this.adoptState(raw);
			this.loaded = true;
			return;
		}
		this.loaded = false;
		this.loadAttempts = 0;
		this.scheduleLoadRetry();
	}

	readStored() {
		try {
			return GetStoredData(STORAGE_KEY);
		} catch (err) {
			return null;
		}
	}

	scheduleLoadRetry() {
		this.loadTimer = setTimeout(() => this.retryLoad(), LOAD_RETRY_MS);
	}

	retryLoad() {
		this.loadTimer = undefined;
		this.loadAttempts += 1;

		const raw = this.readStored();
		if (raw) {
			this.adoptState(raw);
			this.loaded = true;
			this.afterLoad();
			return;
		}
		if (this.loadAttempts >= LOAD_RETRIES) {
			// Storage has had long enough. There really is nothing saved, so
			// this is a genuine first run and writing is safe.
			this.loaded = true;
			return;
		}
		this.scheduleLoadRetry();
	}

	adoptState(raw) {
		try {
			const saved = JSON.parse(raw);
			if (saved && typeof saved === "object") {
				this.state = Object.assign(this.state, saved);
			}
		} catch (err) {
			// Corrupt save: keep the defaults rather than refusing to start.
		}
		if (!DIFFICULTIES[this.state.difficulty]) this.state.difficulty = "tracker";
		if (!TEXT_SIZES[this.state.textSize]) this.state.textSize = DEFAULT_TEXT_SIZE;
		if (this.state.background === "slight") this.state.background = "tinted";
		if (!BACKGROUNDS[this.state.background]) this.state.background = DEFAULT_BACKGROUND;
		if (!RECOGNITION[this.state.recognition]) this.state.recognition = DEFAULT_RECOGNITION;
		if (!SORT_MODES[this.state.sortMode]) this.state.sortMode = DEFAULT_SORT;
		if (!RADAR_MODES[this.state.radar]) this.state.radar = DEFAULT_RADAR;
		if (!this.state.attempts) this.state.attempts = {};
		if (!this.state.captured) this.state.captured = {};
		if (!this.state.lifelist) this.state.lifelist = {};
		if (!this.state.logged) this.state.logged = {};
	}

	// Only reached when a retry found data after the panel had already drawn
	// itself from defaults, so everything state-driven has to catch up.
	afterLoad() {
		this.renderDifficulty();
		this.renderTextSize();
		this.applyTextSize();
		this.renderBackground();
		this.applyBackground();
		this.renderRecognition();
		this.renderScore();
		this.renderSort();
		this.renderRadar();
		if (this.view === "hunt") this.renderHunt();
		if (this.view === "lifelist") this.renderLifelist();
	}

	saveState() {
		// Never write before the load has settled -- see loadState().
		if (!this.loaded) return;
		try {
			SetStoredData(STORAGE_KEY, JSON.stringify(this.state));
		} catch (err) {
			// Nothing useful to do -- the session still plays, it just won't persist.
		}
	}

	// ------------------------------------------------------------ network

	// The module inside the sim, if this install has one. Everything here is
	// optional: if the module is missing, or the sim is too old to have the
	// message service, this quietly does nothing and the helper runs the game.
	renderSort() {
		const row = this.nodes.sortToggle;
		if (!row) return;
		Array.prototype.forEach.call(row.querySelectorAll(".sort-btn"), (btn) => {
			btn.classList.toggle("is-active", btn.dataset.sort === this.state.sortMode);
		});
	}

	showVersion() {
		const el = this.querySelector("#panelVersion");
		if (el) el.textContent = "Version " + PANEL_VERSION;
	}

	startInSim() {
		if (typeof FaunaInSimSource !== "function") return;
		const table = (typeof FAUNA_SPECIES_DATA !== "undefined") ? FAUNA_SPECIES_DATA : null;
		if (!table) return;
		// Reuses the connection across panel rebuilds -- see faunaInSimSource().
		this.inSim = (typeof faunaInSimSource === "function")
			? faunaInSimSource(table)
			: null;
	}

	// The species table ships with the panel, so it is simply read.
	fetchSpecies() {
		this.species = (typeof FAUNA_SPECIES_DATA !== "undefined" && FAUNA_SPECIES_DATA)
			? (FAUNA_SPECIES_DATA.species || {})
			: null;
		if (this.view === "lifelist") this.renderLifelist();
	}

	// Everything here is wrapped, because an error thrown out of a timer tick
	// can stop the timer -- and then the panel simply freezes on whatever it
	// last drew, with no clue as to why. That is exactly how this looked:
	// "asked 2, answered 1", for ever.
	poll() {
		try {
			this.pollTicks = (this.pollTicks || 0) + 1;
			if (!this.inSim) {
				this.setStatus("nomodule");
				this.updateStatusLine();
				return;
			}
			this.inSim.poll();
			if (this.inSim.available && this.inSim.snapshot) {
				this.applySnapshot(this.inSim.snapshot);
			} else {
				this.setStatus("nosim");
				this.updateStatusLine();
			}
			this.panelError = null;
		} catch (err) {
			this.panelError = (err && err.message) ? err.message : String(err);
			// Keep the ticks going regardless. A panel that reports a fault
			// every second is far better than one that quietly stops.
			try {
				const note = this.nodes && this.nodes.huntEmptyNote;
				if (note) note.textContent = "Panel error: " + this.panelError;
			} catch (ignored) { /* nothing more we can do */ }
		}
	}

	applySnapshot(data) {
		this.snapshot = data;
		// The service runs happily without the sim, so "reachable" and
		// "has data" are two different things and must read differently.
		this.setStatus(data.connected === false ? "nosim" : "ok");
		if (!this.species) this.fetchSpecies();
		const contacts = (data && data.contacts) || [];
		this.trackLogged(contacts);
		this.checkCaptures(contacts);
		this.renderAlert(contacts);
		if (this.view === "hunt") this.renderHunt();
		this.updateStatusLine();
	}

	setStatus(status) {
		if (this.status === status) return;
		this.status = status;
		this.online = (status === "ok");
		this.nodes.offline.classList.toggle("hidden", status === "ok");

		if (status === "nosim") {
			this.nodes.offlineTitle.textContent = "Waiting for the simulator";
			this.nodes.offlineBody.textContent =
				"Load a flight and contacts appear on their own.";
		} else if (status === "nomodule") {
			// Only reachable if the add-on is half-installed: the panel is
			// there but the part that reads the sim is not.
			this.nodes.offlineTitle.textContent = "Add-on not fully installed";
			this.nodes.offlineBody.textContent =
				"Reinstall Fauna Hunt, then restart the simulator.";
		}
	}

	// -------------------------------------------------------------- views

	setView(view) {
		this.view = view;
		this.nodes.tabs.forEach((tab) => {
			tab.classList.toggle("is-active", tab.dataset.view === view);
		});
		this.nodes.viewHunt.classList.toggle("hidden", view !== "hunt");
		this.nodes.viewLifelist.classList.toggle("hidden", view !== "lifelist");
		this.nodes.viewSettings.classList.toggle("hidden", view !== "settings");
		if (view === "lifelist") this.renderLifelist();
		if (view === "hunt") this.renderHunt();
	}

	renderScore() {
		this.nodes.scoreChip.textContent = String(Math.round(this.state.score));
	}

	// --------------------------------------------------------- the fuzzing

	get difficulty() {
		return DIFFICULTIES[this.state.difficulty];
	}

	tierFor(distance) {
		const scale = this.difficulty.scale;
		if (distance <= TIERS.close * scale) return "close";
		if (distance <= TIERS.fine * scale) return "fine";
		if (distance <= TIERS.coarse * scale) return "coarse";
		return "sector";
	}

	// The heart of the game. Everything the player is told about a contact is
	// decided here, and the species name is never among it -- until it has been
	// identified, at which point there is nothing left to withhold and the tile
	// says what the animal actually is.
	describeContact(contact) {
		const tier = this.tierFor(contact.distance_m);
		const size = this.isLogged(contact)
			? contact.common + (contact.count > 1 ? " × " + contact.count : "")
			: (SIZE_WORDS[contact.size] || "an animal");

		if (tier === "sector") {
			return {
				// Withholding "Movement" from something you have already named
				// is just the panel being coy about nothing.
				what: this.isLogged(contact) ? size : "Movement",
				where: "somewhere " + sectorOf(contact.bearing_deg),
				arrow: directionArrow(contact.relative_bearing_deg, 45),
				range: "",
			};
		}

		if (tier === "coarse") {
			return {
				what: size,
				where: "bearing " + String(quantise(contact.bearing_deg, 30)).padStart(3, "0") + "°",
				arrow: directionArrow(contact.relative_bearing_deg, 30),
				range: distanceBracket(contact.distance_m),
			};
		}

		if (tier === "fine") {
			const herd = contact.count > 1
				? contact.count + " of them"
				: "on its own";
			return {
				what: this.isLogged(contact) ? size : size + ", " + herd,
				where: "bearing " + String(quantise(contact.bearing_deg, 10)).padStart(3, "0") + "°",
				arrow: directionArrow(contact.relative_bearing_deg, 10),
				range: roundTo(contact.distance_m, 100) + " m",
			};
		}

		// close
		const count = contact.count > 1
			? contact.count + " " + plural(contact.count, "animal", "animals")
			: "A single animal";
		return {
			what: this.isLogged(contact) ? size : count,
			// An o'clock position is already 30 degree steps, so the arrow
			// matches it exactly.
			where: "your " + contact.clock + " o'clock, " + (contact.above ? "high" : "low"),
			arrow: directionArrow(contact.relative_bearing_deg, 30),
			range: roundTo(contact.distance_m, 50) + " m",
		};
	}

	// ---------------------------------------------------------------- hunt

	// Contacts are sorted by distance and the list refreshes every second, so
	// at flying speed the rows reorder under the cursor -- people were reaching
	// for one animal and identifying another. Two things prevent that:
	//
	//   1. Rows are reconciled by key rather than rebuilt from a string, so a
	//      row keeps its identity and its element between polls instead of
	//      being destroyed and recreated mid-reach.
	//   2. Reordering is HELD while the pointer is over the list, and for a
	//      moment after any tap. Text inside each row still updates -- only
	//      the running order is frozen, so nothing moves while you aim.
	// Ahead of the AIRCRAFT, not the view: it is the flight path that decides
	// whether a contact is worth turning for, and the view is unavailable in VR
	// anyway.
	isAhead(contact) {
		const rel = contact.relative_bearing_deg;
		if (typeof rel !== "number") return true;
		return rel <= 90 || rel >= 270;
	}

	orderContacts(contacts) {
		if (this.state.sortMode !== "ahead") return contacts;
		const ahead = [];
		const behind = [];
		contacts.forEach((c) => (this.isAhead(c) ? ahead : behind).push(c));
		return ahead.concat(behind);
	}

	// ------------------------------------------------------------- radar

	// Everything drawn here is quantised before it is placed -- see RADAR_MODES
	// for why. Rebuilt whole on each poll: it is a few hundred bytes of SVG and
	// reconciling it would cost more than it saves.
	drawRadar(contacts) {
		const wrap = this.nodes.radarWrap;
		const svg = this.nodes.radar;
		if (!wrap || !svg) return;

		const mode = RADAR_MODES[this.state.radar] || RADAR_MODES[DEFAULT_RADAR];
		if (!mode.em) {
			wrap.classList.add("hidden");
			return;
		}
		wrap.classList.remove("hidden");
		wrap.style.setProperty("--fh-radar", mode.em + "em");

		// Colours come from the stylesheet rather than being repeated here, so
		// the radar cannot drift away from the rest of the panel.
		const css = getComputedStyle(this);
		const colour = (name, fallback) =>
			(css.getPropertyValue(name) || "").trim() || fallback;
		const accent = colour("--fh-accent", "#6fd08c");
		const dim = colour("--fh-dim", "#b6c3cc");
		const faint = colour("--fh-faint", "#8b98a4");

		const usable = contacts.filter((c) =>
			typeof c.relative_bearing_deg === "number"
			&& typeof c.distance_m === "number");

		// Scale to the furthest contact, rounded out to the end of its own
		// bracket, so the ring is always a distance the list has already said
		// out loud and the display is never mostly empty.
		let max = 0;
		usable.forEach((c) => { max = Math.max(max, distanceBand(c.distance_m)[1]); });
		if (max < 1000) max = usable.length ? 1000 : 2000;

		const CX = 120, CY = 120, R = 103;
		const fix = (n) => Math.round(n * 10) / 10;
		// Square root, not linear: linear crushes everything close to you into
		// the middle, and close is where the decisions are.
		const toR = (m) => R * Math.sqrt(Math.min(m, max) / max);
		const pt = (deg, r) => {
			const a = deg * Math.PI / 180;
			return [CX + r * Math.sin(a), CY - r * Math.cos(a)];
		};
		const wedge = (r0, r1, a0, a1) => {
			const p1 = pt(a0, r1), p2 = pt(a1, r1), p3 = pt(a1, r0), p4 = pt(a0, r0);
			const large = (a1 - a0) > 180 ? 1 : 0;
			return "M" + fix(p1[0]) + " " + fix(p1[1])
				+ "A" + fix(r1) + " " + fix(r1) + " 0 " + large + " 1 "
				+ fix(p2[0]) + " " + fix(p2[1])
				+ "L" + fix(p3[0]) + " " + fix(p3[1])
				+ "A" + fix(r0) + " " + fix(r0) + " 0 " + large + " 0 "
				+ fix(p4[0]) + " " + fix(p4[1]) + "Z";
		};
		// Soft edges, but not faint: a smudge you have to hunt for on the
		// display defeats the point of having one. The fade is what keeps it
		// from reading as a pin.
		const blob = (id, stop, peak) => "<radialGradient id=\"" + id + "\">"
			+ "<stop offset=\"0%\" stop-color=\"" + stop + "\" stop-opacity=\"" + peak + "\"/>"
			+ "<stop offset=\"50%\" stop-color=\"" + stop + "\" stop-opacity=\""
			+ (peak * 0.45).toFixed(2) + "\"/>"
			+ "<stop offset=\"100%\" stop-color=\"" + stop + "\" stop-opacity=\"0\"/>"
			+ "</radialGradient>";

		let out = "<defs>" + blob("fhBlobNear", accent, 0.85) + blob("fhBlobFar", dim, 0.72)
			+ blob("fhBlobDone", faint, 0.34) + "</defs>";

		// Range rings. Two labelled, so the scale is readable without the
		// display turning into a chart.
		[0.25, 0.5, 0.75, 1].forEach((f) => {
			out += "<circle cx=\"" + CX + "\" cy=\"" + CY + "\" r=\"" + fix(toR(max * f))
				+ "\" fill=\"none\" stroke=\"" + faint
				+ "\" stroke-opacity=\"0.22\" stroke-width=\"1\"/>";
		});
		[0.5, 1].forEach((f) => {
			out += "<text x=\"" + (CX + 4) + "\" y=\"" + fix(CY - toR(max * f) + 11)
				+ "\" fill=\"" + faint + "\" fill-opacity=\"0.85\" font-size=\"11\""
				+ " font-family=\"monospace\">" + rangeLabel(max * f) + "</text>";
		});

		// Furthest first, so the contacts you can actually reach end up on top.
		usable.slice().sort((a, b) => b.distance_m - a.distance_m).forEach((c) => {
			const step = RADAR_STEPS[this.tierFor(c.distance_m)] || 30;
			const bearing = quantise(c.relative_bearing_deg, step);
			const band = distanceBand(c.distance_m);
			const r0 = toR(band[0]);
			const r1 = toR(band[1]);
			const done = this.isLogged(c);
			const near = c.distance_m <= IDENTIFY_RANGE_M;
			const stroke = done ? faint : (near ? accent : dim);
			const fill = done ? "fhBlobDone" : (near ? "fhBlobNear" : "fhBlobFar");

			// The wedge is the honest part: it is the whole area the words
			// allow the animal to be in.
			out += "<path d=\"" + wedge(r0, r1, bearing - step / 2, bearing + step / 2)
				+ "\" fill=\"" + stroke + "\" fill-opacity=\"0.09\"/>";

			const mid = pt(bearing, (r0 + r1) / 2);
			out += "<circle cx=\"" + fix(mid[0]) + "\" cy=\"" + fix(mid[1]) + "\" r=\""
				+ fix(RADAR_BLOB_MAX * radarBucket(c.count))
				+ "\" fill=\"url(#" + fill + ")\"/>";
		});

		// You, nose up. Drawn last so nothing covers it.
		out += "<path d=\"M120 111 L125.5 125 L120 121.5 L114.5 125 Z\" fill=\""
			+ accent + "\"/>";

		svg.innerHTML = out;
	}

	renderRadar() {
		const row = this.nodes.radarRow;
		if (!row) return;
		row.innerHTML = "";
		Object.keys(RADAR_MODES).forEach((key) => {
			const button = document.createElement("button");
			button.type = "button";
			button.className = "seg-btn" + (key === this.state.radar ? " is-active" : "");
			button.textContent = RADAR_MODES[key].label;
			button.addEventListener("click", () => {
				this.state.radar = key;
				this.saveState();
				this.renderRadar();
				this.renderHunt();
			});
			row.appendChild(button);
		});
	}

	renderHunt() {
		const list = this.nodes.contactList;
		const contacts = this.orderContacts(
			(this.snapshot && this.snapshot.contacts) || []);

		// Before any of the early returns below -- the radar should keep
		// working while the list is held and while the list is empty.
		this.drawRadar(contacts);

		// Re-derive the row map from what is ACTUALLY in the list, and drop any
		// duplicate for a key we have already seen. Previously this map was the
		// only record of which element belonged to which contact, so the moment
		// the two drifted apart the panel updated one element while an
		// abandoned copy stayed on screen -- showing "identify" on a herd that
		// had already been identified, permanently. Rebuilding from the DOM
		// makes the render idempotent and self-healing however they diverge.
		this.rows = {};
		let noteFound = null;
		const existingNodes = Array.prototype.slice.call(list.children);
		existingNodes.forEach((node) => {
			const key = node.dataset && node.dataset.key;
			if (!key) {
				// The capped note carries no key, so it needs the same
				// treatment: keep the first, drop any extra. Skipping it here
				// left one stranded at the top of the list on every render.
				if (node.classList && node.classList.contains("capped-note")) {
					if (noteFound) {
						if (node.parentNode) node.parentNode.removeChild(node);
					} else {
						noteFound = node;
					}
				}
				return;
			}
			if (this.rows[key]) {
				if (node.parentNode) node.parentNode.removeChild(node);
				return;
			}
			this.rows[key] = node;
		});
		// Adopt whatever survived, so renderCappedNote reuses it rather than
		// building another one alongside.
		this.cappedNote = noteFound;

		if (!contacts.length) {
			this.rows = {};
			list.innerHTML = "";
			this.cappedNote = null;
			this.nodes.huntEmpty.classList.toggle("hidden", !this.online);
			this.explainEmpty();
			this.updateHoldNote();
			return;
		}
		this.nodes.huntEmpty.classList.add("hidden");

		// Always refresh what each visible row says, held or not: distances
		// going stale under the cursor would be worse than rows moving.
		contacts.forEach((contact) => {
			const existing = this.rows[contact.key];
			if (existing) this.fillRow(existing, contact);
		});

		if (this.listHeld()) {
			this.updateHoldNote();
			return;
		}

		// Re-attaching every row on every poll drags the scroll position around
		// under anyone reading a long list, so only nodes that are genuinely in
		// the wrong place get moved. Scroll position is restored afterwards as
		// well, since a removal above the viewport still shifts it.
		const scrollTop = list.scrollTop;

		const seen = {};
		contacts.forEach((contact, index) => {
			seen[contact.key] = true;
			let row = this.rows[contact.key];
			if (!row) {
				row = document.createElement("div");
				row.dataset.key = contact.key;
				this.rows[contact.key] = row;
				this.fillRow(row, contact);
			}
			if (list.children[index] !== row) {
				list.insertBefore(row, list.children[index] || null);
			}
		});

		Object.keys(this.rows).forEach((key) => {
			if (seen[key]) return;
			const row = this.rows[key];
			if (row.parentNode) row.parentNode.removeChild(row);
			delete this.rows[key];
		});

		this.renderCappedNote(list);
		if (list.scrollTop !== scrollTop) list.scrollTop = scrollTop;
		this.updateHoldNote();
	}

	fillRow(row, contact) {
		const described = this.describeContact(contact);
		const logged = this.isLogged(contact);
		const near = contact.distance_m <= IDENTIFY_RANGE_M;
		// Anything in range can be tapped to identify it. That is far more
		// discoverable than the SPOT button alone, and it is the only
		// practical interaction in VR, where typing is not an option.
		const clickable = near && !logged;
		row.className = "contact" + (near ? " is-near" : "")
			+ (logged ? " is-logged" : "")
			+ (clickable ? " is-clickable" : "");
		// Arrow and distance are ONE block, on the left. Kept apart, answering
		// "which way, how far" took a glance at each end of the row -- a poor
		// trade in a moving aircraft and worse in VR.
		row.innerHTML = "<div class=\"contact-nav\">"
			+ "<span class=\"arrow-box\">" + (described.arrow || "") + "</span>"
			+ (described.range
				? "<span class=\"nav-range\">" + described.range + "</span>"
				: "")
			+ "</div>"
			+ "<div class=\"contact-desc\">"
			+ "<span class=\"contact-what\">" + described.what + "</span>"
			+ "<span class=\"contact-where\">" + described.where + "</span>"
			+ "</div>"
			+ (logged
				// A tick, not the word alone: "identified" and "identify" are
				// one letter apart at a glance, and people were tapping tiles
				// they had already finished with.
				? (this.isCaptured(contact)
					? "<span class=\"contact-tag is-captured\">"
						+ "<svg viewBox=\"0 0 16 16\" width=\"1em\" height=\"1em\" "
						+ "fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.4\" "
						+ "stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\">"
						+ "<path d=\"M3 8.5 L6.5 12 L13 4.5\"/></svg>captured</span>"
					: "<span class=\"contact-tag is-logged\">"
					+ "<svg viewBox=\"0 0 16 16\" width=\"1em\" height=\"1em\" "
					+ "fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.4\" "
					+ "stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\">"
					+ "<path d=\"M3 8.5 L6.5 12 L13 4.5\"/></svg>done</span>")
				: (near ? "<span class=\"contact-tag\">identify</span>" : ""));
	}

	renderCappedNote(list) {
		// The sim returns at most 250 objects, so a full list is never a
		// complete list. Say so rather than implying the area is covered.
		const capped = !!(this.snapshot && this.snapshot.stats && this.snapshot.stats.capped);
		if (!capped) {
			if (this.cappedNote && this.cappedNote.parentNode) {
				this.cappedNote.parentNode.removeChild(this.cappedNote);
			}
			this.cappedNote = null;
			return;
		}
		if (!this.cappedNote) {
			this.cappedNote = document.createElement("p");
			this.cappedNote.className = "capped-note";
			this.cappedNote.textContent = "Too much wildlife to track it all — "
				+ "there is more out there than this list shows.";
		}
		list.appendChild(this.cappedNote);
	}

	listHeld() {
		// The hover flag is only trusted while the pointer keeps proving it is
		// there. In VR, leaving the panel often raises no event at all, and a
		// latched flag freezes the list for the rest of the flight.
		const hovering = this.pointerOverList
			&& (Date.now() - (this.pointerSeenAt || 0)) < POINTER_STUCK_MS;
		return hovering || Date.now() < this.listHeldUntil;
	}

	holdList() {
		this.listHeldUntil = Date.now() + LIST_HOLD_MS;
	}

	// "No contacts in range" is only true if the sim actually answered and had
	// nothing to offer. It is a bad thing to say when the sim returned plenty
	// and we discarded all of it, or when no reply has arrived at all -- that
	// sends people looking for animals instead of reporting a fault.
	explainEmpty() {
		const note = this.nodes.huntEmptyNote;
		if (!note) return;
		const snap = this.snapshot;
		if (!snap) {
			note.textContent = "No reply from the simulator yet.";
			return;
		}
		// Kept: if the panel ever faults again, saying so beats a blank list
		// that sends someone hunting for animals that were never the problem.
		if (this.panelError) {
			note.textContent = "Panel error: " + this.panelError;
			return;
		}
		const m = snap.module || {};
		if (m.error) {
			note.textContent = "The module could not reach the simulator: " + m.error;
			return;
		}
		if (!snap.user) {
			note.textContent = "Waiting for your aircraft's position.";
			return;
		}
		const stats = snap.stats || {};
		const rejected = stats.rejected || {};
		const offered = (rejected.not_huntable || 0) + (rejected.streaming_in || 0)
			+ (stats.raw_returned || 0);
		if (offered > 0) {
			note.textContent = "Nothing huntable nearby - the simulator has "
				+ "people and vehicles here, but no animals.";
			return;
		}
		if (!m.replies) {
			note.textContent = "Starting up.";
			return;
		}
		note.textContent = "";
	}

	updateHoldNote() {
		const note = this.nodes.listHold;
		if (note) note.classList.toggle("hidden", !this.listHeld());
	}

	// True if this herd has already been identified, even if the sim has since
	// handed it to us under a different key.
	isLogged(contact) {
		// Recognise-on-sight: knowing the species anywhere is enough, so a
		// herd you have never met is still named and cannot be scored.
		if (this.state.recognition === "sight"
			&& this.state.lifelist[contact.species]) {
			return true;
		}
		if (this.state.logged[contact.key]) return true;
		const logged = this.state.logged;
		const keys = Object.keys(logged);
		for (let i = 0; i < keys.length; i++) {
			const entry = logged[keys[i]];
			// Older saves stored `true` rather than a position; those can only
			// ever match on the key, which the line above already covered.
			if (!entry || entry === true || entry.species !== contact.species) continue;
			if (haversineM(entry.lat, entry.lon, contact.lat, contact.lon) <= LOGGED_MATCH_M) {
				return true;
			}
		}
		return false;
	}

	// You have to be looking at it. Not the aircraft's nose -- your actual view,
	// which is the headset in VR and the camera in 2D. Stops you identifying an
	// animal behind you because its tile happened to be nearest.
	inView(contact) {
		if (contact.off_view_deg === undefined || contact.off_view_deg === null) {
			return true;                       // no camera reading -- do not block
		}
		const cone = (this.snapshot && this.snapshot.view_cone_deg)
			|| DEFAULT_VIEW_CONE_DEG;
		return contact.off_view_deg <= cone;
	}

	isCaptured(contact) {
		return !!this.state.captured[contact.key];
	}

	// Animals run from aircraft. A logged sighting remembers WHERE it happened,
	// and a herd that flees past that radius stops being recognised -- so you
	// chase them out of their own identification. Walk the anchor along with
	// them instead, on every poll.
	trackLogged(contacts) {
		let moved = false;
		contacts.forEach((contact) => {
			const entry = this.state.logged[contact.key];
			if (entry && entry !== true && entry.species === contact.species) {
				if (haversineM(entry.lat, entry.lon, contact.lat, contact.lon) > 40) {
					entry.lat = contact.lat;
					entry.lon = contact.lon;
					moved = true;
				}
				return;
			}
			// Matched by proximity rather than by key: the herd has drifted into
			// a new grid cell, so move the record to where they actually are.
			const keys = Object.keys(this.state.logged);
			for (let i = 0; i < keys.length; i++) {
				const other = this.state.logged[keys[i]];
				if (!other || other === true || other.species !== contact.species) continue;
				if (haversineM(other.lat, other.lon, contact.lat, contact.lon) <= LOGGED_MATCH_M) {
					if (haversineM(other.lat, other.lon, contact.lat, contact.lon) > 40) {
						other.lat = contact.lat;
						other.lon = contact.lon;
						moved = true;
					}
					break;
				}
			}
		});
		if (moved) this.saveState();
	}

	// Capture needs no press. Identify it, then fly close enough to the nearest
	// animal in the herd and it is yours -- which is what pulls people down to
	// the deck instead of identifying everything from altitude.
	checkCaptures(contacts) {
		let caught = null;
		contacts.forEach((contact) => {
			if (this.state.captured[contact.key]) return;
			if (!this.isLogged(contact)) return;
			const nearest = contact.nearest_m !== undefined
				? contact.nearest_m : contact.distance_m;
			if (nearest > CAPTURE_RANGE_M) return;
			if (!this.inView(contact)) return;   // close is not enough -- look at it

			this.state.captured[contact.key] = true;
			const bonus = Math.round(this.pointsFor(contact)
				* CAPTURE_MULTIPLIER * this.difficulty.scoreMult);
			this.state.score += bonus;

			const record = this.state.lifelist[contact.species];
			if (record) {
				record.captured = true;
				record.capturedOn = record.capturedOn || todayIso();
			}
			caught = { contact: contact, bonus: bonus };
		});

		if (caught) {
			this.saveState();
			this.renderScore();
			this.setSpotHint("Nice capture — " + caught.contact.common
				+ ". +" + caught.bonus + " points.", false, true);
		}
		return !!caught;
	}

	// Only the legendary eight. Anything commoner becomes wallpaper.
	legendaryNearby(contacts) {
		for (let i = 0; i < contacts.length; i++) {
			if (contacts[i].tier === ALERT_TIER) return contacts[i];
		}
		return null;
	}

	renderAlert(contacts) {
		const node = this.nodes.alert;
		if (!node) return;
		const found = this.legendaryNearby(contacts);
		if (!found) {
			node.classList.add("hidden");
			this.alertFor = null;
			return;
		}
		if (this.alertFor !== found.key) {
			this.alertFor = found.key;
			const known = this.isLogged(found);
			node.textContent = known
				? found.common + " nearby — " + Math.round(found.distance_m) + " m"
				: "Something legendary is out here";
		}
		node.classList.remove("hidden");
	}

	contactByKey(key) {
		const contacts = (this.snapshot && this.snapshot.contacts) || [];
		for (let i = 0; i < contacts.length; i++) {
			if (contacts[i].key === key) return contacts[i];
		}
		return null;
	}

	// Tapping a specific contact says "this is the one I'm looking at", which
	// is better than the SPOT button guessing at the nearest. No cone test
	// here -- you picked it deliberately, so range alone is the gate.
	tapContact(key) {
		if (this.quiz) return;
		const contact = this.contactByKey(key);
		if (!contact) return;

		if (this.isLogged(contact)) {
			this.setSpotHint("Already identified: " + contact.common + ".", false, true);
			return;
		}
		if (contact.distance_m > IDENTIFY_RANGE_M) {
			this.setSpotHint("Too far to be sure. Get within "
				+ IDENTIFY_RANGE_M + " m of it.", true, true);
			return;
		}
		if (!this.inView(contact)) {
			// Feedback on a tap they made, not an unsolicited warning -- a tap
			// that silently does nothing reads as a broken panel.
			this.setSpotHint("It's not in that direction.", true, true);
			return;
		}
		this.openQuiz(contact);
	}

	// The status line under the list. There used to be a SPOT button here that
	// picked a contact for you using a cone test you were never shown, and
	// fined you five points when it found nothing. Tapping a tile does the
	// same job and says which animal it means, so the button is gone.
	updateStatusLine() {
		if (this.quiz) return;
		this.setSpotHint(this.online
			? "Tap a contact to identify it."
			: "Waiting for the simulator.", false);
	}

	setSpotHint(text, isMiss, hold) {
		// Without the hold, the once-per-second poll calls updateStatusLine and
		// wipes one-off feedback before it can be read.
		if (!hold && Date.now() < this.hintHeldUntil) return;
		if (hold) this.hintHeldUntil = Date.now() + HINT_HOLD_MS;
		this.nodes.spotHint.textContent = text;
		this.nodes.spotHint.classList.toggle("is-miss", !!isMiss);
	}

	// ---------------------------------------------------------------- quiz

	buildShortlist(contact) {
		const table = this.species || {};
		const correct = contact.species;
		const pool = Object.keys(table).filter((root) => root !== correct);

		const sameRegion = pool.filter((root) => table[root].region === contact.region);
		const sameSize = pool.filter((root) => table[root].size === contact.size);

		const decoys = [];
		const take = (candidates) => {
			shuffle(candidates).forEach((root) => {
				if (decoys.length < 3 && decoys.indexOf(root) === -1) decoys.push(root);
			});
		};
		// Same region first, so "it's the only African one" never works.
		take(sameRegion);
		take(sameSize);
		take(pool);

		const options = decoys.map((root) => ({
			root: root,
			label: table[root].common,
		}));
		options.push({ root: correct, label: contact.common });
		return shuffle(options);
	}

	pointsFor(contact) {
		if (contact.points) return contact.points;
		return TIER_POINTS[contact.tier] || 20;
	}

	labelFor(root, contact) {
		if (root === contact.species) return contact.common;
		const table = this.species || {};
		return table[root] ? table[root].common : root;
	}

	openQuiz(contact) {
		// Reopening a contact you backed out of restores the SAME four options
		// with your wrong guesses still crossed out, so backing out can never
		// be used to re-roll an easier shortlist.
		let attempt = this.state.attempts[contact.key];
		if (!attempt || !attempt.options || !attempt.options.length) {
			attempt = {
				tries: 0,
				wrong: [],
				options: this.buildShortlist(contact).map((option) => option.root),
			};
			this.state.attempts[contact.key] = attempt;
			this.saveState();
		}

		this.quiz = { contact: contact, tries: attempt.tries };

		this.nodes.quizPrompt.textContent = contact.count > 1
			? "There are " + contact.count + " of them. What are they?"
			: "What is it?";

		this.nodes.quizOptions.innerHTML = "";
		attempt.options.forEach((root) => {
			const button = document.createElement("button");
			button.type = "button";
			const alreadyWrong = attempt.wrong.indexOf(root) !== -1;
			button.className = "quiz-opt" + (alreadyWrong ? " is-wrong" : "");
			button.disabled = alreadyWrong;
			button.textContent = this.labelFor(root, contact);
			button.addEventListener("click", () => this.guess(button, root));
			this.nodes.quizOptions.appendChild(button);
		});

		this.hintHeldUntil = 0;
		this.listHeldUntil = 0;
		this.pointerOverList = false;
		this.pointerSeenAt = 0;
		this.alertFor = null;
		this.rows = {};
		this.cappedNote = null;
		this.nodes.quizOverlay.classList.remove("hidden");
		this.updateStatusLine();
	}

	// Back out without being told the answer. The contact stays available, but
	// it costs points -- by now you have seen the shortlist.
	cancelQuiz() {
		if (!this.quiz) return;
		this.quiz = null;
		this.nodes.quizOverlay.classList.add("hidden");
		this.state.score = Math.max(0, this.state.score - CANCEL_PENALTY);
		this.saveState();
		this.renderScore();
		this.setSpotHint("Backed out, -" + CANCEL_PENALTY
			+ " points. Tap it again when you have had a better look.", true, true);
		this.updateStatusLine();
	}

	guess(button, root) {
		if (!this.quiz) return;
		if (root === this.quiz.contact.species) {
			this.resolveQuiz(root);
			return;
		}
		this.quiz.tries += 1;
		const attempt = this.state.attempts[this.quiz.contact.key];
		if (attempt) {
			attempt.tries = this.quiz.tries;
			if (attempt.wrong.indexOf(root) === -1) attempt.wrong.push(root);
			this.saveState();
		}
		button.disabled = true;
		button.classList.add("is-wrong");
	}

	resolveQuiz(chosenRoot) {
		if (!this.quiz) return;
		const contact = this.quiz.contact;
		const tries = this.quiz.tries;
		const gaveUp = chosenRoot === null;

		this.nodes.quizOverlay.classList.add("hidden");
		this.quiz = null;

		// The herd is spent either way -- no re-rolling the same animals.
		this.state.logged[contact.key] = {
			species: contact.species,
			lat: contact.lat,
			lon: contact.lon,
		};
		delete this.state.attempts[contact.key];

		const alreadyHave = !!this.state.lifelist[contact.species];
		let points = 0;

		if (!gaveUp) {
			const base = this.pointsFor(contact);
			const distanceMult = Math.min(3, 1 + contact.distance_m / 1000);
			const tryMult = TRY_MULTIPLIER[Math.min(tries, TRY_MULTIPLIER.length - 1)];
			points = base * distanceMult * this.difficulty.scoreMult * tryMult;
			if (alreadyHave) points *= REPEAT_MULT;
			points = Math.round(points);
			this.state.score += points;

			const record = this.state.lifelist[contact.species] || {
				first: todayIso(), lat: contact.lat, lon: contact.lon,
				best: 0, count: 0,
			};
			record.count += 1;
			record.best = Math.max(record.best, points);
			this.state.lifelist[contact.species] = record;
		}

		this.saveState();
		this.renderScore();
		this.renderHunt();
		this.showResult(contact, gaveUp, tries, points, alreadyHave);
		this.updateStatusLine();
	}

	showResult(contact, gaveUp, tries, points, alreadyHave) {
		const nodes = this.nodes;
		const isWin = !gaveUp && tries === 0;

		nodes.resultTitle.textContent = gaveUp
			? "It got away"
			: (isWin ? "Identified" : "Identified, eventually");
		nodes.resultTitle.classList.toggle("is-miss", gaveUp);

		nodes.resultSpecies.textContent = contact.common;

		const bits = [contact.scientific];
		if (contact.count > 1) bits.push(contact.count + " animals");
		bits.push(TIER_LABEL[contact.tier] || "");
		bits.push(Math.round(contact.distance_m) + " m out");
		nodes.resultDetail.textContent = bits.filter(Boolean).join(" · ");

		if (gaveUp) {
			nodes.resultPoints.textContent = "No points — but now you know.";
		} else {
			const notes = [];
			if (tries > 0) notes.push(tries + " wrong " + plural(tries, "guess", "guesses"));
			if (alreadyHave) notes.push("already on your lifelist");
			nodes.resultPoints.textContent = "+" + points + " points"
				+ (notes.length ? " (" + notes.join(", ") + ")" : "")
				+ (!alreadyHave ? " — new species!" : "");
		}

		nodes.resultOverlay.classList.remove("hidden");
	}

	// ------------------------------------------------------------ lifelist

	// Grouped by headline animal rather than by species. The sim ships seven
	// brown bears and eight giraffes; listed flat that reads as a taxonomy
	// exercise, and finding your first tiger stops feeling like an event.
	renderLifelist() {
		const table = this.species;
		const found = this.state.lifelist;

		if (!table) {
			this.nodes.lifelistStats.innerHTML = "";
			this.nodes.lifelistBody.innerHTML =
				"<p class=\"region-head\">Species list unavailable — "
				+ "waiting for the simulator.</p>";
			return;
		}

		const groups = {};
		Object.keys(table).forEach((root) => {
			const info = table[root];
			const name = info.group || info.common;
			const g = groups[name] || (groups[name] = {
				name: name, region: info.region, roots: [],
				rank: info.rank || 0, tier: info.tier || "common",
			});
			g.roots.push(root);
			// A group takes the rarity of its rarest member, so "Tiger" reads
			// legendary once the Siberian is in it.
			if ((info.rank || 0) > g.rank) {
				g.rank = info.rank || 0;
				g.tier = info.tier || g.tier;
			}
		});

		const names = Object.keys(groups);
		const identified = names.filter((n) => groups[n].roots.some((r) => found[r]));
		const captured = names.filter((n) =>
			groups[n].roots.some((r) => found[r] && found[r].captured));

		this.nodes.lifelistStats.innerHTML =
			"<div><b>" + identified.length + " / " + names.length + "</b>identified</div>"
			+ "<div><b>" + captured.length + "</b>captured</div>"
			+ "<div><b>" + Math.round(this.state.score) + "</b>points</div>";

		const byRegion = {};
		names.forEach((n) => {
			const region = groups[n].region || "Global";
			(byRegion[region] = byRegion[region] || []).push(n);
		});
		const regions = Object.keys(byRegion).sort((a, b) => {
			const ia = REGION_ORDER.indexOf(a), ib = REGION_ORDER.indexOf(b);
			return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
		});

		const html = [];
		regions.forEach((region) => {
			const list = byRegion[region].sort((a, b) => a.localeCompare(b));
			const got = list.filter((n) => groups[n].roots.some((r) => found[r])).length;
			html.push("<p class=\"region-head\">" + region
				+ " · " + got + " of " + list.length + "</p>");

			list.forEach((name) => {
				const g = groups[name];
				// An undiscovered animal shows where to go looking rather than a
				// bare dash, which read as a broken row rather than a mystery.
				const where = (this.species[g.roots[0]] || {}).where || "";
				const seen = g.roots.filter((r) => found[r]);
				const caught = seen.filter((r) => found[r].captured);
				const isFound = seen.length > 0;

				let state = "";
				if (caught.length) {
					state = "<span class=\"life-state is-captured\">captured</span>";
				} else if (isFound) {
					state = "<span class=\"life-state\">identified</span>";
				}

				// Variant count only matters once you have started collecting.
				const variants = g.roots.length > 1 && isFound
					? "<span class=\"life-variants\">" + seen.length
						+ " of " + g.roots.length + "</span>"
					: "";

				html.push("<div class=\"life-row" + (isFound ? " is-found" : "") + "\">"
					+ "<span class=\"life-name\">"
					+ (isFound ? name : (where || "—"))
					+ "</span>"
					+ variants
					+ state
					+ "<span class=\"rarity tier-" + g.tier + "\">" + g.tier + "</span>"
					+ "</div>");
			});
		});

		this.nodes.lifelistBody.innerHTML = html.join("");
	}

	// ------------------------------------------------------------ settings

	renderDifficulty() {
		const row = this.nodes.difficultyRow;
		row.innerHTML = "";
		Object.keys(DIFFICULTIES).forEach((key) => {
			const button = document.createElement("button");
			button.type = "button";
			button.className = "seg-btn" + (key === this.state.difficulty ? " is-active" : "");
			button.textContent = DIFFICULTIES[key].label;
			button.addEventListener("click", () => {
				this.state.difficulty = key;
				this.saveState();
				this.renderDifficulty();
				this.renderHunt();
			});
			row.appendChild(button);
		});
		this.nodes.difficultyBlurb.textContent = this.difficulty.blurb;
	}

	applyTextSize() {
		const size = TEXT_SIZES[this.state.textSize] || TEXT_SIZES[DEFAULT_TEXT_SIZE];
		// Custom properties inherit, so setting it on the panel root reaches
		// every rule in the stylesheet.
		this.style.setProperty("--fh-base", String(size.base));
	}

	applyBackground() {
		const choice = BACKGROUNDS[this.state.background] || BACKGROUNDS[DEFAULT_BACKGROUND];
		this.style.setProperty("--fh-opacity", String(choice.opacity));
		this.style.setProperty("--fh-halo", choice.halo);
	}

	renderBackground() {
		const row = this.nodes.backgroundRow;
		if (!row) return;
		row.innerHTML = "";
		Object.keys(BACKGROUNDS).forEach((key) => {
			const button = document.createElement("button");
			button.type = "button";
			button.className = "seg-btn" + (key === this.state.background ? " is-active" : "");
			button.textContent = BACKGROUNDS[key].label;
			button.addEventListener("click", () => {
				this.state.background = key;
				this.saveState();
				this.applyBackground();
				this.renderBackground();
			});
			row.appendChild(button);
		});
	}

	renderRecognition() {
		const row = this.nodes.recognitionRow;
		if (!row) return;
		row.innerHTML = "";
		Object.keys(RECOGNITION).forEach((key) => {
			const button = document.createElement("button");
			button.type = "button";
			button.className = "seg-btn" + (key === this.state.recognition ? " is-active" : "");
			button.textContent = RECOGNITION[key].label;
			button.addEventListener("click", () => {
				this.state.recognition = key;
				this.saveState();
				this.renderRecognition();
				this.renderHunt();
			});
			row.appendChild(button);
		});
		if (this.nodes.recognitionBlurb) {
			this.nodes.recognitionBlurb.textContent = RECOGNITION[this.state.recognition].blurb;
		}
	}

	renderTextSize() {
		const row = this.nodes.textSizeRow;
		if (!row) return;
		row.innerHTML = "";
		Object.keys(TEXT_SIZES).forEach((key) => {
			const button = document.createElement("button");
			button.type = "button";
			button.className = "seg-btn size-" + key
				+ (key === this.state.textSize ? " is-active" : "");
			button.textContent = TEXT_SIZES[key].label;
			button.addEventListener("click", () => {
				this.state.textSize = key;
				this.saveState();
				this.applyTextSize();
				this.renderTextSize();
			});
			row.appendChild(button);
		});
	}

	handleReset() {
		if (!this.resetArmed) {
			this.resetArmed = true;
			this.nodes.resetBtn.textContent = "Tap again to confirm";
			this.nodes.resetBtn.classList.add("is-armed");
			setTimeout(() => {
				this.resetArmed = false;
				this.nodes.resetBtn.textContent = "Reset all progress";
				this.nodes.resetBtn.classList.remove("is-armed");
			}, 4000);
			return;
		}
		this.state.score = 0;
		this.state.lifelist = {};
		this.state.logged = {};
		this.state.attempts = {};
		this.state.captured = {};
		this.resetArmed = false;
		this.nodes.resetBtn.textContent = "Reset all progress";
		this.nodes.resetBtn.classList.remove("is-armed");
		this.saveState();
		this.renderScore();
		this.renderLifelist();
		this.renderHunt();
	}
}

window.customElements.define("ingamepanel-fauna-hunt", IngamePanelFaunaHunt);
checkAutoload();

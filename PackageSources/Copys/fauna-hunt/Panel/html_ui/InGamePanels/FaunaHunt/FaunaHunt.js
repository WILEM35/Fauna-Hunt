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
// Positions arrive from the local data service exactly; ALL of the vagueness
// is applied here, in describeContact(). That means difficulty can be retuned
// by editing this file alone -- the service and the sim never need to change.

const STORAGE_KEY = "FaunaHunt_State_v1";
const POLL_INTERVAL_MS = 1000;
const DEFAULT_SERVICE_URL = "http://127.0.0.1:8760";

// How close you must be for SPOT to find anything at all.
const SPOT_RANGE_M = 1200;
// Contacts inside the cone ahead count; so does anything almost underneath
// you, since overflying a herd puts it well outside any forward cone.
const SPOT_CONE_DEG = 45;
const SPOT_OVERHEAD_M = 600;
// A missed press costs you this many seconds, so SPOT can't just be mashed.
const SPOT_COOLDOWN_MS = 8000;
const MISS_PENALTY = 5;
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
// The sim's stored data is not always readable the instant a panel opens.
// Keep looking for this long before concluding that nothing is saved.
const LOAD_RETRIES = 12;
const LOAD_RETRY_MS = 500;

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

const RARITY_POINTS = { 1: 10, 2: 25, 3: 60, 4: 150 };
const RARITY_LABEL = { 1: "domestic", 2: "common", 3: "regional", 4: "rare" };
// Identifying it first go is worth far more than grinding down the shortlist.
const TRY_MULTIPLIER = [1.0, 0.5, 0.25, 0.1];
// Seeing a species you already have is worth something, but not much.
const REPEAT_MULT = 0.25;

const SECTORS = ["north", "north-east", "east", "south-east",
	"south", "south-west", "west", "north-west"];

const SIZE_WORDS = {
	huge: "something very large",
	large: "a large animal",
	medium: "a medium-sized animal",
	small: "something small",
};

const REGION_ORDER = ["Global", "Europe", "Africa", "Asia", "N.America",
	"S.America", "Arctic", "Australia", "Ocean"];

// ------------------------------------------------------------- utilities

function httpGetJson(url, onOk, onFail) {
	// XMLHttpRequest rather than fetch: it is the more reliable of the two
	// inside the sim's Coherent browser.
	let request;
	try {
		request = new XMLHttpRequest();
	} catch (err) {
		onFail(err);
		return;
	}
	request.open("GET", url, true);
	request.timeout = 3000;
	request.onreadystatechange = () => {
		if (request.readyState !== 4) return;
		if (request.status >= 200 && request.status < 300) {
			try {
				onOk(JSON.parse(request.responseText));
			} catch (err) {
				onFail(err);
			}
		} else {
			onFail(new Error("HTTP " + request.status));
		}
	};
	request.ontimeout = () => onFail(new Error("timeout"));
	request.onerror = () => onFail(new Error("unreachable"));
	try {
		request.send();
	} catch (err) {
		onFail(err);
	}
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
			serviceUrl: DEFAULT_SERVICE_URL,
			lifelist: {},   // species root -> { first, lat, lon, best, count }
			logged: {},     // contact key -> true, so a herd is only worth it once
			attempts: {},   // contact key -> { tries, wrong[], options[] } across back-outs
		};
		this.species = null;      // the full table, fetched once
		this.snapshot = null;     // latest /contacts payload
		this.online = false;
		this.status = null;
		this.view = "hunt";
		this.spotBlockedUntil = 0;
		this.hintHeldUntil = 0;
		this.listHeldUntil = 0;
		this.pointerOverList = false;
		this.rows = {};
		this.cappedNote = null;
		this.quiz = null;
		this.pollTimer = undefined;
		this.resetArmed = false;
		this.loaded = false;
		this.loadAttempts = 0;
		this.loadTimer = undefined;
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
		this.renderScore();
		this.fetchSpecies();
		this.pollTimer = setInterval(() => this.poll(), POLL_INTERVAL_MS);
		this.poll();
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
			offlineCmd: this.querySelector(".offline-cmd"),
			viewHunt: pick("viewHunt"),
			viewLifelist: pick("viewLifelist"),
			viewSettings: pick("viewSettings"),
			contactList: pick("contactList"),
			huntEmpty: pick("huntEmpty"),
			spotBtn: pick("spotBtn"),
			spotHint: pick("spotHint"),
			listHold: pick("listHold"),
			lifelistStats: pick("lifelistStats"),
			lifelistBody: pick("lifelistBody"),
			difficultyRow: pick("difficultyRow"),
			difficultyBlurb: pick("difficultyBlurb"),
			textSizeRow: pick("textSizeRow"),
			backgroundRow: pick("backgroundRow"),
			serviceUrl: pick("serviceUrl"),
			resetBtn: pick("resetBtn"),
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
		this.nodes.spotBtn.addEventListener("click", () => this.attemptSpot());
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
		this.nodes.contactList.addEventListener("mouseenter", () => {
			this.pointerOverList = true;
			this.updateHoldNote();
		});
		this.nodes.contactList.addEventListener("mouseleave", () => {
			this.pointerOverList = false;
			this.updateHoldNote();
		});
		this.nodes.quizGiveUp.addEventListener("click", () => this.resolveQuiz(null));
		this.nodes.quizCancel.addEventListener("click", () => this.cancelQuiz());
		this.nodes.resultClose.addEventListener("click", () => {
			this.nodes.resultOverlay.classList.add("hidden");
		});
		this.nodes.serviceUrl.addEventListener("change", () => {
			const value = this.nodes.serviceUrl.value.trim().replace(/\/+$/, "");
			this.state.serviceUrl = value || DEFAULT_SERVICE_URL;
			this.nodes.serviceUrl.value = this.state.serviceUrl;
			this.species = null;
			this.saveState();
			this.fetchSpecies();
		});
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
		if (!this.state.attempts) this.state.attempts = {};
		if (!this.state.lifelist) this.state.lifelist = {};
		if (!this.state.logged) this.state.logged = {};
		if (this.nodes && this.nodes.serviceUrl) {
			this.nodes.serviceUrl.value = this.state.serviceUrl;
		}
	}

	// Only reached when a retry found data after the panel had already drawn
	// itself from defaults, so everything state-driven has to catch up.
	afterLoad() {
		this.renderDifficulty();
		this.renderTextSize();
		this.applyTextSize();
		this.renderBackground();
		this.applyBackground();
		this.renderScore();
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

	fetchSpecies() {
		httpGetJson(this.state.serviceUrl + "/species",
			(data) => {
				this.species = data.species || {};
				if (this.view === "lifelist") this.renderLifelist();
			},
			() => { this.species = null; });
	}

	poll() {
		httpGetJson(this.state.serviceUrl + "/contacts",
			(data) => {
				this.snapshot = data;
				// The service runs happily without the sim, so "reachable" and
				// "has data" are two different things and must read differently.
				this.setStatus(data.connected === false ? "nosim" : "ok");
				if (!this.species) this.fetchSpecies();
				if (this.view === "hunt") this.renderHunt();
				this.updateSpotButton();
			},
			() => {
				this.snapshot = null;
				this.setStatus("noservice");
				this.updateSpotButton();
			});
	}

	setStatus(status) {
		if (this.status === status) return;
		this.status = status;
		this.online = (status === "ok");
		this.nodes.offline.classList.toggle("hidden", status === "ok");

		if (status === "nosim") {
			this.nodes.offlineTitle.textContent = "Waiting for the simulator";
			this.nodes.offlineBody.textContent =
				"The data service is running. Contacts appear once you are in a flight.";
			this.nodes.offlineCmd.classList.add("hidden");
		} else if (status === "noservice") {
			this.nodes.offlineTitle.textContent = "Data service not running";
			this.nodes.offlineBody.textContent =
				"Start it in a terminal, then this panel connects on its own.";
			this.nodes.offlineCmd.classList.remove("hidden");
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
	// decided here, and the species name is never among it.
	describeContact(contact) {
		const tier = this.tierFor(contact.distance_m);
		const size = SIZE_WORDS[contact.size] || "an animal";

		if (tier === "sector") {
			return {
				what: "Movement",
				where: "somewhere " + sectorOf(contact.bearing_deg),
				range: "",
			};
		}

		if (tier === "coarse") {
			return {
				what: size,
				where: "bearing " + String(quantise(contact.bearing_deg, 30)).padStart(3, "0") + "°",
				range: distanceBracket(contact.distance_m),
			};
		}

		if (tier === "fine") {
			const herd = contact.count > 1
				? contact.count + " of them"
				: "on its own";
			return {
				what: size + ", " + herd,
				where: "bearing " + String(quantise(contact.bearing_deg, 10)).padStart(3, "0") + "°",
				range: roundTo(contact.distance_m, 100) + " m",
			};
		}

		// close
		const count = contact.count > 1
			? contact.count + " " + plural(contact.count, "animal", "animals")
			: "A single animal";
		return {
			what: count,
			where: "your " + contact.clock + " o'clock, " + (contact.above ? "high" : "low"),
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
	renderHunt() {
		const list = this.nodes.contactList;
		const contacts = (this.snapshot && this.snapshot.contacts) || [];

		if (!this.rows) this.rows = {};

		if (!contacts.length) {
			this.rows = {};
			list.innerHTML = "";
			this.cappedNote = null;
			this.nodes.huntEmpty.classList.toggle("hidden", !this.online);
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

		const seen = {};
		contacts.forEach((contact) => {
			seen[contact.key] = true;
			let row = this.rows[contact.key];
			if (!row) {
				row = document.createElement("div");
				row.dataset.key = contact.key;
				this.rows[contact.key] = row;
				this.fillRow(row, contact);
			}
			// appendChild moves a node that is already in the list, so this
			// reorders in place without recreating anything.
			list.appendChild(row);
		});

		Object.keys(this.rows).forEach((key) => {
			if (seen[key]) return;
			const row = this.rows[key];
			if (row.parentNode) row.parentNode.removeChild(row);
			delete this.rows[key];
		});

		this.renderCappedNote(list);
		this.updateHoldNote();
	}

	fillRow(row, contact) {
		const described = this.describeContact(contact);
		const logged = !!this.state.logged[contact.key];
		const near = contact.distance_m <= SPOT_RANGE_M;
		// Anything in range can be tapped to identify it. That is far more
		// discoverable than the SPOT button alone, and it is the only
		// practical interaction in VR, where typing is not an option.
		const clickable = near && !logged;
		row.className = "contact" + (near ? " is-near" : "")
			+ (logged ? " is-logged" : "")
			+ (clickable ? " is-clickable" : "");
		row.innerHTML = "<div class=\"contact-desc\">"
			+ "<span class=\"contact-what\">" + described.what + "</span>"
			+ "<span class=\"contact-where\">" + described.where + "</span>"
			+ "</div>"
			+ "<span class=\"contact-range\">" + described.range + "</span>"
			+ (logged
				? "<span class=\"contact-tag is-logged\">logged</span>"
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
		return this.pointerOverList || Date.now() < this.listHeldUntil;
	}

	holdList() {
		this.listHeldUntil = Date.now() + LIST_HOLD_MS;
	}

	updateHoldNote() {
		const note = this.nodes.listHold;
		if (note) note.classList.toggle("hidden", !this.listHeld());
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

		if (this.state.logged[contact.key]) {
			this.setSpotHint("Already identified: " + contact.common + ".", false, true);
			return;
		}
		if (contact.distance_m > SPOT_RANGE_M) {
			this.setSpotHint("Too far to be sure. Get within "
				+ SPOT_RANGE_M + " m of it.", true, true);
			return;
		}
		this.openQuiz(contact);
	}

	eligibleContacts() {
		const contacts = (this.snapshot && this.snapshot.contacts) || [];
		return contacts.filter((contact) => {
			if (this.state.logged[contact.key]) return false;
			if (contact.distance_m > SPOT_RANGE_M) return false;
			const relative = contact.relative_bearing_deg;
			const offNose = Math.min(relative, 360 - relative);
			return offNose <= SPOT_CONE_DEG || contact.distance_m <= SPOT_OVERHEAD_M;
		});
	}

	updateSpotButton() {
		const cooling = Date.now() < this.spotBlockedUntil;
		const usable = this.online && !cooling && !this.quiz;
		this.nodes.spotBtn.disabled = !usable;

		if (!this.online) {
			this.setSpotHint("Waiting for the data service.", false);
		} else if (cooling) {
			const left = Math.ceil((this.spotBlockedUntil - Date.now()) / 1000);
			this.setSpotHint("Lost it. Try again in " + left + "s.", true);
		} else if (!this.quiz) {
			this.setSpotHint("Tap a contact to identify it, or press SPOT "
				+ "for the nearest.", false);
		}
	}

	setSpotHint(text, isMiss, hold) {
		// Without the hold, the once-per-second poll calls updateSpotButton and
		// wipes one-off feedback before it can be read.
		if (!hold && Date.now() < this.hintHeldUntil) return;
		if (hold) this.hintHeldUntil = Date.now() + HINT_HOLD_MS;
		this.nodes.spotHint.textContent = text;
		this.nodes.spotHint.classList.toggle("is-miss", !!isMiss);
	}

	attemptSpot() {
		const eligible = this.eligibleContacts();
		if (!eligible.length) {
			this.spotBlockedUntil = Date.now() + SPOT_COOLDOWN_MS;
			this.state.score = Math.max(0, this.state.score - MISS_PENALTY);
			this.saveState();
			this.renderScore();
			this.updateSpotButton();
			return;
		}
		eligible.sort((a, b) => a.distance_m - b.distance_m);
		this.openQuiz(eligible[0]);
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
		this.rows = {};
		this.cappedNote = null;
		this.nodes.quizOverlay.classList.remove("hidden");
		this.updateSpotButton();
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
		this.updateSpotButton();
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
		this.state.logged[contact.key] = true;
		delete this.state.attempts[contact.key];

		const alreadyHave = !!this.state.lifelist[contact.species];
		let points = 0;

		if (!gaveUp) {
			const base = RARITY_POINTS[contact.rarity] || 25;
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
		this.updateSpotButton();
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
		bits.push(RARITY_LABEL[contact.rarity] || "");
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

	renderLifelist() {
		const table = this.species;
		const found = this.state.lifelist;
		const foundCount = Object.keys(found).length;

		if (!table) {
			this.nodes.lifelistStats.innerHTML = "";
			this.nodes.lifelistBody.innerHTML =
				"<p class=\"region-head\">Species list unavailable — "
				+ "waiting for the data service.</p>";
			return;
		}

		const total = Object.keys(table).length;
		const rare = Object.keys(found).filter((r) => table[r] && table[r].rarity === 4).length;
		this.nodes.lifelistStats.innerHTML =
			"<div><b>" + foundCount + " / " + total + "</b>species</div>"
			+ "<div><b>" + rare + "</b>rare subspecies</div>"
			+ "<div><b>" + Math.round(this.state.score) + "</b>points</div>";

		const byRegion = {};
		Object.keys(table).forEach((root) => {
			const region = table[root].region || "Global";
			(byRegion[region] = byRegion[region] || []).push(root);
		});

		const regions = Object.keys(byRegion).sort((a, b) => {
			const ia = REGION_ORDER.indexOf(a), ib = REGION_ORDER.indexOf(b);
			return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
		});

		const html = [];
		regions.forEach((region) => {
			const roots = byRegion[region].sort((a, b) =>
				table[a].common.localeCompare(table[b].common));
			const got = roots.filter((r) => found[r]).length;
			html.push("<p class=\"region-head\">" + region
				+ " · " + got + " of " + roots.length + "</p>");
			roots.forEach((root) => {
				const info = table[root];
				const record = found[root];
				html.push("<div class=\"life-row" + (record ? " is-found" : "") + "\">"
					+ "<span class=\"life-name\">"
					+ (record ? info.common : "—")
					+ (record ? " <span class=\"life-sci\">" + info.scientific + "</span>" : "")
					+ "</span>"
					+ "<span class=\"rarity r" + info.rarity + "\">"
					+ (RARITY_LABEL[info.rarity] || "") + "</span>"
					+ "<span class=\"life-when\">" + (record ? record.first : "") + "</span>"
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

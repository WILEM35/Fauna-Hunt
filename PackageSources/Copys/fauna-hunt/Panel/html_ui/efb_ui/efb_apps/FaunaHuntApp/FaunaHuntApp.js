// Fauna Hunt, as an app inside the in-aircraft EFB.
//
// The EFB is drawn with the Avionics Framework and the game is plain DOM, so
// the two do not meet directly. They do not have to: the app renders a single
// iframe pointing at the panel's own page, exactly as Little Navmap VR does.
// One game, one codebase, two windows onto it -- and the toolbar panel is
// untouched, which was the condition attached to this request.
//
// The registration contract is not documented anywhere. It was read off the two
// EFB apps installed on this machine (Little Navmap VR and Navigraph SimBrief),
// which agree with each other:
//
//   * The sim scans html_ui/efb_ui/efb_apps/<Name>/ and loads <Name>.js.
//     There is no XML, no SPB and nothing to register.
//   * The file hands an App CLASS to window.EFB_API.use(). The container calls
//     `new` on it, then `_install(context)`, and shows it once that resolves.
//   * `internalName` must contain no whitespace -- the container throws if it
//     does, and the app silently never appears.
//
// The App base class below is a local copy of the one both of those add-ons
// bundle. It is not provided by the sim, which is why each of them ships its
// own.

(function (sdk) {
	"use strict";

	if (!sdk || !sdk.FSComponent) {
		console.error("Fauna Hunt EFB: the Avionics Framework is not available.");
		return;
	}

	const ROOT = "coui://html_ui/efb_ui/efb_apps/FaunaHuntApp";
	const PANEL_PAGE = "coui://html_ui/InGamePanels/FaunaHunt/FaunaHuntEfb.html";

	// The EFB's own enums, reproduced. COLD means the app is not started until
	// it is opened, SLEEP means it is left running when it is closed -- which is
	// what we want, since the game should keep tracking while you are looking at
	// a chart.
	const BootMode = { COLD: 0, WARM: 1, HOT: 2 };
	const SuspendMode = { SLEEP: 0, TERMINATE: 1 };

	// ------------------------------------------------------------ container

	// The same shim both installed EFB apps carry. If the sim has already put
	// its own container on the window -- which it does whenever the EFB is
	// present -- this defers to it and the class below is never used.
	let uid = 0;

	class Container {
		constructor() {
			this._uid = uid++;
			this._registeredAppsPromises = [];
			this._installedApps = sdk.ArraySubject.create();
		}

		static get instance() {
			return (window.EFB_API = Container._instance =
				window.EFB_API || Container._instance || new Container());
		}

		apps() { return this._installedApps; }

		allAppsLoaded() {
			return this._registeredAppsPromises.length === this._installedApps.length;
		}

		setBus(bus) { this.bus = bus; return this; }
		setUnitsSettingManager(m) { this.unitsSettingManager = m; return this; }
		setEfbSettingManager(m) { this.efbSettingsManager = m; return this; }
		setOnboardingManager(m) { this.onboardingManager = m; return this; }
		setNotificationManager(m) { this.notificationManager = m; return this; }

		loadCss(href) {
			if (document.querySelector("link[href*=\"" + href + "\"]")) {
				return Promise.reject(href + " already loaded.");
			}
			const link = document.createElement("link");
			link.rel = "stylesheet";
			link.href = href;
			document.head.append(link);
			return new Promise((resolve, reject) => {
				link.onload = () => resolve();
				link.onerror = reject;
			});
		}

		loadJs(src) {
			if (document.querySelector("script[src*=\"" + src + "\"]")) {
				return Promise.resolve();
			}
			const script = document.createElement("script");
			script.type = "text/javascript";
			script.src = src;
			document.head.append(script);
			return new Promise((resolve, reject) => {
				script.onload = () => resolve();
				script.onerror = reject;
			});
		}

		use(AppClass) {
			if (!this.bus) throw new Error("Bus has not been initialized yet.");
			const app = new AppClass();
			const context = {
				bus: this.bus,
				unitsSettingManager: this.unitsSettingManager,
				efbSettingsManager: this.efbSettingsManager,
				notificationManager: this.notificationManager,
				onboardingManager: this.onboardingManager,
				options: {},
			};
			const installed = app._install(context);
			this._registeredAppsPromises.push(
				installed.then(() => { this._installedApps.insert(app); }));
			return this;
		}
	}

	// ------------------------------------------------------------ app base

	class App {
		constructor() {
			this._isInstalled = false;
			this._isReady = false;
			this._favoriteIndex = -1;
			this.available = sdk.Subject.create(true);
			this.BootMode = BootMode.COLD;
			this.SuspendMode = SuspendMode.SLEEP;
		}

		async _install(context) {
			if (this._isInstalled) return Promise.reject("App already installed.");
			this._isInstalled = true;
			this.bus = context.bus;
			this._unitsSettingsManager = context.unitsSettingManager;
			this._efbSettingsManager = context.efbSettingsManager;
			this._notificationManager = context.notificationManager;
			this._onboardingManager = context.onboardingManager;
			this._favoriteIndex = context.favoriteIndex != null ? context.favoriteIndex : -1;
			this.options = context.options || {};
			await this.install(context);
			this._isReady = true;
			Coherent.trigger("EFB_APP_INSTALLED", this.name, this.internalName,
				"1.0.3", this.getVersion());
			return Promise.resolve();
		}

		async install() { return Promise.resolve(); }

		get isReady() { return this._isReady; }
		get internalName() { return this.constructor.name; }
		get compatibleAircraftModels() { return undefined; }
		get favoriteIndex() { return this._favoriteIndex; }
		set favoriteIndex(value) { this._favoriteIndex = value; }
		getIsSearchable() { return true; }
		getIsFavoritable() { return true; }
		getVersion() { return ""; }
	}

	// ------------------------------------------------------------ the view

	// One iframe, filling the app area. Everything inside it is the panel you
	// already have: same markup, same stylesheet, same game.
	class FaunaHuntAppView extends sdk.DisplayComponent {
		constructor() {
			super(...arguments);
			this.frameRef = sdk.FSComponent.createRef();
		}

		onOpen() {}
		onClose() {}
		onResume() {}
		onPause() {}

		render() {
			return sdk.FSComponent.buildComponent("iframe", {
				class: "FaunaHuntAppView",
				ref: this.frameRef,
				src: PANEL_PAGE,
			});
		}
	}

	// ------------------------------------------------------------ register

	Container.instance.use(class FaunaHuntApp extends App {
		constructor() {
			super(...arguments);
			this.BootMode = BootMode.COLD;
			this.SuspendMode = SuspendMode.SLEEP;
		}

		get name() { return "Fauna Hunt"; }
		get icon() { return ROOT + "/assets/app-icon.svg"; }

		async install() {
			// Rejects if it is already there, which happens on a soft reload.
			// Not a failure -- swallow it, or the app never finishes installing.
			try {
				await Container.instance.loadCss(ROOT + "/FaunaHuntApp.css");
			} catch (err) {
				/* already loaded */
			}

			// THIS is what makes the game work inside the EFB.
			//
			// The panel runs in an iframe, and an iframe's own message bus is
			// wired to nothing: it accepts calls and never hears back. Proven --
			// thirty polls, no reply, no error, with the toolbar window closed
			// so nothing else was competing.
			//
			// The bus belongs to the page the simulator loaded, which is this
			// one. Loading the service here gives the iframe an outer window to
			// borrow it from; see busCandidates() in FaunaInSim.js, which walks
			// out to the parent before trusting its own.
			if (typeof window.RegisterCommBusListener !== "function") {
				try {
					const loader = (Container.instance && Container.instance.loadJs)
						? Container.instance.loadJs.bind(Container.instance)
						: null;
					if (loader) {
						await loader("coui://html_ui/JS/Services/CommBus.js");
					}
				} catch (err) {
					// Not fatal here. The panel still loads and says plainly
					// that it is asking and hearing nothing, which is a far
					// better failure than a blank app.
					console.error("Fauna Hunt EFB: could not load the message "
						+ "bus service into the EFB page.", err);
				}
			}
			return Promise.resolve();
		}

		render() {
			return sdk.FSComponent.buildComponent(FaunaHuntAppView, { bus: this.bus });
		}
	});
})(typeof msfssdk !== "undefined" ? msfssdk : null);

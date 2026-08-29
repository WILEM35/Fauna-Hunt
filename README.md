# Fauna Hunt

A wildlife-spotting game for Microsoft Flight Simulator 2024, played from a
toolbar panel.

MSFS 2024 has 107 species of animal wandering the world. Fauna Hunt turns
finding them into the point of the flight.

It deliberately does **not** show you where the animals are. Developer mode can
already do that, and it removes the game. Instead the panel behaves like a
spotter calling contacts over the intercom — a compass sector at long range,
sharpening to an o'clock position once you are close — and it never names the
species. Working out what you are looking at is the game.

## Installing

Grab the latest zip from [Releases](../../releases), copy the
`wilem35-fauna-hunt` folder into your MSFS Community folder, and start the sim.
Open the paw print icon in the toolbar.

That is the whole installation. Nothing to run, no executable, no accounts, no
internet. The download is under a tenth of a megabyte.

Works in 2D and in VR.

## How it works

Two pieces, both inside the simulator:

```
  toolbar panel (HTML/JS)      UI, range fuzzing, scoring, lifelist
            |  CommBus
  module (WebAssembly)         asks the sim what animals are nearby
            |  SimConnect
  the simulator
```

The module hands over exact positions and does nothing else. All of the
deliberate vagueness is applied in the panel, in `describeContact()`, so
difficulty can be retuned by editing one file.

Up to version 1.2.2 this needed a separate program running alongside the sim,
because the call that finds animals cannot be made from a panel. It can be made
from a module inside the sim, which is what 2.0.0 does — and that removed the
executable, the antivirus warnings, and 20 MB of bundled Python runtime.

### Building it

No Visual Studio needed: the MSFS SDK ships its own compiler. `build.ps1` does
everything. Four linker settings are load-bearing and fail *silently* if wrong
— they are documented in `wasm/build-wasm.ps1`, and the one that cost the most
time is that a module must export `malloc` and `free` or the sim refuses to
load it, reporting nothing except one line in the developer console.

### Things learned the hard way

Documented properly in [DESIGN.md](DESIGN.md), but the short list:

- `SIMCONNECT_SIMOBJECT_TYPE_ANIMAL` exists only in the MSFS **2024** SDK. The
  2020 enum stops at `GROUND`.
- **Object IDs are single use.** The same animal streaming back into range gets
  a brand new ID, so sightings are keyed on species plus a position grid.
- **The `ANIMAL` query returns humans**, dinosaurs from crossover packs, and an
  `AnimalError` placeholder. An allowlist is mandatory — see `species.json`.
- Objects report **lat/lon 0,0 for a poll or two while streaming in**. Left in,
  they read as contacts 6000 km away travelling at Mach 800.
- **250 objects is a hard response cap.** In dense country you are seeing an
  arbitrary subset, so the panel never claims an area is empty.
- Fauna streaming radius **scales with altitude** — about 2.8 km on the deck,
  30 km at FL280. Climb to search, descend to identify.
- **Birds exist in numbers but cannot be reached.** The sim keeps them in a
  `FLYING_ANIMAL` container that no SimConnect object type maps to. Developer
  mode counted 50 of them overhead while `RequestDataOnSimObjectType` returned
  nothing for every index from 0 to 20, `ALL` included, and the WASM API offers
  no way to enumerate sim objects at all. Fauna Hunt therefore cannot see
  birds. The ostrich is a bird but flightless, so it sits under `ANIMAL` and
  does count.

## Building it yourself

Needs the MSFS 2024 SDK and Python 3.

```powershell
# build the package and deliver it
.\build.ps1

# wrap it up for distribution
.\package-for-testers.ps1
```

`build.ps1` refuses to run while the sim is open — `fspackagetool` builds by
launching its own copy of the game, and silently produces nothing if one is
already running.

## Layout

```
PackageSources/Copys/fauna-hunt/Panel/     the toolbar panel
PackageSources/Copys/fauna-hunt/Modules/   the compiled module
wasm/                                      the module's source and build
PackageSources/SPBs/                       toolbar registration
probe/                                     recon tools used to work out how
                                           the sim reports fauna
dev/                                       browser tests for the panel
```

## Licence

MIT — see [LICENSE](LICENSE).

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

Grab the latest zip from [Releases](../../releases) and follow the README
inside. Short version: copy the `wilem35-fauna-hunt` folder into your MSFS
Community folder, run `Service\FaunaHuntService.exe`, and open the paw print
icon in the sim's toolbar.

## Is it safe?

The helper program is not code-signed, so Windows SmartScreen will warn you the
first time you run it. That is what happens to any unsigned hobby program; it
is not a judgement about the file.

If you would rather not trust the executable, don't — everything it does is in
this repository, and you can run the Python source directly instead:

```
cd wilem35-fauna-hunt\Service
python fauna_service.py
```

Both do exactly the same thing. The service opens a socket on `127.0.0.1`,
reads animal positions out of the simulator through SimConnect, and serves them
to the panel. It makes no internet connections and writes nothing outside its
own folder.

## How it works

Three pieces:

```
  toolbar panel (HTML/JS)      UI, range fuzzing, scoring, lifelist
            |  HTTP on 127.0.0.1
  data service (Python)        SimConnect polling, herd grouping, filtering
            |  SimConnect
  the simulator
```

The service sends the panel *exact* positions. All of the deliberate vagueness
is applied in the panel, in `describeContact()`, so difficulty can be retuned
without touching the service or the sim.

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
- Only **one bird** exists in the whole sim (`Asobo PassiveAircraft Eagle`),
  filed under `AIRCRAFT`. The ostrich is a bird too, but flightless, so it sits
  under `ANIMAL`.

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
PackageSources/Copys/fauna-hunt/Service/   the data service
PackageSources/SPBs/                       toolbar registration
probe/                                     recon tools used to work out how
                                           the sim reports fauna
dev/                                       browser test harness for the panel
```

## Licence

MIT — see [LICENSE](LICENSE).

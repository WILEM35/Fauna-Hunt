# Fauna Hunt

A wildlife-spotting game for Microsoft Flight Simulator 2024, run from a
toolbar panel. The sim already has 41 species of animal wandering around;
this turns finding them into the point of the flight.

The design deliberately does *not* mark animals on a map. Dev mode can already
do that, and it removes the game. Instead the panel behaves like a spotter
calling contacts over the intercom: vague at range, sharper as you close, and
never quite telling you what you're looking at. Naming the species is your job.

---

## What the sim gives us

Established by reading the installed packages and the 2024 SDK headers:

| Fact | Where it came from |
|---|---|
| `SIMCONNECT_SIMOBJECT_TYPE_ANIMAL` exists | `MSFS 2024 SDK/SimConnect SDK/include/SimConnect.h:224` |
| ...and does **not** exist in the 2020 SDK | 2020 header stops at `GROUND` |
| 41 species packages (`fs24-microsoft-simobjects-animals-*`) | `StreamedPackages` |
| An eagle ships as a *passive aircraft* (`fs24-asobo-passiveaircraft-eagle`) -- but see the FLYING_ANIMAL finding below | `StreamedPackages` |
| Effects can be pinned to a sim object by id | `WASM/include/MSFS/MSFS_Vfx.h` — `fsVfxSpawnOnSimObject` |
| Arbitrary strings pass WASM <-> JS <-> external client | `WASM/include/MSFS/MSFS_CommBus.h`, `SimConnect.h:1130-1132` |

So mammals and birds need two different queries (`ANIMAL` and `AIRCRAFT`),
which lines up neatly with wanting them as two separate toggles.

Species seen so far: aardvark, anteater, antelope, bear, bison, bongo,
buffalo, camel, capra, capybara, cheetah, chimp, cow, crocodile, deer,
elephant, elk, gazelle, giraffe, gnu, goat, hippo, horse, hyena, kangaroo,
leopard, lion, llama, monkey, moose, ostrich, panda, reindeer, rhino, sheep,
tiger, vulpes, warthog, wolf, zebra.

---

## The hunt loop

1. The panel reports a contact, fuzzed by range (see below).
2. You fly toward it. The description sharpens as you close.
3. When you believe you have eyes on it, you press **SPOT**.
4. The game checks whether an unlogged animal sits inside your spot cone.
5. On a hit, you pick the species from a shortlist. You are not told first.
6. A brief VFX pulse on the animal confirms the find and shows you what you got.

Pressing SPOT at nothing costs a little score and a short cooldown. That is
what keeps you actually looking out of the window rather than mashing the
button across the savanna.

## Contact accuracy by range

This is the core dial. Everything else is decoration.

Retuned against the first probe run: fauna only exists within about 5 km of
the aircraft, so the whole table has to fit inside that.

| Your range | What the panel tells you |
|---|---|
| 3 - 5 km | "Movement, somewhere north-east." Sector only. No count, no size. |
| 1.5 - 3 km | Bearing +/-30 deg, distance as a bracket ("2 to 3 km"). Size class. |
| 600 m - 1.5 km | Bearing +/-10 deg, distance to nearest 100 m, herd count. |
| inside 600 m | O'clock position, high/low. Still no species. |

Difficulty presets scale the whole table:

- **Explorer** — tiers shift outward, bearings tighter. Good for learning what
  a distant giraffe actually looks like.
- **Tracker** — the table above.
- **Expert** — sector-only until 1 km, no herd counts, no size class.

## Identifying the species

The shortlist is the correct species plus decoys drawn from the same region,
so "it's obviously the only big one" never works. First-try correct scores
full; each wrong guess drops the value of the sighting.

This is the part that does what you originally wanted — it makes you look
carefully at a thing in the world and decide what it is.

## Scoring

```
points = rarity_weight
       * distance_at_spot_multiplier   (further out = harder = worth more)
       * difficulty_multiplier
       * first_try_id_bonus
       - hint_costs
```

Hints are available and always cost something: "narrow the bearing",
"tell me the size class", "eliminate two species".

## The lifelist

41 species, persistent across sessions, stored via the panel's
`SetStoredData` / `GetStoredData`. Each first sighting records species, date,
position, altitude and the aircraft you were flying. The lifelist is the
long-term hook — the reason to detour over the Serengeti on an airliner leg.

## Modes

- **Free roam** — whatever is around you, continuously.
- **Targeted** — "find a giraffe." The game picks a species it can see in the
  area and challenges you to reach it.
- **Safari clock** — as many distinct species as possible in 20 minutes.

---

## Architecture

Three small pieces, each doing only what it is definitely allowed to do:

```
  toolbar panel (HTML/JS)      UI, fuzzing, scoring, lifelist
            |  CommBus
  WASM module                  fsVfxSpawnOnSimObject / fsVfxDestroyInstance
            |  CommBus
  SimConnect client            RequestDataOnSimObjectType(ANIMAL / AIRCRAFT)
```

The fuzzing lives in the panel, not the data layer. The panel receives exact
positions and chooses how much to reveal — which means difficulty tiers can be
retuned without touching the SimConnect or WASM side at all.

Whether the enumeration can move inside the WASM module (collapsing three
pieces to two) depends on whether `RequestDataOnSimObjectType` is in the WASM
SimConnect subset. Unresolved.

## First probe run (2026-08-26, parked at Emden, group flight)

Settled:

- `ANIMAL` works and returns `cat=Animal`. Three species present over German
  farmland: cattle (`BTaurusPrimigeniusFemaleVariation2`), horses
  (`ECaballusMaleVariation3`), sheep (`OAriesAriesMale`).
- **Titles are Latin binomials with sex and variation suffixes.** The game
  needs a lookup table from title to a name a human would say.
- **Fauna streams in only within ~5 km** — nearest 2796 m, farthest 5136 m,
  against a 100 km request radius. That is the sim's own limit and it caps the
  whole hunt.
- **Nothing moved.** Every one of the 101 movers was FSLTL traffic at 234 m/s.
  Livestock stayed put, so contacts do not need re-fuzzing for drift.

Second run, slewing 25 km across the same area, overturned the id question:

- **Object ids are single use.** 1015 distinct ids in 120 s, never more than
  250 at once, and *not one* ever disappeared and came back. An animal that
  streams out and back in returns as a brand new id.
  **The lifelist must dedupe on species + position, never on object id.**
  A tolerance of a few hundred metres around a logged sighting should do it,
  since the livestock do not wander.
- **Objects report lat/lon 0,0 while they stream in**, for a poll or two,
  before their real position arrives. Unfiltered they read as contacts ~6000 km
  away closing at 285,000 m/s. The probe now drops these; so must the game.
- **250 is a hard return cap, not a fauna budget.** Counts of 35, 52, 97, 116,
  165 and 202 appeared once the dense farmland fell behind, but it pinned at
  exactly 250 whenever more were in range. In dense country the panel is seeing
  an arbitrary 250 of them, so "nothing else nearby" can never be asserted.
- Animals come as close as **145 m**.
- **`GROUND` returned nothing**, and no id appeared under two types. `ANIMAL`
  is its own clean query.
- Exactly 250 animals every single poll. Suspiciously round -- either a
  SimConnect return cap or a fixed fauna budget the sim maintains around the
  player. Worth pinning down, since it decides whether the panel can trust the
  list to be complete.
- Ten `AIRCRAFT` entries had no title and sat at lat/lon 0,0 (~5974 km away):
  uninitialised group-flight players. **Filter empty titles and null islands.**

## The species catalogue (settled)

`SimConnect_EnumerateSimObjectsAndLiveries` lists the whole installed
catalogue without flying anywhere. It returned **1005 raw animal titles**,
which `build_species_table.py` reduces to **107 species** in `species.json`.

- Titles follow `GenusSpecies[Subspecies][Sex][VariationN]`, e.g.
  `PTigrisAltaicaFemaleVariation2` -> Siberian tiger. Sex and variation are
  cosmetic; the species root is what the game keys on.
- Distribution is heavily African (41 species), then Asia (25), N.America (14),
  Arctic (8), Europe (6), S.America (5), Australia (2), Ocean (2). Only 4 are
  domestic. **42 of 107 are rare subspecies** -- five kinds of arctic fox, six
  brown bears, five wildebeest. That is a lifelist worth chasing.
- 87 titles are excluded: addon walking people (`ahqw`/`ahqm`), Jurassic World
  dinosaurs (`JW_`), a Stranger Things demogorgon, and addon livestock
  reskins. **The ANIMAL query returns humans**, so an allowlist is mandatory.
- `AnimalError` exists as a fallback object and must be filtered.

**Birds: unreachable, and my earlier conclusion here was wrong.**

The catalogue sweep found no bird titles under `ANIMAL` and I wrote that only
one bird existed. What that actually proved was that birds are not filed under
`ANIMAL` -- a different statement, and I should not have generalised it.

Developer mode's Containers window settles it: the sim keeps birds in a
`FLYING_ANIMAL` container, showing 50 of them overhead near Toronto while
`ANIMAL` read 0 in the same panel. `probe/type_sweep.py` then asked
`RequestDataOnSimObjectType` for every type index 0 to 20:

- types 10-20 are rejected outright (`INVALID_ARRAY`), so the enum really does
  stop at `USER_CURRENT`
- `ANIMAL` returned 248 objects (cattle, sheep, horses)
- `ALL` returned 271 -- the same 248 plus the user, its seats and a few others
- **not one flying animal appeared under any type, `ALL` included**

The WASM headers offer no alternative: `FsSimObjId` appears only as an input to
the camera and VFX calls, and nothing enumerates sim objects.

So `FLYING_ANIMAL` is simply not exposed to any public API. Birds cannot be
hunted, and no change to `species.json` or the query would help -- the data
never leaves the sim. Worth raising with Asobo as an SDK gap; until then, treat
the ostrich (`SCamelus`, flightless, filed under `ANIMAL`) as the only bird in
the game.

A second oddity, noted in passing: developer mode's container counts and
SimConnect's object types are different taxonomies. The Containers window said
`ANIMAL (0)` at the same moment SimConnect returned 248 animals. Do not read
one as a check on the other.

## Open questions the probe answers

Run `probe/fauna_probe.py` in a flight over wildlife country.

1. **Do object ids churn?** If the sim recycles ids as fauna streams in and
   out, "already spotted this one" cannot key on id alone and must fall back
   to species + position. Decides the whole dedupe strategy.
2. **How far out does fauna stream in?** Caps the outermost accuracy tier. No
   point describing contacts at 8 km if the sim only spawns them at 3.
3. **Do the animals move, and how fast?** A herd that drifts while you fly a
   20 km intercept changes how stale a contact can be before it is re-fuzzed.
4. **Are birds really under `AIRCRAFT`?** And can they be told apart from real
   traffic by title alone.
5. **Is `ANIMAL` a subset of `GROUND`?** If so, one query may cover more.
6. **Does `dwObjectID` match WASM's `FsSimObjId`?** The linchpin of the VFX
   reveal. Not answerable from the probe alone — needs a WASM test.

## Known issues

- ~~Toolbar icon is invisible at night.~~ FIXED in 1.0.0: the sim only tints
  `path` and `rect` elements, so the `ellipse`-based paw stayed black. Redrawn
  using `path` only, with no `fill` attribute so it inherits like stock icons.
  Original note: `ICON_TOOLBAR_FAUNA_HUNT.svg` is
  filled `#000000`, copied from the Flight Data Tiles icon, but renders dark
  against the dark toolbar while the stock icons render light. Confirmed on
  the 2026-08-26 build. Fix at the next build -- compare against a stock
  toolbar SVG to work out what makes the sim tint an icon light, rather than
  just recolouring and hoping.

## Distribution

Testers need Python installed. `Service\Start Fauna Hunt Service.bat` hides
the command line from them, but not the dependency. If that proves to be a
barrier, bundle the service as a standalone .exe (PyInstaller) so there is
nothing to install at all.

## Versioning

MAJOR.MINOR.PATCH, and the number lives in exactly one place:
`PackageDefinitions\wilem35-fauna-hunt.xml`. `package-for-testers.ps1` reads it
from there, so the zip name can never drift from what the sim reports.

- **1.0.1, 1.0.2 ...** fixes and small tweaks
- **1.1.0** a real new feature, or a noticeable change to how it plays
- **2.0.0** a rewrite, or anything that breaks existing saves

Bump the number in the package definition before running the build.

## Build gotcha: fspackagetool outlives the build

The tool builds by launching its own copy of the game. That instance comes up
showing an error and stays on screen until it is closed by hand, so
`fspackagetool.exe` remains in the process list long after the package is
finished and written.

Never treat the process exiting as the signal that a build completed, and never
wait for it. Check the artefacts: `manifest.json`'s `package_version`, or grep
the built panel for whatever just changed. Waiting on the process has twice cost
several minutes and once produced a false "no package was produced".

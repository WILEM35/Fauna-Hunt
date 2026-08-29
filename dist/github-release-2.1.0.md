# GitHub release notes — v2.1.0

Paste into the release body. Title it:

    Fauna Hunt 2.1.0 - no helper app required

---

## The helper app is gone

Fauna Hunt used to need a second program running alongside the simulator. It
read the animal positions and fed them to the panel, and it was the source of
every awkward thing about installing this: a black window you had to leave
open, a Windows SmartScreen warning, antivirus flagging an unsigned executable,
and a 20 MB download mostly made of bundled Python.

**All of that is gone.** The work now happens inside the simulator itself.

Copy one folder into Community, start the sim, done. Nothing to run and nothing
to allow through anything.

## If you were testing 1.2.x

* **Delete the old folder first**, then copy the new one in. Do not merge them.
* **Stop using `FaunaHuntService.exe`** — it no longer exists and is not needed.
* **Your score and lifelist are kept.** They live in the simulator's own save
  data and are untouched by any of this.

## What else changed

* **VR: you can now identify from any direction.** Previously the game checked
  that you were looking at the animal, which in VR meant pointing the aircraft
  at it — the simulator will not tell add-ons where a headset is aimed. Rather
  than enforce a rule that measures the wrong thing, it is off in VR. In a 2D
  cockpit view it works as before.
* **Settings shows the version**, so it is obvious which build is running.
* The panel reports a fault plainly if it ever hits one, instead of showing an
  empty list and letting you go hunting for animals that were never the
  problem.

## Known limitations

* **No birds.** The simulator keeps its flying animals somewhere add-ons cannot
  reach. Ground animals only.
* **MSFS 2024 only.** The animal data does not exist in 2020.

## Install

1. Download `FaunaHunt-v2.1.0.zip` below.
2. Copy the `wilem35-fauna-hunt` folder into your Community folder.
3. Start MSFS 2024 and click the paw print in the toolbar.

Good places to hunt: HTSN Seronera (Serengeti), HKAM Amboseli, FASZ Skukuza.
Turn up the simulator's own **Fauna** graphics setting for more to find — it is
set separately for normal and VR.

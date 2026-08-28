# Backlog

Things to do, collected as they come up and batched into occasional releases
rather than shipped one at a time.

**How this works.** Mention something and it gets written here, not built. When
there is enough to be worth a release, we work through it, tick the items off,
and move them to Done with the version they shipped in.

Status: `[ ]` waiting · `[~]` in progress · `[x]` done

---

## Open

### [ ] Close button and pop-out on the panel header

The panel header shows the title and nothing else. Other toolbar panels in the
sim have a close (X) and a pop-out control, so people expect them and their
absence reads as the panel being broken or unfinished.

**Investigated 2026-08-27, not solved.** Nothing in the MSFS 2024 SDK mentions
it: no InGamePanel schema ships, and `InGamePanelDefinition` has no documented
attribute for window controls. None of the seven installed third-party panels
uses such an attribute either.

One lead worth trying: two of the installed panels (`pms50-gtn750`,
`vatsimradar-vr-viewer`) set `class="ingameUiFrame panelInvisible"` on their
`<ingame-ui>` element, and `ingameUiFrame` looks like the sim's own
window-frame class. Ours sets no class at all. Trying `class="ingameUiFrame"`
alone is cheap and might bring the standard chrome with it.

Second possibility worth ruling out: our own CSS may be *hiding* controls that
are already there. `FaunaHunt.css` puts `overflow: hidden !important` on
`.ingameUiWrapper` and `.ingameUiContent` to fix the height problem, and the
header sits inside that wrapper.

Either way this needs trying in the sim rather than reasoning about — it cannot
be verified from the harness, and a wrong guess breaks the panel header.

**Lead 1 tested in 1.0.3: no.** `class="ingameUiFrame"` brought no close or
pop-out control. It did bring an opaque backing that made even the clearest
background setting look like frosted glass, so `panelInvisible` was added
alongside it to remove that.

**Last lead applied in 1.1.0**: `.ingameUiWrapper` no longer clips
(`overflow: visible`), since that wrapper holds the sim's own title bar.
Containment still works, so the height fix is not undone.

If the header still has no controls after this, close this item as NOT
POSSIBLE. Every mechanism I can find has been tried, the SDK documents none,
and no installed third-party panel has them either.

### [~] "You have to be looking at it" — camera-direction gating

Identifying currently needs only proximity. Requiring the player to actually
have the animal in view would restore what the removed SPOT button was
reaching for, and it is how the sim's own career-mode rescue missions appear
to work.

It must key off **where the player is looking, not where the aircraft is
pointing** — the old SPOT cone used `PLANE HEADING DEGREES TRUE`, which is
useless in VR, where you can be looking straight down at an animal while the
nose points elsewhere.

MSFS 2024's SimConnect has what looks like the right API:

```
SimConnect_CameraGet(handle, referential)
  -> SIMCONNECT_DATA_CAMERA { Position, Pbh, TargetedPos, Fov, ... }
```

`Pbh` is the camera's own pitch/bank/heading and `Fov` its field of view, so
the cone could match what is genuinely visible rather than an invented number.

**Probe written: `probe/camera_probe.py`** (1.1.0). It never acquires the
camera, so if readings come back at all then reading is free.

**PROVED VIABLE, 2026-08-27.** All three answered:

1. **It follows the view, not the aircraft — in VR as well as 2D.** Parked on
   25.5 in 2D, the camera read 25.504 looking straight ahead. In the headset,
   parked on 25.7, head turns swung it across 269 degrees and pitch across 76
   while the aircraft never moved. Roll tracks head tilt.
   The ~15 degree offset seen in the VR run was simply the player sitting off
   centre, not recentred — not an offset in the data. Nothing to correct.
2. **No acquire needed.** Status reported NOT_ACQUIRED and data flowed anyway,
   so reading never touches the player's camera control.
3. **~3.3 readings/sec**, ample.

Details that cost time and should not be re-derived:
- `SIMCONNECT_RECV_CAMERA_DATA` is **96 bytes and PACKED** — ctypes pads it to
  104 by default, and every message is silently dropped as too short.
- `SIMCONNECT_DATA_PBH` is three **floats**, not doubles.
- Despite the header naming them Pitch/Bank/Heading, the **middle float is the
  compass direction the view faces** and the third is roll. All in **degrees**,
  world-referenced (rotRef 2). FOV comes back in radians: 1.26 (~72 deg) in 2D, 1.571 (90 deg) in VR.

Still to design: cone width (FOV is available, so it can match what is really
visible), whether looking is required to identify or only to score, and how the
tile shows that you are not looking at it yet.

### [x] Recognise known species — optional — 1.1.0

Settings > Known species. "Ask every time" (default) keeps today's behaviour:
identification is per herd, so a species you know still has to be worked out
again at a new location, and still scores at the repeat rate. "Recognise on
sight" names any herd of a species already on your lifelist the moment it
appears, anywhere — those tiles are done and score nothing.

The trade is deliberate and stated in the blurb under the control: you give up
repeat points in exchange for a list where anything still vague is something
you have never seen.

### [x] Name the animal on the tile once it has been identified — 1.1.0

An identified contact still reads "a large animal, on its own" — the same
deliberately vague description it had before you knew what it was. Once you
have named it, that vagueness has no purpose and the tile should say what it
actually is: "Hartmann's Mountain Zebra, on its own".

The species name is already on the contact (`common`), and `describeContact()`
already knows whether it is logged via `isLogged()`, so this is a small change
to that one function — the vague wording just needs to stop applying once the
answer is known.

*Worth deciding at the same time:* whether the size and count wording stays
alongside the name, or whether an identified tile switches entirely to
"Hartmann's Mountain Zebra x1". Naming it makes the lifelist far more useful to
read back against the world.

---

## Done

### [x] Remove the SPOT button — 1.0.3

It picked a contact using a 45-degree cone test the player was never shown,
and fined them five points and an eight-second cooldown when it found nothing.
Nothing indicated which contact it would choose. Tapping a tile does the same
job and says which animal it means. Removed along with the whole miss-penalty
mechanic; the bar it sat in stays for the status line and the "list held"
badge.

Nothing yet — 1.0.0 through 1.0.3 predate this file.

## Replace the helper app with an in-sim module (investigated 2026-08-28)

**Verdict: feasible.** Everything the game reads can be read from inside the
sim by a WebAssembly module, which would remove the external helper entirely
-- no window to leave open, no antivirus warnings, no exe to distribute.

Evidence, all gathered locally:

| need | how | status |
|---|---|---|
| find the animals | `SimConnect_RequestDataOnSimObjectType` | **proven** -- an installed add-on (`bkiel-efb-lnm-vr.wasm`) already imports it |
| where the player looks | `fsCameraGet` (`MSFS_Camera.h`) | native WASM call, no SimConnect needed -- gives pitch/bank/heading + FOV |
| talk to the panel | `fsCommBusCall` / `fsCommBusRegister` | **proven** -- the base sim's own `FCR_Embedded_System.wasm` imports both |
| write files | `fsIOWrite` (`MSFS_IO.h`) | available if the module ever needs to persist anything itself |

A module calling all three compiles and links today with the SDK's own clang --
no Visual Studio. See `wasm/build-wasm.ps1`; the two flags that are easy to get
wrong are documented in it.

**Player saves are not at risk.** The lifelist and score go through
`GetStoredData`/`SetStoredData`, which is the sim's own save system and has
nothing to do with the helper. The panel keeps them across this change --
only the line that fetches contacts (`DEFAULT_SERVICE_URL`) is replaced.

Still unproven: that ANIMAL specifically returns data through the WASM path,
and that `fsCameraGet` resolves at load. Both need a build with the sim closed.


## Lifelist columns run together (found in 1.2.1, fixed in source)

"1 of 5CAPTUREDregional" -- no space between the variant count, the state and
the rarity. The rows asked for spacing with flex `gap`, and in the sim that had
no effect whatsoever.

Not a blanket lack of support: the sim's own menus and several cockpit
instruments use flex gap in em units and render fine. But no in-game toolbar
panel anywhere in the sim uses it. Cause unconfirmed; rather than keep guessing,
all `gap` declarations are gone and margins do the job -- which also removes the
risk of the two stacking into a double space later.

Affected ten rows of the panel, not just the lifelist: tabs, contacts, the
status bar, the stats strip, quiz buttons and the pills.

**The harness cannot catch this.** It runs in a real browser where gap works.
Spacing has to be judged in the sim.

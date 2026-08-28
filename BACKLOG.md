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

### [ ] "You have to be looking at it" — camera-direction gating

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

*Three things it answers:*
1. Does it follow the VR headset, or only the 2D camera?
2. Does reading it require `SimConnect_CameraAcquire`? If reading needs taking
   camera control from the player, the feature is dead — that is not
   acceptable in a spotting game.
3. Does it update at head-turn speed, or only aircraft-turn speed?

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

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

Remaining lead: our own `overflow: hidden !important` on `.ingameUiWrapper` and
`.ingameUiContent` may be clipping controls that exist. If that is not it
either, the honest conclusion is that these controls are not offered to
third-party panels, and this should be closed as not possible.

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

*Three things to prove with a probe before designing the mechanic:*
1. Does it follow the VR headset, or only the 2D camera?
2. Does reading it require `SimConnect_CameraAcquire`? If reading needs taking
   camera control from the player, the feature is dead — that is not
   acceptable in a spotting game.
3. Does it update at head-turn speed, or only aircraft-turn speed?

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

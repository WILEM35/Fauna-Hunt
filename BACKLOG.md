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

## In-sim probe built (2026-08-28)

A separate throwaway package, `wilem35-fauna-probe` (source: `C:\Tools\fauna-probe`),
answers the one remaining question: does the animal data actually arrive inside
the sim, and does the view direction read correctly. It shares nothing with
Fauna Hunt and cannot affect it.

It is driven by its panel rather than a timer, because a standalone module gets
no tick of its own and the alternative -- a dispatch callback -- has a signature
that differs between the desktop and WebAssembly builds of SimConnect. Polling
with `GetNextDispatch` sidesteps that; a shipping add-on here already imports it.

Delete the package once the question is settled.

## Herd counts collapse when you land inside one (reported 2026-08-28)

Landed in the middle of roughly 42 sheep. Before they could be identified the
display changed to two contacts -- 14 and 8 -- lying about 180 degrees apart,
while sheep were plainly visible on the ground in every direction. The counts
and the directions both disagreed with what was out the window.

NOT investigated yet; reported for watching. Worth checking, in rough order of
suspicion:

* Grouping is proximity-based. Standing INSIDE a herd is the one case the
  clustering was never designed for -- animals surround you rather than sitting
  in a clump ahead, so a split into two opposed groups is exactly what a naive
  cluster would produce.
* Whether animals closer than some threshold fall out of the list entirely.
* Whether the 250-object cap or the request radius is trimming the herd.
* Whether the two contacts even account for all 42, or the rest vanished.

The lesson from the last few of these: reproduce it before changing anything.

## View direction may not need the camera call at all (2026-08-28)

`CAMERA GAMEPLAY PITCH YAW` (index 0 = pitch, 1 = yaw) is an ordinary
simulation variable. The F/A-18's helmet-mounted display reads exactly those
two to know where the pilot is looking, in VR included -- the same problem
Fauna Hunt solves today with SimConnect's camera call, which only an external
program can make.

If it holds up, the panel reads its own view direction with one line and the
WASM module never touches the camera. `probe/camera_simvar_probe.py` tests it
against a running sim; it needs the sim up, so it has not been run yet.

This matters because `fsCameraGet` is the last unexplained import in the probe
module, and the likeliest reason the sim refuses to load it.

### Result: the variables DO track the view (tested 2026-08-28, live)

Run side by side against the camera call we already trust:

| | moved over 16s |
|---|---|
| variable yaw | 67.0 deg |
| camera call heading | 68.2 deg |
| aircraft heading | 24.1 deg |

Two things to get right when using it:

1. **It is measured from the aircraft nose, not from north, and the sign is
   inverted.** World direction = aircraft heading MINUS the yaw variable.
   Checked against the camera call on several samples: aircraft 60.3 with yaw
   67.0 gave a camera heading of -6.45, and 60.3 - 67.0 = -6.7. Matches.

2. **It only reads in the cockpit.** Camera mode 2 gave live numbers; modes 3
   and 5 (external and drone views) both sat at exactly 0.00. So outside the
   cockpit the panel would think the player is looking straight ahead. That is
   tolerable -- the game is played from the cockpit and in VR -- but the panel
   should read CAMERA STATE too and simply not gate on view direction when the
   player is in an outside view, rather than gating on a wrong answer.

The consequence is the good part: **view direction needs neither the helper app
nor the WASM camera call.** The panel reads it directly. That removes the last
unknown from the in-sim plan, and it is why the probe module now drops
fsCameraGet entirely.

### The module was failing to load because it exported no allocator

The sim's console said it outright:

    WASM: Compiled module faunaprobe.wasm in 0 seconds
    WASM: Error get malloc function pointer in module faunaprobe.wasm

It compiled fine, then the sim looked for `malloc` inside it and gave up. The
sim allocates inside a module's own memory to hand it strings, so every module
must export `malloc` and `free`. MobiFlight's exports both; mine exported
neither, because nothing in the code called them and the linker had no reason
to include them. `-u malloc -u free` forces them in, `--export=` publishes them.

Worth remembering how long this took by comparing files: three rounds of
plausible-but-wrong guesses (the version handshake, symlinked folders, the
camera call), against about a minute once the console was open. The console is
the first stop for a module that will not load, not the last.

## PROVEN: the game can run entirely inside the sim (2026-08-28)

The probe passed on a live flight with the helper app closed:

    OK  Module reached SimConnect              open
    OK  Animals found from inside the sim      246 nearby
    --  Knows where you are looking            not in this build
    Example: CTaurinusAlbojubatusFemale

All three capabilities are now confirmed on this machine:

1. **Finding animals** -- the module enumerated 246 and returned real titles.
2. **Reaching the panel** -- that result travelled over CommBus to the panel.
3. **View direction** -- proven separately, and it needs neither the helper nor
   the module: the panel reads it itself.

The helper app can be removed.

### Suggested shape for the migration

Keep the module THIN. It should enumerate animals and hand them to the panel,
nothing else. All the grouping, rarity, fuzzing and scoring stays in the panel,
in JavaScript, where it already lives.

Reasons: it is the smallest amount of C++ to write and maintain; the fuzzing
stays in the panel layer, which is a standing design rule; and difficulty stays
retunable by editing one file.

Open questions to settle before starting:

* **How much data can one CommBus message carry?** 246 animals is a lot of
  text. May need chunking, or trimming the fields sent.
* **What poll rate is sane** from inside the sim, versus the current 1 second.
* **Where the species table lives** so the panel can read it -- it can sit in
  `html_ui` and be fetched, but that needs checking.

Nothing here threatens saves: the lifelist and score go through the sim's own
save system and do not touch the helper.

## 1.3.0 -- the in-sim path, built and tested on the bench

Delivered and ready for a flight. The panel asks the in-sim module first and
falls back to the helper if it does not answer, so this cannot make things
worse than 1.2.2.

`dev/run-insim-test.ps1` runs 28 checks against the translator with a made-up
reply from the module -- herd grouping, junk rejection, distances, bearings,
the response cap, torn replies, and the view rule. All pass. There is no
JavaScript runtime on this machine, so they run in headless Chrome.

Two things worth writing down, both found by those tests:

* **Two of my first three "failures" were the test being wrong, not the code.**
  With the aircraft at 1500 ft and animals 200 m away, they sit 59 degrees
  below the horizon -- so staring at the horizon really is ~58 degrees off.
* **Looking steeply down widens the yaw tolerance a lot.** At 59 degrees
  nose-down, 90 degrees of yaw separates the two directions by only ~43, which
  is inside the cone. Correct 3D geometry, and identical to what the helper has
  always done, so not a regression -- but if view gating ever feels too
  generous when flying low over a herd, this is why.

### Also fixed: three paths in build.ps1 had eaten backslashes

`Copys\fauna-hunt` had become `Copys` + a formfeed, and two script paths had
lost theirs to a backspace -- damage from earlier edits where a backslash was
read as an escape. They were invisible in the file and in most greps.

Two had been broken for several releases, and one of them is why the service
exe was never rebuilt automatically -- which is how a crashing service reached
a release. Worth checking for control characters after any scripted edit of a
Windows path.

## 1.3.1 -- the look-at rule in VR

Tested in a headset: the gameplay pitch/yaw variables DO NOT track the head.
They report the aircraft's direction, so identifying an animal in VR meant
pointing the aeroplane at it. In 2D they were flawless -- mouse look, built-in
views and joystick-mapped views all worked.

The fix is the camera call, `fsCameraGet`, put back into the module. It was
dropped earlier while hunting the module load failure and never actually
cleared: the real cause was the missing `malloc` export, so the camera call was
never the problem. It is the same call the old helper used, and that one
demonstrably followed the headset -- the 15-degree error once traced to sitting
off-centre in the seat is the proof.

The panel now prefers the module's camera and falls back to the variables when
there is none, so 2D keeps working exactly as it did.

The SDK does not document what units the camera call returns, so the panel
decides from the field of view: nothing sane is 60 radians wide or 1 degree
wide. An absurd field of view is treated as "this reading is not what I think
it is" and the fallback is used -- a wrong view direction is worse than none.
The field of view is now measured rather than assumed, so the cone adapts
between 2D and VR by itself.

Bench tests cover both unit conventions, the precedence, and the fallback.

## A syntax error shipped a blank panel (1.3.2)

The panel came up with tabs, a score of zero and nothing else. That is what a
BROKEN SCRIPT looks like, not lost data: if any panel script fails to parse,
the custom element never registers and the sim renders the bare HTML.

Cause: an edit left a real newline inside a string literal --
`].join("` then an actual line break. Same family as the eaten backslashes in
build.ps1, and invisible for the same reason.

Two things let it reach the sim:

1. The bench tests only load the translator, not the panel, so they passed.
2. Nothing ever checked that the panel scripts parse.

`probe/check_js.py` now parses all three panel scripts and also refuses control
characters left by a mangled edit. `build.ps1` runs it and will not build if it
fails. Fixed in 1.3.3.

**Lesson: passing tests said nothing about the file that was actually broken.**
Check the artefact that ships, not only the part under test.

## SETTLED: the sim does not expose VR head direction to add-ons

Tested every reference point the camera call offers -- none, aircraft, world,
eyepoint, datum -- reported side by side in a headset. All five agree with each
other to within about a degree, and all five follow the AIRCRAFT.

The clean proof came from turning the helicopter 90 degrees while looking at the
same animals throughout: the reading moved with the aircraft and ignored the
head completely. Off view went from 83.8 (out) to 8.6 (in) purely because the
nose moved.

Also ruled out along the way:

* `CAMERA GAMEPLAY PITCH YAW` -- perfect in 2D, reports the aircraft in VR.
* `fsCameraGet` at every referential -- as above.
* No VR or head-tracking variable exists in the sim's own interface code.
* `FLYING_ANIMAL` appears nowhere in the SDK, so the same wall stands for birds.

**So the "look at the animal" rule cannot work in VR as intended.** The choice
is between gating on the aircraft's nose in VR, or not gating there at all.
2D is unaffected and works properly.

### Incidental, and worth acting on

Fauna density is set PER PROFILE and they differ: 2D is on 1 (lowest), VR on 3.
More fauna is a straight improvement to the game, and the 2D setting is costing
contacts for no reason. It is in the sim's graphics settings, not ours to change.

## 1.4.0 -- the view rule, decided

Only ONE reading is ever allowed to decide whether the player is looking at an
animal: the gameplay pitch/yaw variables, in a 2D cockpit view, where they are
correct and were never in doubt.

Everywhere else the rule is switched OFF rather than replaced:

* **In VR** -- the sim does not expose head direction. Gating on the nose would
  mean flying AT an animal to identify it, which is not the game.
* **In external and drone views** -- there is no reading at all.

The module's camera is still read and still shown in the diagnostic, but it
never steers the rule. It reports the aircraft, and a rule the player cannot
see steering by the wrong thing is worse than no rule.

The game is a minor version up because this changes how it plays: in VR,
identification is now range-only.

### Still to do before flightsim.to

* Remove the helper program from the package (20 MB, and the whole reason for
  the antivirus problem).
* Remove the View direction readout from Settings -- it was for diagnosis.
* Remove the "service not running" message and the Service address setting.
* Delete `wilem35-fauna-probe`.

## 2.0.0 -- the helper is gone

The package is now nine files and 0.27 MB, down from 20.2 MB. No executable, no
bundled Python runtime, nothing to run. Install is one folder copy.

Removed in this pass:

* The helper program and everything that built, shipped or referenced it.
* The View direction readout, which existed to settle the VR question.
* The "service not running" message and the Service address setting.
* The probe add-on.

The tester README lost its longest section -- "start the helper", the
SmartScreen warning, and the offer to send plain source instead.

**Caught during cleanup: deleting the Service folder also deleted
`species.json`, the source of all 107 species.** The generated copy in the
panel was fine, so nothing broke visibly -- the next build would have failed
instead. Restored from git to `data/species.json`, which is where it should
always have been: it is data the game is built from, not part of the helper.

Also caught: the earlier surgery on `build.ps1` had silently removed the
species-generation step, so the table would have gone stale without warning.
Restored and verified by a full rebuild.

### Still open

* Push to GitHub -- 20-odd commits behind, and the repo still carries the
  helper's bundled Python runtime in its history.
* An old `fauna-hunt` source folder is still sitting in the Utilities folder
  from 26 Aug. Not linked, no manifest, so the sim ignores it -- but it does
  not belong there.
* Add-on Linker still has a link for `wilem35-fauna-probe`, whose target is
  deleted. Needs unlinking by hand.

## 2.0.2 -- the module could not get the aircraft's own position

Symptom: "No contacts in range" with giraffes filling the windscreen.

The module asked the sim for the user's position alongside the animals, using
the same call. The animal half worked; the user half never came back, so the
panel had positions for the animals and nothing to measure them from. It had
been reporting "no contacts" -- which sends someone looking for animals instead
of reporting a fault.

This was invisible until 2.0.0 because the panel fell back to the helper
whenever the module fell short. **The helper had been doing this work all
along**, and removing it is what exposed the gap. Worth remembering: a fallback
that silently covers for a broken path means the broken path never gets found.

The fix removes the round trip rather than debugging it. The aircraft's
position is ordinary variables, and the panel reads them directly.

Also in this build: when the list is empty the panel says WHY -- no reply yet,
no position, or objects offered but none huntable. "No contacts in range" is
now only said when it is actually true.

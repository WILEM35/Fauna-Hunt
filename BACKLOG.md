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

## 2.0.3 -- make the module ask for exactly what the probe proved works

The module was answering, the position was known, and the sim listed no animals
at all. Meanwhile the throwaway probe had found 246 on the same machine.

The difference was in what was asked for:

| | probe (worked) | module (returned nothing) |
|---|---|---|
| values per object | 4 | 6 |
| requests per poll | 1 | 3 (animals, user, aircraft) |

The two extra values were heading and ground speed, which an animal may simply
not have -- and one bad value can cost the whole request rather than that
field. The extra requests were for the user's own position (now read by the
panel) and for aircraft (for the single eagle the sim ships).

So the module now matches the probe exactly: four values, one request. The
eagle is the price, and it can come back later as its OWN request rather than
sharing one -- added one at a time, each verified.

The lesson is the same one as the malloc export: when a small thing is proven
to work and a bigger thing does not, make the bigger thing smaller until it
matches, rather than reasoning about which difference matters.

Also in this build, an empty list reports which step produced nothing --
module error, no position, objects offered but rejected, or genuinely none.

## 2.0.4 -- reopening the panel broke it permanently

Close the panel and open it again and it sat on "Waiting for the simulator"
with animals in plain view, and never recovered.

The panel waited for a "ready" signal from the simulator's message service
before it would talk to the module. That signal fires when the connection is
first made. On a reopened panel the connection is already up, so it never fires
again -- and the panel waited for something that had already happened.

Now the handler is attached immediately as well as on the signal, and polling
does not wait for it at all. Asking too early is harmless; waiting forever is
not.

Worth remembering: this is the second bug tonight caused by waiting for a
one-shot event. Prefer doing the thing and letting it fail harmlessly.

Also fixed: two messages still said "waiting for the data service", which no
longer exists.

## 2.0.5 -- one connection per session, and honest counters

Symptom: "The module answered 1 time(s)" with animals in view. One reply, ever,
however long the panel was open.

Two possible causes that look identical from outside and need opposite fixes:
the panel stopped ASKING, or the module stopped ANSWERING. The note now shows
both counts -- "Asked 60, answered 1" means the module died; "Asked 1,
answered 1" means the panel is being restarted.

The fix in this build addresses the second: the sim tears the panel's element
down and rebuilds it -- opening the toolbar menu is enough -- and every rebuild
was creating a fresh connection with counters back at zero. The connection now
lives for the session and a rebuilt panel picks up the one already working.

If the counts come back as "Asked many, answered 1", the module is dying after
its first reply and the next place to look is the developer console.

## 2.0.9 -- the real cause: eight helpers deleted by a range edit

The panel had been showing "no contacts" for several builds while the module
was working perfectly. The heartbeat proved it: Settings showed
`ticks 25 asked 25 answered 23 rows 250` -- 250 animals arriving every second --
while the Hunt page showed `asked 2, answered 1` from a snapshot built long
before and never replaced.

When the helper program was removed, a range deletion took `httpGetJson` and
everything after it up to the next section comment: **eight functions**, not
one. `sectorOf`, `quantise`, `distanceBracket`, `roundTo`, `plural`, `shuffle`,
`haversineM` and `todayIso`. The translator calls `haversineM` on every herd.

Why nothing caught it:

* The panel still PARSED -- the functions were called, not declared, so it is
  valid JavaScript right up until it runs.
* The bench tests passed, because the harness defines its own `haversineM`.
* The sim's console showed no error, because the failure happens inside a
  message callback where the exception is swallowed.
* With no animals nearby the code path never runs, so it looked fine.

`probe/check_js.py` now reports any function called in the panel but defined
nowhere. Verified both ways: silent on the current build, and it names all
eight on the broken one.

**Lesson: never delete by range.** Delete the named thing. And when a fault
survives several fixes, stop fixing and instrument -- the heartbeat found in
one flight what four builds of reasoning had not.

## Sorting: by distance, or by what is ahead of you

Requested 2026-08-29. **Not built.**

The list is sorted by distance today, and that is all it can do. In a
helicopter that is fine -- you can stop, slip sideways and turn on the spot, so
a contact behind you is as reachable as one ahead. In an aeroplane it is not:
committing to something behind you means a circuit to get back, and by then the
herd has moved.

So the panel needs a choice of how the list is ordered:

* **By distance** -- what it does now, and the right default for helicopters.
* **What is ahead** -- restricted to the 180-degree arc in front of the
  aircraft, so the list only offers things you can fly at without turning
  round.

Points worth settling when it is built:

* Ahead of the AIRCRAFT, not the view. The view is unavailable in VR anyway,
  and in an aeroplane it is the flight path that matters.
* Whether "ahead" HIDES what is behind or just sorts it lower. Hiding is
  cleaner to read; sorting keeps the option of turning round if something
  legendary is back there. Probably sort rather than hide, with the alert for
  legendary animals unaffected either way.
* The relative bearing is already worked out for the o'clock position, so the
  arc test is only a comparison -- no new data needed from the module.
* Where the control lives. A third tab would be heavy for two options; more
  likely a small toggle in the contact list's own header.

## BUG: the list goes stale until the panel is closed and reopened

Reported 2026-08-29, on 2.1.0. **Not investigated.**

Symptoms: contacts stop updating, and everything left in the list is four or
five miles away with nothing close, even while flying over animals. Closing the
panel from the toolbar and opening it again brings them back.

This is the same shape as the fault that produced "asked 2, answered 1" -- the
panel stops refreshing and sits on what it last drew. A watchdog was added in
2.0.7 to restart the loop if it stops, so either it is not catching this case or
the loop is running and something further down has stopped.

Distinguishing the two on the next flight: **Settings shows the version** but no
longer shows the tick counter, which was removed in 2.1.0. Put a temporary
counter back before hunting for this -- a live tick count separates "the loop
stopped" from "the loop is fine and the data is stale", and those need opposite
fixes. That distinction cost several flights last time.

Two other candidates worth checking before assuming it is the loop:

* **The list hold.** The list deliberately stops reordering for 4 seconds after
  you touch it, and for as long as the pointer is over it. In VR a controller
  ray resting on the panel may be holding it indefinitely -- which would look
  exactly like this, and closing the panel would clear it.
* **The identified-herd anchor**, which keeps a logged sighting attached to a
  herd as it moves. If that is holding stale positions, old contacts would
  persist at increasing distance while new ones nearby never appear.

The list hold is the first thing to rule out: it is the only mechanism in the
panel that deliberately freezes the list, and it is released by reopening.

## Direction arrows on each contact

Requested 2026-08-29. **Not built.** Estimate: small.

An arrow per row, pointing where the animal is relative to the aircraft's nose,
instead of or alongside "your 4 o'clock, low".

Cheap because the number already exists: `relative_bearing_deg` is computed for
every contact to produce the o'clock position. An arrow is that number applied
as a rotation to one small shape -- no new data from the module, no new maths.

The real question is not difficulty, it is **how precise the arrow is allowed
to be.** The whole design rests on not marking the animal exactly: the text is
deliberately coarse, a compass sector at long range sharpening to an o'clock
position up close. An arrow drawn from the exact bearing would quietly hand
back the precision the text withholds, and at long range it would be a marker.

So the arrow must be quantised to the SAME steps the text uses -- 45 degrees
while it is only giving a sector, 30 degrees once it is giving an o'clock
position. Same information, better to read at a glance in VR, no more.

Also worth settling:

* It rotates as the aircraft turns, so it updates every second like everything
  else -- fine, but it must not fight the list hold.
* It has to stay legible at XS and in VR, so a simple solid triangle rather
  than a thin drawn arrow.
* Whether it replaces the o'clock text or sits beside it. Beside, probably:
  the words work when read aloud on a group flight, the arrow works at a glance.

## 2.1.1 -- arrows, and the character damage repaired

The arrows are quantised to the same step as the words beside them: 45 degrees
at sector range, 30 at coarse, 10 at fine, and 30 at o'clock range which the
o'clock already is. Drawing from the true bearing would have handed back the
precision the text deliberately withholds. Drawn as an SVG rather than a glyph,
because the sim's font is missing more characters than expected -- that is what
made the tick marks show as empty boxes in the probe panel.

### Four times now: a backslash eaten by an edit

`Copys\fauna-hunt` became `Copys` + formfeed for the third time, this time in
build.ps1's version-stamping step, which failed with "Illegal characters in
path" -- and because that command chained the packaging after it without
checking, a zip labelled 2.1.1 was produced containing 2.1.0 content. Deleted.
The fourth was in the launch-kit page, in the very command being handed over.

`probe/check_js.py` now scans the .ps1 files for control characters as well as
the panel scripts, so a build cannot start with one.

**The real lesson is about how these files get edited.** Writing a Windows path
inside a Python string literal is the cause every single time: `\f`, `\b` and
`\t` are escape sequences and vanish silently. Edit paths at byte level, or
build them from a backslash constant, and never trust a path that came out of a
scripted edit without checking the bytes.

## 2.1.2 -- bigger arrow, aligned text, and the list-hold bug fixed

The arrow now has the left of each row to itself at 2.5em, and both lines of
text start beside it so the animal and the bearing line up. The articles are
gone: "medium-sized animal", not "a medium-sized animal".

**The list-hold bug is understood and fixed.** Hovering the list deliberately
stops it reordering, and it was released by `mouseleave` -- which in VR often
never arrives when the pointer leaves the panel. The flag latched on and the
list froze for the rest of the flight. Waving the pointer over it again and off
released it, which is why it looked like it recovered on its own.

A hover is now only believed while the pointer keeps proving it is there, and
expires 2.5 seconds after it stops. VR pointers jitter constantly so a real
hover holds fine; a pointer that has silently gone releases by itself.

Also removed: a stray `this.alertFor = null` that had been sitting inside the
mouseleave handler since 1.2.0, wrongly indented. It made the legendary alert
re-fire every time the pointer left the list.

### Open question: pictograms for the size class

Asked 2026-08-29. Not built, and worth thinking about before it is.

The appeal is obvious -- a shape reads faster than "medium-sized animal". The
risk is that a recognisable silhouette names the animal, and the entire game is
built on NOT naming it. A bear outline against an elephant would be worse than
no icon at all.

The version that works is a single neutral four-legged silhouette drawn at four
sizes, so it says "this big" without saying "this animal". That is honest, and
it is genuinely faster to read at a glance.

## 2.1.3 -- size silhouettes and the sort toggle

**Silhouette.** One neutral four-legged shape at four sizes, stacked under the
arrow in a single left-hand column. Deliberately not a recognisable species:
naming the animal is the one thing the game must not do, and a bear outline
against an elephant would be a wrong answer given away for free.

Two columns of furniture was too many -- rendered at the default text size in a
430 px panel, "very large animal, 5 of them" wrapped to three lines. Stacking
the arrow and silhouette into one column gave the words their width back.
Checked by rendering the real markup and CSS in a browser and looking at it,
rather than guessing.

**Sort toggle**, in the bar above the list: Nearest, or Ahead.

Ahead lifts the 180-degree arc in front of the nose to the top of the list. It
SORTS rather than hides -- something legendary behind you should never silently
disappear, it just stops being first. Measured against the aircraft, not the
view: it is the flight path that decides whether a contact is worth turning
for, and the view is unavailable in VR anyway.

Choosing a sort releases the list hold, since reordering is exactly what was
just asked for.

## 2.1.4 -- silhouettes removed

Tried in 2.1.3 and rejected on sight: at the size they have to be, a neutral
four-legged shape reads as a stick figure rather than an animal. Making it
recognisable was never an option -- that would name the animal, which is the
one thing the game must not do. So there is no version of this idea that works,
and it is not worth revisiting.

Back to the arrow on the left and the words. The size words keep their new
form: "medium-sized animal", no article.

# ============================================================
# USER FEEDBACK from the flightsim.to release (2026-09-02)
# 87 downloads, 5.0 from 2 reviews, 4 comments. NOT worked on.
# ============================================================

## BUG: the four choices do not match the animal people are looking at

Reported by users and confirmed by the author. The most important item here --
it strikes at the core mechanic. Someone is looking at an animal, taps it, and
none of the four options obviously matches what is out of the window.

**Strong hypothesis, untested:** the shortlist is drawn from the 107 SPECIES
ENTRIES rather than the 61 headline animals. Twenty-two of those animals have
subspecies -- Giraffe has eight, Brown Bear seven, Wildebeest five. If the four
options can be four subspecies of the same animal, no amount of looking out of
the window will separate them, because they are not visually distinct in the
sim.

Check `buildShortlist()` first: what pool does it draw distractors from? If it
is the species table's roots rather than the `group` field, that is the bug and
it is a small fix.

Second candidate, also worth checking: whether the NAME shown on a correct
answer is a subspecies ("E. White-bearded Wildebeest") when the player is
thinking "wildebeest". That would feel wrong even when the answer is right.

The author's own guess was the same territory: mixed animals nearby, or the
sim's naming convention.

## Requested: filter the list

Two people, independently -- the most requested thing after the shortlist bug.

* **Hide animals already found or captured**, so the list shows only what is
  new. Note this is close to the existing "Recognise on sight" setting but not
  the same: that names them, this would remove them.
* **Filter to a single species**, so you can hunt one animal deliberately --
  "only show me snow leopards".

Both are list operations on data the panel already has, and both fit the
existing settings pattern.

## Requested: a radar-style view

"A 'radar' view which shows where the animal sightings are. It will be easier
to hone into that area."

**Careful.** This is the one request that runs straight at the central design
rule: never mark the animal precisely. A radar sweep with dots IS a map.

There is a version that works -- a radar showing the SAME vagueness the text
does, arcs and sectors rather than points, coarser the further out. That is
worth considering. A literal position plot is not, and no amount of demand
should change that: it deletes the game.

## Requested: EFB integration

Two people. One of them was emphatic about the condition:

> "If you integrate into the EFB please keep the standalone toolbar widget
> though. There's use cases for both, and not having to pull up the large EFB
> which takes a huge amount of real estate makes the toolbar addon more useable
> in a lot of cases, especially if you have other toolbar addons up as well."

So: an EFB app IN ADDITION TO the toolbar panel, never instead of it.

## Requested: herd behaviour and mustering

"Any chance of some settings for bigger herds so we can do some herd mustering?
Different animal speeds and herd behavior would add some challenges."

**Probably not possible.** We do not control the animals -- the sim spawns and
moves them, and nothing in the SDK exposes herd size or speed. Injecting our
own animals was researched and looks feasible (`AICreateSimulatedObject`), but
a planted animal likely stands still, because the walking comes from the sim's
own fauna system. Worth answering honestly rather than leaving it open.

The one real lever the player already has: the sim's own Fauna slider.

## Context worth keeping

One reviewer's framing is the best description of what this add-on is for, and
is worth remembering when weighing the requests above:

> "Real-world wildlife photographers go with guides and much more data than the
> very uninformative heatmaps we're given in the sim, and your tool does a great
> job providing that extra detail."

The World Photographer missions are the use case people found on their own.

# Requests -- 11 September 2026

Four items raised in one go. Nothing built yet; the session was stopped before
any of it was started.

## 1. Put the arrow and the distance together

The direction arrow sits on the left of the contact box and the distance sits
away from it, so reading one contact takes two glances. Move them so they sit
beside each other and one look answers "which way, how far".

Cosmetic -- mock-up first, per standing rule.

## 2. Radar view

Asked for by a user on flightsim.to, and now by Wilem, who wants to test it.

A circular display, aircraft in the centre, each group of animals drawn as a
circle. Distance from centre is relative range; **circle size is the number of
animals**. The point is to fly toward the big herds instead of being pulled off
course by a stray pair in an odd direction.

**The concern, stated once:** a sweep with dots plotted at true positions is a
map, and the whole design rests on markers being deliberately fuzzy. A version
that keeps the rule would quantise the bearing into arcs and the range into
bands -- the same vagueness the words already carry, drawn instead of spoken.
Build that version, not a literal plot.

Mock-up first.

## 3. Pop-out is missing from the toolbar panel

The panel offers only minimize and close -- no pop-out box, unlike other
toolbar add-ons.

**Cause found:** `InGamePanel_FaunaHunt.xml` declares `resizeDirections`, the
sizes and the icon, and nothing else. No pop-out attribute. This is a panel
definition change, not a code change. Same will apply to Vector Deck and
VoiceDeck, whose definitions are written the same way.

## 4. EFB integration

How hard is it to also appear in the in-aircraft EFB, the way Navigraph and
Little NavMap VR do.

**Condition, from Wilem and from a commenter:** the standalone toolbar window
stays. EFB *as well as*, never instead of.

Three working examples are already installed and can be read rather than
guessed at:

* `bkiel-efb-lnm-vr` -- Little NavMap in the EFB
* `navigraph-efb-simbriefapp` -- Navigraph / SimBrief
* `fsdreamteam-gsx-efb` -- GSX

All three sit in the Community folder, and the first two are also in
`C:\FS2020\Add-ons\Utilities`.

# Test: is fauna placement deterministic? -- 12 September 2026

Raised by another add-on developer asking whether his program could scan the
simulator and build a database of where animals are. Worth settling, because
the answer decides something about this add-on and not just about his.

## What is already known

There is no global query. `RequestDataOnSimObjectType` with
`SIMCONNECT_SIMOBJECT_TYPE_ANIMAL` only ever returns what is currently
streamed in -- roughly 3 km on the deck, out to about 30 km at altitude -- and
caps at 250 objects. Nothing exists until you are near it, and the sim's own
Fauna slider changes how much spawns, so two people at the same spot do not
see the same thing.

A global crawl is therefore arithmetic, not engineering: land surface is about
150 million km2, and at the reliable on-deck radius that is millions of
samples. Sampling from altitude covers more ground per stop but the 250 cap
truncates exactly the dense places worth recording.

A **targeted** crawl of a few hundred chosen places -- national parks, the
airports people fly from, a spread of biomes -- is a weekend of automated
flying and would produce something genuinely useful. Whether it is worth
anything depends entirely on the test below.

## The unknown

Whether the same place yields the same SPECIES every time.

Presence is clearly stable: loading at Seronera reliably produces ten or more
groups within 2 km, every time. That is not the same claim as the species
being stable.

## The test

At two or three fixed spots -- HTSN Seronera, somewhere temperate with
livestock, and one mountain location -- load in ten times each and record the
species list the panel reports. Keep the time of day, the season and the Fauna
slider identical between runs, since all three plausibly feed the spawner.

Compare the lists, not the counts or the positions. Individual herds drift and
stream in and out; that is expected and already handled.

## What each outcome means

**Same species every time.** Placement is baked to biome or region. A
species-by-place database is meaningful, a targeted crawl is worth doing, and
-- importantly -- somebody else can build one. Fauna Hunt should assume that
eventually happens and be built so it still has a point when it does.

**Species vary between loads.** Only the broad regional statement survives,
which is what the lifelist hints already give you. A database would add
nothing the sim's own fauna heatmap does not, and the question is closed.

## Why it matters here

A public animal-location database is precisely the thing this add-on is built
not to be. If one exists and is any good, finding the animals stops being the
game.

That is not a reason to discourage anyone -- the demand is real, and a
reviewer called the sim's own heatmaps uninformative in as many words. It is a
reason to know the answer before someone else does. Fauna Hunt's defence was
never that the animals are hard to locate; it is that telling a Grant's
gazelle from a Thomson's at 400 metres is hard. Worth remembering if this ever
has to be argued.

## Related, not done

EFB integration is still investigation only -- nothing is built, which is why
no Fauna Hunt icon appears in the EFB. The app list observed on 12 September
(GSX, Little Navmap VR, Navigraph Charts, SayIntentions.AI, SimBrief Dispatch)
confirms where the icon would sit and that third-party apps reach that screen
normally.

# BUG: the same animal offered twice in one question -- 13 September 2026

Seen in flight, screenshotted: the four choices were Bighorn Sheep, Mountain
Goat, **Grizzly Bear, Grizzly Bear**. The first Grizzly Bear tapped was wrong,
the second was right. Two identical buttons, one of them scoring and one of
them costing a guess.

This is a confirmed, reproducible instance of the vaguer complaint logged from
flightsim.to -- "the four choices are not obvious or matching the animal that
they see".

## Cause, found

`buildShortlist()` dedupes decoys by the species ROOT key:

    if (decoys.length < 3 && decoys.indexOf(root) === -1) decoys.push(root);

but the button shows `table[root].common`. Two different roots can carry the
same common name, and three pairs in `data/species.json` do:

| Shown to the player   | Roots behind it                          |
|-----------------------|------------------------------------------|
| Grizzly Bear          | `GrizzlyBear`, `UArctosHorribilis`       |
| Water Buffalo         | `BBBubalis`, `BBubalis`                  |
| West African Giraffe  | `GCamelopardalisPeralta`, `GPeralta`     |

Whenever the correct answer is one of a pair and the decoy picker happens to
draw the other, the player is shown the same words twice and has to guess
between them. There is no way to be right on purpose.

These read like the same animal entered twice under different keys rather than
genuine subspecies -- `BBBubalis` / `BBubalis` in particular looks like a typo
that became a second entry.

## Two fixes, and they are not the same fix

**1. Dedupe by what is shown, not by the key.** One line in
`buildShortlist()`: reject a decoy whose `common` matches one already taken, or
the correct answer's. Cheap, safe, and it stops the player ever seeing the
question. It does NOT stop the same animal existing twice in the lifelist,
where it can still be collected twice under one name.

**2. Merge the duplicate entries in `data/species.json`.** Fixes the root
cause, and the lifelist stops being able to hold one animal twice.

**Do not do 2 casually.** Anyone who has already logged the losing root has
that sighting keyed to it, and merging orphans it -- the lifelist would quietly
drop an animal they had earned. It needs a migration that rewrites old roots to
the survivor, in the same place the existing v1/v2/v3 migrations live, and the
merge test bench is the right place to prove it.

Recommended order: ship 1 now, because it removes the impossible question
immediately and risks nothing. Do 2 deliberately, with the migration, and check
all three pairs at once.

## Worth checking at the same time

Whether any of the three pairs differ in `region`, `size`, `tier`, `points` or
`rank`. If they do, the two entries score differently for what the player sees
as one animal, and that decides which of the pair should survive the merge.

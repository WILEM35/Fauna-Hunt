# Backlog

Things to do, collected as they come up and batched into occasional releases
rather than shipped one at a time.

**How this works.** Mention something and it gets written here, not built. When
there is enough to be worth a release, we work through it, tick the items off,
and move them to Done with the version they shipped in.

Status: `[ ]` waiting · `[~]` in progress · `[x]` done

---

## Open

### [~] Close button and pop-out on the panel header

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

**1.0.3 carries lead 1 as an experiment**: `class="ingameUiFrame"` is now on
the `<ingame-ui>` element, without `panelInvisible`. If the header still has no
controls, remove it and try ruling out our own `overflow: hidden` next.

---

## Done

Nothing yet — 1.0.0 through 1.0.3 predate this file.

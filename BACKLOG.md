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

*To look into when we build it:* the header is the sim's own `<ingame-ui>`
chrome, not ours, so this is probably an attribute on that element or a
template import rather than markup we write. Worth checking a stock panel's
registration XML and the `ingameUiHeader` template before assuming it needs
building by hand. Related: `panel-id` is what the sim keys header behaviour to
(see the display-name quirk in the Flight Data Tiles notes).

---

## Done

Nothing yet — 1.0.0 through 1.0.3 predate this file.

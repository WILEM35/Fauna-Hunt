"""Generate the EFB page from the toolbar page.

The EFB app renders one iframe, and this is the page that goes in it. It is the
SAME panel: same scripts, same stylesheet, same markup. The only difference is
that the sim's toolbar window frame -- the <ingame-ui> element -- is not there,
because inside the EFB there is no toolbar window to frame.

This is generated rather than written by hand on purpose. The dev test harness
kept its own copy of the panel markup and quietly fell behind: it was missing
the sort toggle entirely, so the sort control was never once exercised outside
the sim. One hand-maintained copy of this markup is already one too many.

Run from build.ps1, before the package is built.
"""

import io
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
PANEL = os.path.join(
    HERE, "..", "PackageSources", "Copys", "fauna-hunt", "Panel",
    "html_ui", "InGamePanels", "FaunaHunt")

SOURCE = os.path.join(PANEL, "FaunaHunt.html")
TARGET = os.path.join(PANEL, "FaunaHuntEfb.html")

BANNER = """	<!-- GENERATED FILE - do not edit.
	     Written by probe/make_efb_page.py from FaunaHunt.html on every build.
	     Change the panel there; this follows. -->
"""

# Inside the EFB the page IS the app: it gets a rectangle and has to fill it.
# The toolbar version inherits its height from the sim's window frame, which is
# not present here, so it has to be said explicitly.
EFB_STYLE = """		<style>
			/* The EFB gives the iframe a rectangle; the panel has to fill it.
			   In the toolbar this comes from the sim's window frame, which is
			   not here. */
			html, body {
				height: 100%;
				margin: 0;
				overflow: hidden;
			}
			/* The EFB paints its own bar across the top of the app area -- the
			   notification bell and the clock -- and it sits OVER whatever the
			   app draws. Navigraph's SimBrief app reserves exactly this much
			   for it (pt-[40px] in their own markup); without it our tab row
			   is half-hidden behind the bell. */
			body {
				padding-top: 40px;
				box-sizing: border-box;
			}
			ingamepanel-fauna-hunt {
				display: block;
				height: 100%;
				min-height: 0;
			}
		</style>
"""


def build(source_text):
    """Return the EFB page, or raise if the toolbar page is not what we expect."""
    opening = re.search(r"[ \t]*<ingame-ui\b[^>]*>\s*\n", source_text)
    closing = re.search(r"[ \t]*</ingame-ui>\s*\n", source_text)
    if not opening or not closing:
        raise SystemExit(
            "FaunaHunt.html no longer has an <ingame-ui> wrapper. "
            "make_efb_page.py strips that wrapper and cannot guess at a new shape.")
    if closing.start() < opening.end():
        raise SystemExit("FaunaHunt.html: </ingame-ui> comes before <ingame-ui>.")

    out = (source_text[:opening.start()]
           + source_text[opening.end():closing.start()]
           + source_text[closing.end():])

    # Undo one level of indentation on everything that was inside the wrapper,
    # so the generated file reads like a file rather than like a diff.
    body_start = out.find("<body")
    head, body = out[:body_start], out[body_start:]
    body = re.sub(r"(?m)^\t", "", body)

    head = head.replace("</head>", EFB_STYLE + "	</head>")
    head = head.replace("<title>Fauna Hunt</title>",
                        "<title>Fauna Hunt</title>\n" + BANNER.rstrip("\n"))
    return head + body


def main():
    if not os.path.exists(SOURCE):
        raise SystemExit("FaunaHunt.html not found at " + SOURCE)

    source_text = io.open(SOURCE, encoding="utf-8").read()
    generated = build(source_text)

    previous = None
    if os.path.exists(TARGET):
        previous = io.open(TARGET, encoding="utf-8").read()

    if previous == generated:
        print("  FaunaHuntEfb.html already current")
        return

    io.open(TARGET, "w", encoding="utf-8", newline="").write(generated)
    print("  wrote FaunaHuntEfb.html (%d bytes)" % len(generated))


if __name__ == "__main__":
    main()

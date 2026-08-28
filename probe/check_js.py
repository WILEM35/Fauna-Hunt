"""Refuse to ship a panel that cannot parse.

A single syntax error in any panel script takes the WHOLE panel down -- the
custom element never registers, and the sim shows the bare HTML: tabs, a score
of zero, and nothing else. It looks like lost save data rather than a broken
build, which is exactly how it reached a release.

That happened when an edit left a real newline inside a string literal. The
bench tests did not catch it because they only load the translator, not the
panel. This checks every script the panel actually loads.

Run by build.ps1. Exits non-zero if anything fails to parse.
"""

import io
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
PANEL = os.path.join(HERE, os.pardir, "PackageSources", "Copys", "fauna-hunt",
                     "Panel", "html_ui", "InGamePanels", "FaunaHunt")

SCRIPTS = ["FaunaSpeciesData.js", "FaunaInSim.js", "FaunaHunt.js"]


def main():
    try:
        import esprima
    except ImportError:
        print("  esprima not installed -- cannot check the panel scripts.")
        print("  Install it with:  pip install esprima")
        # Deliberately fatal. Shipping an unparsed panel is worse than a
        # failed build, and the failure is silent in the sim.
        return 1

    bad = 0
    for name in SCRIPTS:
        path = os.path.join(PANEL, name)
        if not os.path.exists(path):
            print("  MISSING  %s" % name)
            bad += 1
            continue
        source = io.open(path, encoding="utf-8").read()
        try:
            esprima.parseScript(source)
        except Exception as err:
            print("  BROKEN   %s  ->  %s" % (name, err))
            bad += 1
            continue

        # Control characters where a backslash was eaten by an escape sequence
        # in a scripted edit. Invisible on screen, and they have silently
        # broken build paths here more than once.
        for code in (7, 8, 11, 12):
            if chr(code) in source:
                print("  CONTROL CHARACTER (0x%02x) in %s -- a backslash was "
                      "probably eaten by an edit" % (code, name))
                bad += 1
        print("  ok       %s" % name)

    if bad:
        print("\n%d problem(s). The panel would load as a blank window." % bad)
        return 1
    print("  panel scripts parse cleanly")
    return 0


if __name__ == "__main__":
    sys.exit(main())

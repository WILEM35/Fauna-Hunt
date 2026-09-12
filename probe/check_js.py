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
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
PANEL = os.path.join(HERE, os.pardir, "PackageSources", "Copys", "fauna-hunt",
                     "Panel", "html_ui", "InGamePanels", "FaunaHunt")

SCRIPTS = ["FaunaSpeciesData.js", "FaunaInSim.js", "FaunaHunt.js"]

# The EFB app lives in its own tree and is loaded by the simulator, not by our
# page, so a syntax error in it never reaches the panel -- the app just never
# appears in the EFB, with nothing said. Checked here for exactly that reason.
EFB = os.path.join(HERE, os.pardir, "PackageSources", "Copys", "fauna-hunt",
                   "Panel", "html_ui", "efb_ui", "efb_apps", "FaunaHuntApp")

EFB_SCRIPTS = ["FaunaHuntApp.js"]


# Functions that are called but defined nowhere.
#
# Deleting a range of lines from one file removed EIGHT helpers that another
# file still called. Nothing complained: the panel parsed fine, the bench tests
# passed because the harness defines its own copy, and the failure only showed
# up in flight -- as an empty list, because the error was swallowed inside a
# callback. This is the check that would have caught it in a second.
BUILTINS = set("""
    if for while switch catch function return typeof new delete void throw
    Math JSON Object Array String Number Boolean Date RegExp Promise Error
    parseInt parseFloat isFinite isNaN encodeURIComponent decodeURIComponent
    setTimeout setInterval clearTimeout clearInterval requestAnimationFrame
    console window document navigator performance
    SimVar Coherent RegisterCommBusListener RegisterViewListener
    TemplateElement BaseInstrument checkAutoload GetStoredData SetStoredData
    XMLHttpRequest customElements
""".split())

DEFINE = re.compile(r"^\s*(?:function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=|class\s+(\w+))", re.M)
# Methods inside a class: `name(args) {`. These are only ever called through
# `this.`, which the call pattern below already skips -- but their DEFINITIONS
# look exactly like calls, so they have to be collected or everything is noise.
METHOD = re.compile(r"^\s{1,3}(?:get\s+|set\s+|static\s+|async\s+)?(\w+)\s*\([^;]*\)\s*\{", re.M)
CALL = re.compile(r"(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(")

# Words that are followed by a bracket but are not calls at all.
NOT_CALLS = set("catch function switch return typeof new delete void throw of in"
                " super object rgba url translate scale".split())


def undefined_calls(sources):
    defined = set(BUILTINS)
    for src in sources.values():
        for m in DEFINE.finditer(src):
            defined.update(n for n in m.groups() if n)
        defined.update(m.group(1) for m in METHOD.finditer(src))

    missing = {}
    for name, src in sources.items():
        for m in CALL.finditer(src):
            fn = m.group(1)
            if fn in defined or fn in NOT_CALLS:
                continue
            missing.setdefault(fn, set()).add(name)
    return missing


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
    targets = ([(PANEL, name) for name in SCRIPTS]
               + [(EFB, name) for name in EFB_SCRIPTS])
    for folder, name in targets:
        path = os.path.join(folder, name)
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

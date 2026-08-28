"""Turn species.json into a file the panel can load on its own.

The panel used to fetch the species table from the helper program over HTTP.
With the helper gone it needs the table locally, and an in-game panel cannot
reliably fetch a file from its own package -- so the table ships as JavaScript
that simply assigns a global.

Generated, never edited by hand. `build.ps1` runs this, so the panel's copy can
never drift from the one the helper serves.

Usage:
    python make_species_js.py
"""

import io
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, os.pardir, "PackageSources", "Copys", "fauna-hunt",
                   "Service", "species.json")
DST = os.path.join(HERE, os.pardir, "PackageSources", "Copys", "fauna-hunt",
                   "Panel", "html_ui", "InGamePanels", "FaunaHunt",
                   "FaunaSpeciesData.js")

HEADER = """// GENERATED FILE -- DO NOT EDIT.
//
// Built from Service/species.json by probe/make_species_js.py, which build.ps1
// runs on every build. Edit the JSON, not this.
//
// The panel needs the species table without the helper program to serve it.
//
"""


def main():
    with io.open(SRC, encoding="utf-8") as handle:
        data = json.load(handle)

    # Only what the panel actually reads. The full file carries build
    # provenance and the tier tables that only the rarity tool needs.
    slim = {
        "species": data["species"],
        "title_to_species": data["title_to_species"],
    }

    body = json.dumps(slim, separators=(",", ":"), ensure_ascii=False)
    with io.open(DST, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(HEADER)
        handle.write("// %d species, %d titles.\n\n"
                     % (len(slim["species"]), len(slim["title_to_species"])))
        handle.write("var FAUNA_SPECIES_DATA = ")
        handle.write(body)
        handle.write(";\n")

    print("wrote %s (%.0f KB, %d species, %d titles)"
          % (os.path.basename(DST), os.path.getsize(DST) / 1024.0,
             len(slim["species"]), len(slim["title_to_species"])))


if __name__ == "__main__":
    main()

"""bird_hunt.py -- are birds reachable, and under what object type?

Birds never appeared under the ANIMAL type, which is why Fauna Hunt has no
birds in it. The sim's own content folders explain why: the only bird-shaped
entry on this machine, the eagle, is filed under "passiveaircraft" -- the same
category as the airliners -- while the flightless ostrich sits with the animals.

If that is right, birds are enumerable after all: just as AIRCRAFT, not ANIMAL.
This asks the sim to list every simobject title it knows for each type, which
does not depend on one happening to be nearby.

Read-only. Safe to run mid-flight.
"""

import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                os.pardir, "PackageSources", "Copys",
                                "fauna-hunt", "Service"))

import simconnect_ffi as sc

BIRDS = ("eagle", "bird", "hawk", "falcon", "owl", "stork", "crane", "heron",
         "flamingo", "pelican", "gull", "goose", "duck", "swan", "vulture",
         "condor", "albatross", "penguin", "ostrich", "emu", "raven", "crow")

TYPES = [sc.OBJECT_TYPE_AIRCRAFT, sc.OBJECT_TYPE_HELICOPTER,
         sc.OBJECT_TYPE_ANIMAL, sc.OBJECT_TYPE_GROUND, sc.OBJECT_TYPE_BOAT]


def main():
    print("Connecting...")
    try:
        link = sc.SimConnect("FaunaBirdHunt")
    except sc.SimConnectError as err:
        print("\n%s" % err)
        return 1
    print("Connected.\n")

    found = {}
    for i, otype in enumerate(TYPES):
        name = sc.OBJECT_TYPE_NAMES.get(otype, str(otype))
        link.enumerate_simobjects_and_liveries(200 + i, otype)
        titles = []
        deadline = time.monotonic() + 6.0
        while time.monotonic() < deadline:
            msg = link.get_next_dispatch()
            if msg is None:
                time.sleep(0.01)
                continue
            recv_id, raw = msg
            if recv_id == sc.RECV_ID_ENUMERATE_SIMOBJECT_AND_LIVERY_LIST:
                header, entries = sc.parse_livery_list(raw)
                titles.extend(title for title, _livery in entries)
                # dwEntryNumber counts from 0, so the last page is one short
                # of dwOutOf.
                if header.dwEntryNumber + 1 >= header.dwOutOf:
                    break
        found[name] = titles
        hits = sorted({t for t in titles
                       if any(b in t.lower() for b in BIRDS)})
        print("%-12s %5d titles   bird-like: %s"
              % (name, len(titles), ", ".join(hits) if hits else "none"))

    print("\n" + "=" * 66)
    all_hits = {}
    for name, titles in found.items():
        for t in titles:
            if any(b in t.lower() for b in BIRDS):
                all_hits.setdefault(t, []).append(name)
    if all_hits:
        print("BIRDS, and the type they answer to:\n")
        for t in sorted(all_hits):
            print("   %-46s %s" % (t, "/".join(all_hits[t])))
    else:
        print("No bird titles under any type.")
    print("=" * 66)
    link.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

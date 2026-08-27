"""
type_sweep.py -- ask the sim for EVERY sim object type and see what answers.

Developer mode shows containers the documented SimConnect enum has no name
for. FLYING_ANIMAL is the one that matters: birds live there, ANIMAL reads 0
in the same place, and the header only goes up to USER_CURRENT (9).

So this sweeps type indices 0..MAX regardless of whether the SDK names them,
and reports what each one returns. If birds are reachable at all, they show up
against some index here. If nothing beyond the documented types answers, they
are not exposed to SimConnect and no amount of querying will find them.

Run it somewhere with birds -- developer mode's Containers window will tell
you (FLYING_ANIMAL with a non-zero count).

Usage:
    python type_sweep.py
    python type_sweep.py --max 24 --radius 20000
"""

import argparse
import os
import sys
import time
from collections import defaultdict

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                os.pardir, "PackageSources", "Copys",
                                "fauna-hunt", "Service"))

import simconnect_ffi as sc

FIELDS = [
    ("lat", "PLANE LATITUDE", "degrees", sc.DATATYPE_FLOAT64),
    ("lon", "PLANE LONGITUDE", "degrees", sc.DATATYPE_FLOAT64),
    ("alt_ft", "PLANE ALTITUDE", "feet", sc.DATATYPE_FLOAT64),
    ("title", "TITLE", None, sc.DATATYPE_STRING256),
    ("category", "CATEGORY", None, sc.DATATYPE_STRING256),
]

DEFINE_ID = 1
REQUEST_BASE = 300

# What the 2024 SDK header actually names. Anything past this is unnamed
# territory -- which is the whole point of the sweep.
KNOWN = {
    0: "USER", 1: "ALL", 2: "AIRCRAFT", 3: "HELICOPTER", 4: "BOAT",
    5: "GROUND", 6: "HOT_AIR_BALLOON", 7: "ANIMAL", 8: "USER_AVATAR",
    9: "USER_CURRENT",
}


def main():
    parser = argparse.ArgumentParser(
        description="Sweep every SimConnect sim object type index.")
    parser.add_argument("--max", type=int, default=20,
                        help="highest type index to try (default 20)")
    parser.add_argument("--radius", type=int, default=20000,
                        help="search radius in metres (default 20000)")
    parser.add_argument("--dll", default=None)
    args = parser.parse_args()

    print("Connecting to Flight Simulator...")
    try:
        link = sc.SimConnect("FaunaTypeSweep", args.dll)
    except sc.SimConnectError as err:
        print("\n%s" % err)
        return 1
    print("Connected via %s\n" % link.dll_path)

    for _key, datum, units, datatype in FIELDS:
        link.add_to_data_definition(DEFINE_ID, datum, units, datatype)

    parse_fields = [(k, u, d) for k, _n, u, d in FIELDS]
    expected = sc.SIMOBJECT_DATA_HEADER + sc.payload_size(parse_fields)

    results = defaultdict(list)
    exceptions = defaultdict(int)
    pending = {}

    print("Requesting types 0..%d at %.0f km...\n" % (args.max, args.radius / 1000.0))
    for index in range(args.max + 1):
        request_id = REQUEST_BASE + index
        pending[request_id] = index
        try:
            link.request_data_on_sim_object_type(
                request_id, DEFINE_ID, args.radius, index)
        except sc.SimConnectError:
            exceptions[index] += 1

    # Give the sim a decent window -- a wide type sweep is more work than a
    # normal poll and the replies trickle in.
    deadline = time.monotonic() + 12.0
    while time.monotonic() < deadline:
        message = link.get_next_dispatch()
        if message is None:
            time.sleep(0.01)
            continue
        recv_id, raw = message

        if recv_id == sc.RECV_ID_EXCEPTION:
            exc = sc.RecvException.from_buffer_copy(raw)
            exceptions[sc.EXCEPTION_NAMES.get(exc.dwException, exc.dwException)] += 1
            continue
        if recv_id != sc.RECV_ID_SIMOBJECT_DATA_BYTYPE or len(raw) < expected:
            continue

        header = sc.RecvSimObjectData.from_buffer_copy(raw)
        index = pending.get(header.dwRequestID)
        if index is None:
            continue
        data = sc.parse_payload(raw, parse_fields)
        if abs(data["lat"]) < 1e-4 and abs(data["lon"]) < 1e-4:
            continue
        results[index].append((header.dwObjectID, data["title"], data["category"]))

    line = "=" * 74
    print(line)
    print("SIM OBJECT TYPE SWEEP")
    print(line)
    print("\n%-6s %-18s %-8s %s" % ("TYPE", "SDK NAME", "OBJECTS", "SAMPLE TITLES"))
    print("-" * 74)

    for index in range(args.max + 1):
        found = results.get(index, [])
        name = KNOWN.get(index, "(unnamed)")
        titles = []
        for _oid, title, _cat in found:
            if title and title not in titles:
                titles.append(title)
            if len(titles) >= 3:
                break
        sample = ", ".join(t[:26] for t in titles) if titles else ""
        print("%-6d %-18s %-8d %s" % (index, name, len(found), sample))

    unnamed = [i for i in results if i not in KNOWN and results[i]]
    print("\n" + line)
    if unnamed:
        print("UNNAMED TYPES THAT RETURNED OBJECTS: %s"
              % ", ".join(str(i) for i in sorted(unnamed)))
        print("One of these is very likely FLYING_ANIMAL. Full listing:\n")
        for index in sorted(unnamed):
            print("  --- type %d (%d objects) ---" % (index, len(results[index])))
            seen = {}
            for _oid, title, cat in results[index]:
                seen[(title, cat)] = seen.get((title, cat), 0) + 1
            for (title, cat), count in sorted(seen.items()):
                print("      %-42s x%-4d cat=%s" % (title[:42], count, cat))
    else:
        print("No undocumented type returned anything.")
        print("If developer mode shows FLYING_ANIMAL with a count right now,")
        print("then birds are not exposed through RequestDataOnSimObjectType")
        print("at all, and the hunt cannot see them by this route.")

    if exceptions:
        print("\nExceptions raised: %s"
              % ", ".join("%s x%d" % (k, v) for k, v in exceptions.items()))

    print(line)
    link.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

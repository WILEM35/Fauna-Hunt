"""
species_catalog.py -- dump every animal (and optionally aircraft) title the
sim has installed, without flying anywhere.

Uses SimConnect_EnumerateSimObjectsAndLiveries, which lists the whole installed
catalogue rather than only what has streamed in around you. That gives the full
species table for the game in one shot, and settles whether birds are filed
under AIRCRAFT.

Usage:
    python species_catalog.py                 # animals
    python species_catalog.py --type aircraft # find the birds
    python species_catalog.py --type both
"""

import argparse
import json
import os
import re
import sys
import time

# simconnect_ffi lives with the service, which is the shipped copy.
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                os.pardir, "PackageSources", "Copys",
                                "fauna-hunt", "Service"))

import simconnect_ffi as sc

REQUEST_ANIMAL = 900
REQUEST_AIRCRAFT = 901

# Titles that look like wildlife rather than machinery, for the bird hunt
# through the aircraft catalogue.
FAUNA_HINTS = re.compile(
    r"eagle|bird|gull|hawk|falcon|vulture|stork|crane|heron|flamingo|pelican|"
    r"goose|geese|duck|swan|owl|raven|crow|albatross|condor|kite|osprey|"
    r"buzzard|swift|swallow|starling|bat\b|butterfly|insect|dragon",
    re.IGNORECASE,
)

# Latin-ish binomial titles the animal packages use, e.g.
# "BTaurusPrimigeniusFemaleVariation2" -> genus B(os) Taurus...
SPLIT_CAMEL = re.compile(r"(?<=[a-z])(?=[A-Z])")


def prettify(title):
    """Best-effort human label for a raw sim title."""
    words = SPLIT_CAMEL.sub(" ", title)
    words = re.sub(r"\s*Variation\s*\d+$", "", words)
    return words.strip()


def species_root(title):
    """Strip sex and variation suffixes so variants group into one species."""
    root = re.sub(r"(Male|Female)?(Variation\d+)?$", "", title)
    return root or title


def collect(link, request_id, object_type, timeout=25.0):
    """Fire an enumeration request and gather every transmission."""
    link.enumerate_simobjects_and_liveries(request_id, object_type)

    entries = []
    exceptions = []
    seen_transmissions = set()
    expected = None
    deadline = time.monotonic() + timeout

    while time.monotonic() < deadline:
        message = link.get_next_dispatch()
        if message is None:
            time.sleep(0.01)
            continue

        recv_id, raw = message
        if recv_id == sc.RECV_ID_EXCEPTION:
            exc = sc.RecvException.from_buffer_copy(raw)
            exceptions.append(sc.EXCEPTION_NAMES.get(exc.dwException, str(exc.dwException)))
            break
        if recv_id != sc.RECV_ID_ENUMERATE_SIMOBJECT_AND_LIVERY_LIST:
            continue

        header, chunk = sc.parse_livery_list(raw)
        if header.dwRequestID != request_id:
            continue

        entries.extend(chunk)
        seen_transmissions.add(header.dwEntryNumber)
        expected = header.dwOutOf
        if expected and len(seen_transmissions) >= expected:
            break

    return entries, exceptions, expected


def report(label, entries, exceptions, expected):
    print("\n" + "=" * 78)
    print("%s CATALOGUE" % label.upper())
    print("=" * 78)

    if exceptions:
        print("\nSimConnect refused the request: %s" % ", ".join(exceptions))
        print("(This type may not support enumeration.)")
        return {}

    titles = sorted({title for title, _livery in entries if title})
    print("\n%d entries received across %s transmission(s); %d unique title(s)."
          % (len(entries), expected if expected else "?", len(titles)))

    groups = {}
    for title in titles:
        groups.setdefault(species_root(title), []).append(title)

    print("\n%-34s %s" % ("SPECIES (grouped)", "VARIANTS"))
    print("-" * 78)
    for root in sorted(groups):
        variants = groups[root]
        print("%-34s %d" % (prettify(root)[:34], len(variants)))
        for variant in variants:
            print("      %s" % variant)

    return groups


def report_fauna_in_aircraft(entries):
    hits = sorted({title for title, _livery in entries
                   if title and FAUNA_HINTS.search(title)})
    print("\n" + "-" * 78)
    print("WILDLIFE-LOOKING TITLES IN THE AIRCRAFT CATALOGUE")
    print("-" * 78)
    if hits:
        for title in hits:
            print("  %s" % title)
        print("\n-> Birds ARE filed as aircraft. The hunt needs a second query")
        print("   against AIRCRAFT, filtered to these titles.")
    else:
        print("  None found.")
        print("\n-> No bird titles in the aircraft catalogue. Birds are either")
        print("   absent from this install or not exposed as sim objects.")
    return hits


def main():
    parser = argparse.ArgumentParser(
        description="List installed animal/aircraft sim object titles.")
    parser.add_argument("--type", choices=["animal", "aircraft", "both"],
                        default="animal")
    parser.add_argument("--out", default=None, help="path for the JSON dump")
    parser.add_argument("--dll", default=None, help="explicit SimConnect.dll path")
    args = parser.parse_args()

    print("Connecting to Flight Simulator...")
    try:
        link = sc.SimConnect("FaunaCatalog", args.dll)
    except sc.SimConnectError as err:
        print("\n%s" % err)
        return 1
    print("Connected via %s" % link.dll_path)

    result = {"generated": time.strftime("%Y-%m-%d %H:%M:%S")}

    if args.type in ("animal", "both"):
        print("\nEnumerating ANIMAL catalogue (this can take a few seconds)...")
        entries, exceptions, expected = collect(link, REQUEST_ANIMAL, sc.OBJECT_TYPE_ANIMAL)
        groups = report("animal", entries, exceptions, expected)
        result["animals"] = {
            "titles": sorted({t for t, _l in entries if t}),
            "grouped": {root: sorted(v) for root, v in groups.items()},
            "exceptions": exceptions,
        }

    if args.type in ("aircraft", "both"):
        print("\nEnumerating AIRCRAFT catalogue (large -- be patient)...")
        entries, exceptions, expected = collect(
            link, REQUEST_AIRCRAFT, sc.OBJECT_TYPE_AIRCRAFT, timeout=60.0)
        titles = sorted({t for t, _l in entries if t})
        print("\n%d entries, %d unique aircraft title(s)." % (len(entries), len(titles)))
        hits = report_fauna_in_aircraft(entries)
        result["aircraft"] = {
            "unique_count": len(titles),
            "wildlife_titles": hits,
            "exceptions": exceptions,
        }

    out = args.out or os.path.join(
        os.path.dirname(os.path.abspath(__file__)),
        time.strftime("catalog-%Y%m%d-%H%M%S.json"))
    with open(out, "w", encoding="utf-8") as handle:
        json.dump(result, handle, indent=2)
    print("\nWritten to %s" % out)

    link.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())

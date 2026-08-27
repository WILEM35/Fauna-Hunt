"""
fauna_probe.py -- reconnaissance for the MSFS 2024 fauna hunt.

Polls SimConnect for nearby sim objects by type and reports what the sim
actually hands us, so the game design can be built on facts instead of
guesses. Specifically it answers:

  1. Does SIMCONNECT_SIMOBJECT_TYPE_ANIMAL return anything, and what titles?
  2. Are birds reported as AIRCRAFT (the eagle is a "passiveaircraft" package)?
  3. Do animals also show up under GROUND, i.e. is ANIMAL a strict subset?
  4. Are object IDs stable over time, or do they churn as fauna streams in
     and out? (Decides whether "already spotted this one" can be trusted.)
  5. Do the animals move, and how fast?
  6. How far out does fauna stream in? (Sets the hunt's search radius.)

Usage:
    python fauna_probe.py                     # 2 minutes, 100 km radius
    python fauna_probe.py --duration 300      # longer sample
    python fauna_probe.py --radius 20000      # tighter radius
    python fauna_probe.py --types animal      # just animals

Ctrl+C stops early and still prints the report.
"""

import argparse
import json
import math
import os
import sys
import time
from collections import defaultdict

# simconnect_ffi lives with the service, which is the shipped copy.
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                os.pardir, "PackageSources", "Copys",
                                "fauna-hunt", "Service"))

import simconnect_ffi as sc

# ------------------------------------------------------------- definition

# (key, simvar, units, datatype). Order matters -- it is the wire order.
FIELDS = [
    ("lat", "PLANE LATITUDE", "degrees", sc.DATATYPE_FLOAT64),
    ("lon", "PLANE LONGITUDE", "degrees", sc.DATATYPE_FLOAT64),
    ("alt_ft", "PLANE ALTITUDE", "feet", sc.DATATYPE_FLOAT64),
    ("agl_ft", "PLANE ALT ABOVE GROUND", "feet", sc.DATATYPE_FLOAT64),
    ("hdg", "PLANE HEADING DEGREES TRUE", "degrees", sc.DATATYPE_FLOAT64),
    ("gs_kt", "GROUND VELOCITY", "knots", sc.DATATYPE_FLOAT64),
    ("title", "TITLE", None, sc.DATATYPE_STRING256),
    ("category", "CATEGORY", None, sc.DATATYPE_STRING256),
]

DEFINE_ID = 1

TYPE_CHOICES = {
    "animal": sc.OBJECT_TYPE_ANIMAL,
    "aircraft": sc.OBJECT_TYPE_AIRCRAFT,
    "ground": sc.OBJECT_TYPE_GROUND,
    "helicopter": sc.OBJECT_TYPE_HELICOPTER,
    "boat": sc.OBJECT_TYPE_BOAT,
    "balloon": sc.OBJECT_TYPE_HOT_AIR_BALLOON,
    "all": sc.OBJECT_TYPE_ALL,
}

REQUEST_USER = 100
REQUEST_BASE = 200  # REQUEST_BASE + index into the polled type list

# ----------------------------------------------------------------- geo

EARTH_RADIUS_M = 6371000.0


def haversine_m(lat1, lon1, lat2, lon2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_RADIUS_M * math.asin(min(1.0, math.sqrt(a)))


def bearing_deg(lat1, lon1, lat2, lon2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dl = math.radians(lon2 - lon1)
    y = math.sin(dl) * math.cos(p2)
    x = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl)
    return (math.degrees(math.atan2(y, x)) + 360.0) % 360.0


def clock_position(relative_bearing):
    hour = int(round(relative_bearing / 30.0)) % 12
    return 12 if hour == 0 else hour


# --------------------------------------------------------------- tracking

class TrackedObject:
    __slots__ = ("key", "type_name", "object_id", "titles", "categories",
                 "first_seen", "last_seen", "polls", "first_pos", "last_pos",
                 "path_m", "min_dist", "max_dist", "gaps", "_was_missing")

    def __init__(self, type_name, object_id, now):
        self.key = (type_name, object_id)
        self.type_name = type_name
        self.object_id = object_id
        self.titles = []
        self.categories = []
        self.first_seen = now
        self.last_seen = now
        self.polls = 0
        self.first_pos = None
        self.last_pos = None
        self.path_m = 0.0
        self.min_dist = None
        self.max_dist = None
        self.gaps = 0
        self._was_missing = False

    def update(self, data, now, user):
        self.last_seen = now
        self.polls += 1
        if data["title"] and data["title"] not in self.titles:
            self.titles.append(data["title"])
        if data["category"] and data["category"] not in self.categories:
            self.categories.append(data["category"])

        pos = (data["lat"], data["lon"], data["alt_ft"])
        if self.first_pos is None:
            self.first_pos = pos
        else:
            self.path_m += haversine_m(self.last_pos[0], self.last_pos[1], pos[0], pos[1])
        self.last_pos = pos

        if user:
            dist = haversine_m(user["lat"], user["lon"], pos[0], pos[1])
            self.min_dist = dist if self.min_dist is None else min(self.min_dist, dist)
            self.max_dist = dist if self.max_dist is None else max(self.max_dist, dist)

        if self._was_missing:
            self.gaps += 1
            self._was_missing = False

    def mark_missing(self):
        self._was_missing = True

    @property
    def title(self):
        return self.titles[0] if self.titles else "(no title)"

    @property
    def net_displacement_m(self):
        if not self.first_pos or not self.last_pos:
            return 0.0
        return haversine_m(self.first_pos[0], self.first_pos[1],
                           self.last_pos[0], self.last_pos[1])


class Probe:
    def __init__(self, radius_m, type_names, dll_path=None):
        self.radius_m = radius_m
        self.type_names = type_names
        self.link = sc.SimConnect("FaunaProbe", dll_path)
        self.fields = list(FIELDS)
        self.dropped_fields = []
        self.exceptions = []
        self._sendid_to_datum = {}
        self.user = None
        self.tracked = {}
        self.poll_log = []
        self._pending = {}  # request id -> type name
        self._seen_this_poll = set()
        self.null_island = 0
        self.first_seen_order = []
        self._build_definition()

    # -------------------------------------------------------- definition

    def _build_definition(self):
        """Add every field, then drop any the sim rejected and rebuild."""
        self._add_fields(self.fields)
        self._pump(1.0)

        bad = {d for d in (self._sendid_to_datum.get(e["send_id"])
                           for e in self.exceptions) if d}
        if not bad:
            return

        print("  ! sim rejected simvar(s): %s -- rebuilding without them"
              % ", ".join(sorted(bad)))
        self.dropped_fields = [f for f in self.fields if f[1] in bad]
        self.fields = [f for f in self.fields if f[1] not in bad]
        self.exceptions.clear()
        self._sendid_to_datum.clear()
        self.link.dll.SimConnect_ClearDataDefinition(self.link.handle, DEFINE_ID)
        self._add_fields(self.fields)
        self._pump(1.0)

    def _add_fields(self, fields):
        for _key, datum, units, datatype in fields:
            self.link.add_to_data_definition(DEFINE_ID, datum, units, datatype)
            send_id = self.link.last_sent_packet_id()
            if send_id is not None:
                self._sendid_to_datum[send_id] = datum

    @property
    def parse_fields(self):
        return [(key, units, datatype) for key, _datum, units, datatype in self.fields]

    @property
    def expected_size(self):
        return sc.SIMOBJECT_DATA_HEADER + sc.payload_size(self.parse_fields)

    # ------------------------------------------------------------- polling

    def _pump(self, seconds):
        """Drain the dispatch queue for a while."""
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            message = self.link.get_next_dispatch()
            if message is None:
                time.sleep(0.01)
                continue
            self._handle(*message)

    def _handle(self, recv_id, raw):
        if recv_id == sc.RECV_ID_EXCEPTION:
            exc = sc.RecvException.from_buffer_copy(raw)
            self.exceptions.append({
                "code": exc.dwException,
                "name": sc.EXCEPTION_NAMES.get(exc.dwException, str(exc.dwException)),
                "send_id": exc.dwSendID,
                "index": exc.dwIndex,
            })
            return

        if recv_id == sc.RECV_ID_QUIT:
            raise KeyboardInterrupt("sim closed the connection")

        if recv_id != sc.RECV_ID_SIMOBJECT_DATA_BYTYPE:
            return

        header = sc.RecvSimObjectData.from_buffer_copy(raw)
        if len(raw) < self.expected_size:
            return  # short payload, definition mismatch -- skip rather than misparse

        data = sc.parse_payload(raw, self.parse_fields)
        now = time.monotonic()

        if header.dwRequestID == REQUEST_USER:
            self.user = data
            return

        # Objects report lat/lon 0,0 for a poll or two while they stream in.
        # Left in, they read as contacts ~6000 km away moving at Mach 800.
        if abs(data["lat"]) < 1e-4 and abs(data["lon"]) < 1e-4:
            self.null_island += 1
            return

        type_name = self._pending.get(header.dwRequestID)
        if type_name is None:
            return

        key = (type_name, header.dwObjectID)
        entry = self.tracked.get(key)
        if entry is None:
            entry = TrackedObject(type_name, header.dwObjectID, now)
            self.tracked[key] = entry
        entry.update(data, now, self.user)
        self._seen_this_poll.add(key)

    def poll(self):
        self._seen_this_poll = set()

        self.link.request_data_on_sim_object_type(
            REQUEST_USER, DEFINE_ID, 0, sc.OBJECT_TYPE_USER)
        self._pump(0.25)

        self._pending = {}
        for index, name in enumerate(self.type_names):
            request_id = REQUEST_BASE + index
            self._pending[request_id] = name
            self.link.request_data_on_sim_object_type(
                request_id, DEFINE_ID, self.radius_m, TYPE_CHOICES[name])
        self._pump(0.85)

        for key, entry in self.tracked.items():
            if key not in self._seen_this_poll:
                entry.mark_missing()

        counts = defaultdict(int)
        for type_name, _object_id in self._seen_this_poll:
            counts[type_name] += 1
        self.poll_log.append({
            "t": time.time(),
            "user": dict(self.user) if self.user else None,
            "counts": dict(counts),
        })
        return counts

    def close(self):
        self.link.close()


# ----------------------------------------------------------------- output

def format_live_line(elapsed, counts, type_names, user):
    parts = ["t=%5.0fs" % elapsed]
    for name in type_names:
        parts.append("%s=%-3d" % (name[:4], counts.get(name, 0)))
    if user:
        parts.append("| you %.4f,%.4f %.0fft %.0fkt"
                     % (user["lat"], user["lon"], user["alt_ft"], user["gs_kt"]))
    return "  ".join(parts)


def print_report(probe, elapsed):
    line = "=" * 78
    print("\n" + line)
    print("FAUNA PROBE REPORT   (%.0fs sample, radius %.0f km)"
          % (elapsed, probe.radius_m / 1000.0))
    print(line)

    if probe.dropped_fields:
        print("\nSimvars the sim rejected: %s"
              % ", ".join(f[1] for f in probe.dropped_fields))

    by_type = defaultdict(list)
    for entry in probe.tracked.values():
        by_type[entry.type_name].append(entry)

    # ---- 1/2: what came back per type
    print("\n1) OBJECTS RETURNED PER TYPE")
    for name in probe.type_names:
        entries = by_type.get(name, [])
        print("\n  %s -- %d distinct object id(s)" % (name.upper(), len(entries)))
        if not entries:
            print("      (nothing returned)")
            continue
        species = defaultdict(list)
        for entry in entries:
            species[entry.title].append(entry)
        for title in sorted(species):
            group = species[title]
            cats = sorted({c for e in group for c in e.categories})
            nearest = min((e.min_dist for e in group if e.min_dist is not None),
                          default=None)
            print("      %-42s x%-3d %s%s"
                  % (title[:42], len(group),
                     "cat=%s " % ",".join(cats) if cats else "",
                     "nearest=%.0fm" % nearest if nearest is not None else ""))

    # ---- 3: type overlap
    print("\n2) TYPE OVERLAP (is ANIMAL a subset of GROUND or ALL?)")
    ids_by_type = {name: {e.object_id for e in by_type.get(name, [])}
                   for name in probe.type_names}
    printed = False
    for i, a in enumerate(probe.type_names):
        for b in probe.type_names[i + 1:]:
            shared = ids_by_type[a] & ids_by_type[b]
            if shared:
                print("  %s and %s share %d object id(s) -- e.g. %s"
                      % (a.upper(), b.upper(), len(shared),
                         sorted(shared)[:5]))
                printed = True
    if not printed:
        print("  No object id appeared under more than one type.")

    # ---- 4: id stability
    print("\n3) OBJECT ID STABILITY (can we trust 'already spotted'?)")
    reused = [e for e in probe.tracked.values() if len(e.titles) > 1]
    gapped = [e for e in probe.tracked.values() if e.gaps > 0]
    peak = 0
    for entry in probe.poll_log:
        peak = max(peak, sum(entry["counts"].values()))
    print("  Distinct ids seen over the sample .. %d" % len(probe.tracked))
    print("  Peak seen in any single poll ....... %d" % peak)
    print("  Ids that changed title ............. %d" % len(reused))
    print("  Ids that vanished and came back .... %d" % len(gapped))
    if peak and len(probe.tracked) > peak * 1.5 and not gapped:
        print("  ! Ids are SINGLE USE. %d distinct ids but never more than %d"
              % (len(probe.tracked), peak))
        print("    at once, and none ever returned. The same animal streaming")
        print("    back in gets a fresh id -- dedupe on species+position.")
    if probe.null_island:
        print("  Records dropped at lat/lon 0,0 ..... %d (streaming in)"
              % probe.null_island)
    for entry in reused[:5]:
        print("      ! id %d reported as: %s"
              % (entry.object_id, " -> ".join(entry.titles)))
    if not reused and not gapped:
        print("  Verdict: ids look stable over this sample.")
    elif reused:
        print("  Verdict: ids ARE recycled. Identify sightings by title+position,")
        print("           not by object id alone.")
    else:
        print("  Verdict: ids survive, but objects stream in and out of range.")

    # ---- 5: movement
    print("\n4) MOVEMENT")
    movers = [e for e in probe.tracked.values() if e.path_m > 5.0]
    print("  Objects that moved >5 m ............ %d of %d"
          % (len(movers), len(probe.tracked)))
    if movers:
        movers.sort(key=lambda e: e.path_m, reverse=True)
        for entry in movers[:8]:
            span = max(1e-6, entry.last_seen - entry.first_seen)
            print("      %-38s %6.0f m travelled, %5.1f m/s, net %.0f m"
                  % (entry.title[:38], entry.path_m, entry.path_m / span,
                     entry.net_displacement_m))

    # ---- 6: streaming radius
    print("\n5) STREAMING RADIUS (how far out fauna is reported)")
    for name in probe.type_names:
        entries = [e for e in by_type.get(name, []) if e.max_dist is not None]
        if not entries:
            continue
        far = max(e.max_dist for e in entries)
        near = min(e.min_dist for e in entries if e.min_dist is not None)
        print("  %-10s nearest %7.0f m   farthest %8.0f m"
              % (name.upper(), near, far))
    print("  (If farthest sits well under the %.0f km request radius, that gap"
          % (probe.radius_m / 1000.0))
    print("   is the sim's own streaming limit -- the hunt must live inside it.)")

    # ---- 7: nearest right now
    if probe.user:
        print("\n6) NEAREST FAUNA AT END OF SAMPLE")
        candidates = []
        for entry in probe.tracked.values():
            if entry.last_pos is None or entry.min_dist is None:
                continue
            dist = haversine_m(probe.user["lat"], probe.user["lon"],
                               entry.last_pos[0], entry.last_pos[1])
            brg = bearing_deg(probe.user["lat"], probe.user["lon"],
                              entry.last_pos[0], entry.last_pos[1])
            rel = (brg - probe.user["hdg"] + 360.0) % 360.0
            candidates.append((dist, entry, brg, rel))
        candidates.sort(key=lambda item: item[0])
        for dist, entry, brg, rel in candidates[:12]:
            print("      %-34s %-9s %6.0f m  brg %03.0f  %2d o'clock"
                  % (entry.title[:34], entry.type_name, dist, brg,
                     clock_position(rel)))

    if probe.exceptions:
        print("\n7) SIMCONNECT EXCEPTIONS")
        tally = defaultdict(int)
        for exc in probe.exceptions:
            tally[exc["name"]] += 1
        for name, count in sorted(tally.items()):
            print("      %-28s x%d" % (name, count))

    print("\n" + line)


def save_json(probe, elapsed, path):
    payload = {
        "generated": time.strftime("%Y-%m-%d %H:%M:%S"),
        "sample_seconds": elapsed,
        "radius_m": probe.radius_m,
        "types": probe.type_names,
        "dropped_simvars": [f[1] for f in probe.dropped_fields],
        "null_island_records": probe.null_island,
        "objects": [
            {
                "type": e.type_name,
                "object_id": e.object_id,
                "titles": e.titles,
                "categories": e.categories,
                "polls": e.polls,
                "gaps": e.gaps,
                "first_pos": e.first_pos,
                "last_pos": e.last_pos,
                "path_m": round(e.path_m, 2),
                "min_dist_m": None if e.min_dist is None else round(e.min_dist, 1),
                "max_dist_m": None if e.max_dist is None else round(e.max_dist, 1),
            }
            for e in probe.tracked.values()
        ],
        "polls": probe.poll_log,
        "exceptions": probe.exceptions,
    }
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2)
    return path


# -------------------------------------------------------------------- main

def main():
    parser = argparse.ArgumentParser(
        description="Probe MSFS 2024 for fauna sim objects via SimConnect.")
    parser.add_argument("--radius", type=int, default=100000,
                        help="search radius in metres (default 100000)")
    parser.add_argument("--interval", type=float, default=3.0,
                        help="seconds between polls (default 3)")
    parser.add_argument("--duration", type=float, default=120.0,
                        help="total sample length in seconds (default 120)")
    parser.add_argument("--types", default="animal,aircraft,ground",
                        help="comma separated: " + ",".join(sorted(TYPE_CHOICES)))
    parser.add_argument("--out", default=None,
                        help="path for the JSON dump (default alongside this script)")
    parser.add_argument("--dll", default=None, help="explicit path to SimConnect.dll")
    args = parser.parse_args()

    type_names = [t.strip().lower() for t in args.types.split(",") if t.strip()]
    unknown = [t for t in type_names if t not in TYPE_CHOICES]
    if unknown:
        parser.error("unknown type(s): %s" % ", ".join(unknown))

    print("Connecting to Flight Simulator...")
    try:
        probe = Probe(args.radius, type_names, args.dll)
    except sc.SimConnectError as err:
        print("\n%s" % err)
        return 1

    print("Connected via %s" % probe.link.dll_path)
    print("Polling %s every %.1fs for %.0fs, radius %.0f km. Ctrl+C to stop early.\n"
          % ("/".join(type_names), args.interval, args.duration, args.radius / 1000.0))

    started = time.monotonic()
    try:
        while True:
            elapsed = time.monotonic() - started
            if elapsed >= args.duration:
                break
            counts = probe.poll()
            print(format_live_line(elapsed, counts, type_names, probe.user))
            remaining = args.interval - (time.monotonic() - started - elapsed)
            if remaining > 0:
                time.sleep(remaining)
    except KeyboardInterrupt:
        print("\nStopped early.")

    elapsed = time.monotonic() - started
    print_report(probe, elapsed)

    out = args.out or os.path.join(
        os.path.dirname(os.path.abspath(__file__)),
        time.strftime("probe-%Y%m%d-%H%M%S.json"))
    print("Full data written to %s" % save_json(probe, elapsed, out))

    probe.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())

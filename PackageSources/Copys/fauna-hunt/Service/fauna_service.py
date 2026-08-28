"""
fauna_service.py -- the Fauna Hunt data layer.

Polls SimConnect for animals, cleans up what the sim hands back, groups
individuals into herds, and serves the result as JSON on localhost for the
toolbar panel to read.

It serves *exact* positions. All the deliberate vagueness -- the range tiers,
the withheld species name -- lives in the panel, so difficulty can be retuned
without touching this file.

What it cleans up, all of it learned the hard way from the probe runs:

  * The ANIMAL query returns walking people, Jurassic World dinosaurs and a
    Stranger Things demogorgon. Only titles in species.json get through.
  * Objects report lat/lon 0,0 for a poll or two while streaming in.
  * Object ids are single use -- the same cow gets a new id every time it
    streams back in -- so contacts are keyed on species plus a position grid.
  * The sim caps the response at 250 objects, so a full list is never a
    complete list. The `capped` flag says when that happened.

Usage:
    python fauna_service.py
    python fauna_service.py --port 8760 --interval 1.0
    python fauna_service.py --once        # one poll, print JSON, exit
"""

import argparse
import json
import math
import os
import sys
import threading
import ctypes
import time
from collections import defaultdict
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# Everything the service needs sits beside it in the package: the ctypes
# binding and the species table. No path juggling, no dev folders.
def _app_dir():
    """Folder the app lives in -- next to the .exe when frozen."""
    if getattr(sys, "frozen", False):
        return os.path.dirname(sys.executable)
    return os.path.dirname(os.path.abspath(__file__))


HERE = _app_dir()
sys.path.insert(0, HERE)

import simconnect_ffi as sc

# ---------------------------------------------------------------- constants

FIELDS = [
    ("lat", "PLANE LATITUDE", "degrees", sc.DATATYPE_FLOAT64),
    ("lon", "PLANE LONGITUDE", "degrees", sc.DATATYPE_FLOAT64),
    ("alt_ft", "PLANE ALTITUDE", "feet", sc.DATATYPE_FLOAT64),
    ("hdg", "PLANE HEADING DEGREES TRUE", "degrees", sc.DATATYPE_FLOAT64),
    ("gs_kt", "GROUND VELOCITY", "knots", sc.DATATYPE_FLOAT64),
    ("title", "TITLE", None, sc.DATATYPE_STRING256),
]

DEFINE_ID = 1
REQUEST_USER = 100
REQUEST_ANIMAL = 200
REQUEST_AIRCRAFT = 201

# How much of the screen counts as "looking at it". The sim reports its own
# field of view, so half of that means anything actually visible qualifies --
# and it adapts on its own between 2D and VR, which report different values.
VIEW_CONE_FRACTION = 0.5

# The sim streams fauna in a radius that grows with altitude: about 2.8 km on
# the deck, 30 km at FL280. Asking for more than the sim spawns costs nothing,
# so ask wide and let the panel decide what is in play.
SEARCH_RADIUS_M = 60000

# The one bird in the sim. Everything else matching /eagle|osprey|condor/ in
# the aircraft catalogue turned out to be an airline livery.
EAGLE_TITLE = "Asobo PassiveAircraft Eagle"
EAGLE_SPECIES = {
    "common": "Golden Eagle", "scientific": "Aquila chrysaetos",
    "size": "small", "tier": "rare", "points": 200, "rank": 4,
    "region": "Global", "group": "Golden Eagle",
}

# Same species within this distance of each other read as one herd.
HERD_RADIUS_M = 250.0

# Position grid for contact identity, ~500 m. Coarse enough that a herd keeps
# the same key across the sim's id churn, fine enough that two herds in
# neighbouring fields stay distinct.
GRID_DEGREES = 0.005

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


def angle_between(view_heading, view_pitch, target_bearing, target_elevation):
    """Angle in degrees between where the camera points and where the animal is.

    Done in 3D rather than on the compass alone: from 1000 ft the animal can be
    dead ahead on the compass and still 40 degrees below the nose, and someone
    staring at the sky should not be capturing it.
    """
    to_rad = math.pi / 180.0
    v_h, v_p = view_heading * to_rad, view_pitch * to_rad
    t_h, t_p = target_bearing * to_rad, target_elevation * to_rad
    vx = math.cos(v_p) * math.cos(v_h)
    vy = math.cos(v_p) * math.sin(v_h)
    vz = math.sin(v_p)
    tx = math.cos(t_p) * math.cos(t_h)
    ty = math.cos(t_p) * math.sin(t_h)
    tz = math.sin(t_p)
    dot = max(-1.0, min(1.0, vx * tx + vy * ty + vz * tz))
    return math.degrees(math.acos(dot))


def clock_position(relative_bearing):
    hour = int(round(relative_bearing / 30.0)) % 12
    return 12 if hour == 0 else hour


# ------------------------------------------------------------ species table

class SpeciesTable:
    def __init__(self, path):
        with open(path, encoding="utf-8") as handle:
            data = json.load(handle)
        self.species = data["species"]
        self.title_to_species = data["title_to_species"]
        self.excluded = set(data.get("excluded_titles", []))

    def resolve(self, title):
        """Raw sim TITLE -> (species_root, info) or None if not huntable."""
        root = self.title_to_species.get(title)
        if root is None:
            return None
        return root, self.species[root]

    def sex_of(self, root, title):
        for variant in self.species[root]["variants"]:
            if variant["title"] == title:
                return variant["sex"]
        return "unknown"


# ------------------------------------------------------------------ polling

class FaunaService:
    def __init__(self, species_path, radius_m=SEARCH_RADIUS_M, dll_path=None):
        self.table = SpeciesTable(species_path)
        self.radius_m = radius_m
        self.dll_path = dll_path
        # Deliberately does NOT connect here. The service is meant to be
        # started before the sim, so connecting is a background concern and
        # never a reason to refuse to run.
        self.link = None
        self.fields = list(FIELDS)

        self.lock = threading.Lock()
        self._user = None
        self._camera = None
        self._raw = []
        self._rejected = defaultdict(int)
        self.snapshot = self._waiting_snapshot()

    @property
    def connected(self):
        return self.link is not None

    def _waiting_snapshot(self):
        return {
            "connected": False,
            "status": "waiting for the simulator",
            "user": None,
            "contacts": [],
            "stats": {},
            "updated": time.time(),
        }

    def connect(self):
        """One connection attempt. True on success, False if the sim isn't up."""
        try:
            link = sc.SimConnect("FaunaHunt", self.dll_path)
        except sc.SimConnectError:
            return False

        try:
            # A reconnect gets a fresh handle, so the data definition has to be
            # registered again -- definitions do not survive the old session.
            for _key, datum, units, datatype in self.fields:
                link.add_to_data_definition(DEFINE_ID, datum, units, datatype)
        except sc.SimConnectError:
            link.close()
            return False

        self.link = link
        return True

    def disconnect(self):
        if self.link is not None:
            self.link.close()
            self.link = None
        self._user = None
        with self.lock:
            self.snapshot = self._waiting_snapshot()

    @property
    def parse_fields(self):
        return [(k, u, d) for k, _n, u, d in self.fields]

    @property
    def expected_size(self):
        return sc.SIMOBJECT_DATA_HEADER + sc.payload_size(self.parse_fields)

    # ------------------------------------------------------------- dispatch

    def _pump(self, seconds):
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            message = self.link.get_next_dispatch()
            if message is None:
                time.sleep(0.005)
                continue
            self._handle(*message)

    def _handle(self, recv_id, raw):
        if recv_id == sc.RECV_ID_CAMERA_DATA:
            if len(raw) >= ctypes.sizeof(sc.RecvCameraData):
                self._camera = sc.RecvCameraData.from_buffer_copy(raw)
            return
        if recv_id == sc.RECV_ID_QUIT:
            # Sim shutting down. Not fatal -- the poll loop drops back to
            # waiting and picks the sim up again when it returns.
            raise sc.SimConnectLost("the simulator closed the connection")
        if recv_id != sc.RECV_ID_SIMOBJECT_DATA_BYTYPE:
            return
        if len(raw) < self.expected_size:
            return

        header = sc.RecvSimObjectData.from_buffer_copy(raw)
        data = sc.parse_payload(raw, self.parse_fields)

        if header.dwRequestID == REQUEST_USER:
            self._user = data
            return

        # Streaming in: real position has not arrived yet.
        if abs(data["lat"]) < 1e-4 and abs(data["lon"]) < 1e-4:
            self._rejected["streaming_in"] += 1
            return

        title = data["title"]

        if header.dwRequestID == REQUEST_AIRCRAFT:
            if title != EAGLE_TITLE:
                return
            self._raw.append((title, "Eagle", EAGLE_SPECIES, data))
            return

        resolved = self.table.resolve(title)
        if resolved is None:
            # People, dinosaurs, addon reskins, AnimalError.
            self._rejected["not_huntable"] += 1
            return
        root, info = resolved
        self._raw.append((title, root, info, data))

    # ----------------------------------------------------------------- poll

    def poll(self):
        self._raw = []
        self._rejected = defaultdict(int)

        self.link.request_data_on_sim_object_type(
            REQUEST_USER, DEFINE_ID, 0, sc.OBJECT_TYPE_USER)
        try:
            # Where the player is actually looking. Works in 2D and VR alike,
            # and needs no camera control -- reading is free.
            self.link.camera_get(sc.POSITION_REFERENTIAL_WORLD)
        except sc.SimConnectError:
            self._camera = None
        self._pump(0.15)

        self.link.request_data_on_sim_object_type(
            REQUEST_ANIMAL, DEFINE_ID, self.radius_m, sc.OBJECT_TYPE_ANIMAL)
        self.link.request_data_on_sim_object_type(
            REQUEST_AIRCRAFT, DEFINE_ID, self.radius_m, sc.OBJECT_TYPE_AIRCRAFT)
        self._pump(0.55)

        contacts = self._build_contacts()
        stats = {
            "raw_returned": len(self._raw),
            "individuals": sum(c["count"] for c in contacts),
            "contacts": len(contacts),
            # The sim tops out at 250 objects per request. At the cap we are
            # seeing an arbitrary subset, so the panel must never claim the
            # area is empty of anything else.
            "capped": len(self._raw) + self._rejected["not_huntable"] >= 250,
            "rejected": dict(self._rejected),
        }

        with self.lock:
            fov = None
            if self._camera is not None:
                fov = round(math.degrees(self._camera.fov), 1)
            self.snapshot = {
                "connected": True,
                "status": "connected",
                # Half the field of view is the cone that counts as looking at
                # something. Sent so the panel does not have to guess, and so
                # it adapts between 2D and VR on its own.
                "view_cone_deg": round(fov * VIEW_CONE_FRACTION, 1) if fov else None,
                "fov_deg": fov,
                "user": self._user,
                "contacts": contacts,
                "stats": stats,
                "updated": time.time(),
            }
        return self.snapshot

    def _build_contacts(self):
        """Group individuals into herds and describe each relative to the user."""
        if not self._user:
            return []

        by_species = defaultdict(list)
        for title, root, info, data in self._raw:
            by_species[(root, info["common"])].append((title, root, info, data))

        contacts = []
        for (root, _common), members in by_species.items():
            for herd in self._cluster(members):
                contacts.append(self._describe(root, herd))

        contacts.sort(key=lambda c: c["distance_m"])
        return contacts

    @staticmethod
    def _cluster(members):
        """Greedy clustering -- fine at these counts, and herds are compact."""
        remaining = list(members)
        clusters = []
        while remaining:
            seed = remaining.pop()
            herd = [seed]
            slat, slon = seed[3]["lat"], seed[3]["lon"]
            still = []
            for other in remaining:
                if haversine_m(slat, slon, other[3]["lat"], other[3]["lon"]) <= HERD_RADIUS_M:
                    herd.append(other)
                else:
                    still.append(other)
            remaining = still
            clusters.append(herd)
        return clusters

    def _describe(self, root, herd):
        user = self._user
        lat = sum(m[3]["lat"] for m in herd) / len(herd)
        lon = sum(m[3]["lon"] for m in herd) / len(herd)
        alt = sum(m[3]["alt_ft"] for m in herd) / len(herd)
        info = herd[0][2]

        distance = haversine_m(user["lat"], user["lon"], lat, lon)
        # Capture is judged on the CLOSEST animal, not the middle of the herd:
        # a scattered group can have its centre 400 m away while one animal is
        # right under the wing, and that is the one you flew down to see.
        nearest = min(haversine_m(user["lat"], user["lon"],
                                  m[3]["lat"], m[3]["lon"]) for m in herd)
        bearing = bearing_deg(user["lat"], user["lon"], lat, lon)
        relative = (bearing - user["hdg"] + 360.0) % 360.0

        sexes = defaultdict(int)
        for title, species_root, _info, _data in herd:
            if species_root == "Eagle":
                sexes["unknown"] += 1
            else:
                sexes[self.table.sex_of(species_root, title)] += 1

        # How far off the animal is from where the player is looking. None when
        # the sim gives us no camera -- the panel must then let everything
        # through rather than locking the player out of their own game.
        off_view = None
        if self._camera is not None:
            drop_m = (user["alt_ft"] - alt) * 0.3048
            elevation = -math.degrees(math.atan2(drop_m, max(1.0, nearest)))
            off_view = round(angle_between(
                self._camera.heading, self._camera.pitch, bearing, elevation), 1)

        return {
            # Stable across the sim's object-id churn: species plus a coarse
            # position grid. This is what the lifelist dedupes on.
            "key": "%s@%.3f,%.3f" % (root, round(lat / GRID_DEGREES) * GRID_DEGREES,
                                     round(lon / GRID_DEGREES) * GRID_DEGREES),
            "species": root,
            "common": info["common"],
            "scientific": info["scientific"],
            "size": info["size"],
            # Read with .get: the species table is data the panel and the
            # service share, and a missing key here killed the whole
            # service on its first animal rather than degrading.
            "tier": info.get("tier", "common"),
            "points": info.get("points", 20),
            "rank": info.get("rank", 2),
            "group": info.get("group", info.get("common", "")),
            "region": info["region"],
            "count": len(herd),
            "sexes": dict(sexes),
            "lat": round(lat, 6),
            "lon": round(lon, 6),
            "alt_ft": round(alt, 1),
            "distance_m": round(distance, 1),
            "nearest_m": round(nearest, 1),
            "off_view_deg": off_view,
            "bearing_deg": round(bearing, 1),
            "relative_bearing_deg": round(relative, 1),
            "clock": clock_position(relative),
            "above": alt > user["alt_ft"] + 100,
        }

    def close(self):
        self.disconnect()


# -------------------------------------------------------------------- http

def make_handler(service, species_path):
    with open(species_path, encoding="utf-8") as handle:
        species_blob = handle.read()

    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def _send(self, payload, status=200):
            body = payload.encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            # The panel is served from coui://, a different origin.
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            path = self.path.split("?", 1)[0].rstrip("/") or "/"
            if path in ("/", "/contacts"):
                with service.lock:
                    self._send(json.dumps(service.snapshot))
            elif path == "/species":
                self._send(species_blob)
            elif path == "/health":
                with service.lock:
                    age = time.time() - service.snapshot["updated"]
                self._send(json.dumps({
                    "ok": True,
                    "sim_connected": service.connected,
                    "age_seconds": round(age, 2),
                }))
            else:
                self._send(json.dumps({"error": "not found"}), 404)

        def log_message(self, *args):
            pass  # quiet; the poll loop already prints a status line

    return Handler


# -------------------------------------------------------------------- main

def main():
    parser = argparse.ArgumentParser(description="Fauna Hunt data service.")
    parser.add_argument("--port", type=int, default=8760)
    parser.add_argument("--interval", type=float, default=1.0,
                        help="seconds between SimConnect polls")
    parser.add_argument("--radius", type=int, default=SEARCH_RADIUS_M)
    parser.add_argument("--species", default=os.path.join(HERE, "species.json"))
    parser.add_argument("--once", action="store_true",
                        help="single poll, print the JSON, exit")
    parser.add_argument("--dll", default=None)
    args = parser.parse_args()

    if not os.path.isfile(args.species):
        print("species.json not found at %s\nRun probe/build_species_table.py first."
              % args.species)
        return 1

    try:
        service = FaunaService(args.species, args.radius, args.dll)
    except sc.SimConnectError as err:
        # Only a missing SimConnect.dll gets this far -- not a missing sim.
        print("\n%s" % err)
        return 1
    print("%d species loaded" % len(service.table.species))

    if args.once:
        if not service.connect():
            print("Flight Simulator is not running.")
            return 1
        print(json.dumps(service.poll(), indent=2))
        service.disconnect()
        return 0

    # The web server comes up first and stays up regardless of the sim, so the
    # panel always has something to talk to and this can be launched at any
    # point before, during or after starting the sim.
    handler = make_handler(service, args.species)
    httpd = ThreadingHTTPServer(("127.0.0.1", args.port), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    print("\nServing on http://127.0.0.1:%d" % args.port)
    print("   /contacts   live herds around you")
    print("   /species    the full species table")
    print("   /health     liveness")
    print("\nStart the sim whenever you like -- this waits for it, and keeps")
    print("waiting if you restart it. Ctrl+C to stop.\n")

    announced_waiting = False
    try:
        while True:
            started = time.monotonic()

            if not service.connected:
                if service.connect():
                    print("Connected to Flight Simulator via %s"
                          % service.link.dll_path)
                    announced_waiting = False
                else:
                    if not announced_waiting:
                        print("Waiting for Flight Simulator...")
                        announced_waiting = True
                    time.sleep(max(args.interval, 2.0))
                    continue

            try:
                snapshot = service.poll()
            except sc.SimConnectLost:
                print("Flight Simulator closed. Waiting for it to come back...")
                service.disconnect()
                announced_waiting = True
                continue
            except sc.SimConnectError as err:
                print("Lost the connection (%s). Reconnecting..." % err)
                service.disconnect()
                announced_waiting = True
                continue

            stats = snapshot["stats"]
            nearest = snapshot["contacts"][0] if snapshot["contacts"] else None
            line = "%2d contacts  %3d individuals" % (stats["contacts"], stats["individuals"])
            if stats["capped"]:
                line += "  [CAPPED]"
            if nearest:
                line += "   nearest: %-24s %6.0f m  %2d o'clock" % (
                    nearest["common"], nearest["distance_m"], nearest["clock"])
            print(line)

            remaining = args.interval - (time.monotonic() - started)
            if remaining > 0:
                time.sleep(remaining)
    except KeyboardInterrupt:
        print("\nStopping.")

    httpd.shutdown()
    service.disconnect()
    return 0


if __name__ == "__main__":
    sys.exit(main())

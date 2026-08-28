"""
camera_probe.py -- can we tell where the player is LOOKING?

Identifying an animal should require having it in view. The removed SPOT
button tried to enforce that with a cone around PLANE HEADING DEGREES TRUE --
the aircraft's nose -- which is useless in VR, where you can be looking
straight down at an elephant while the nose points elsewhere.

MSFS 2024's SimConnect has SimConnect_CameraGet, which returns the camera's
own position, pitch/bank/heading and field of view. In VR the camera is the
headset, so in principle that is exactly what is needed. Three things have to
be true before the mechanic is worth designing:

  1. Does the heading follow YOUR HEAD, or only the aircraft?
     Sit still, turn your head (or pan the 2D camera) and watch the numbers.
  2. Does reading it require SimConnect_CameraAcquire?
     If reading needs taking camera control away from the player, the feature
     is dead -- that is unacceptable in a spotting game. This probe never
     acquires; if readings come back anyway, reading is free.
  3. Does it update at head-turn speed, or only once in a while?

Run it in a flight, then follow the on-screen prompts.

Usage:
    python camera_probe.py
    python camera_probe.py --seconds 30
"""

import argparse
import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                os.pardir, "PackageSources", "Copys",
                                "fauna-hunt", "Service"))

import simconnect_ffi as sc

# Aircraft heading, so the camera can be compared against it. If the two move
# together and never diverge, the camera is not tracking the head.
FIELDS = [
    ("lat", "PLANE LATITUDE", "degrees", sc.DATATYPE_FLOAT64),
    ("lon", "PLANE LONGITUDE", "degrees", sc.DATATYPE_FLOAT64),
    ("hdg", "PLANE HEADING DEGREES TRUE", "degrees", sc.DATATYPE_FLOAT64),
]
DEFINE_ID = 1
REQUEST_USER = 100


def to_degrees(value):
    """SimConnect angles are usually radians, but this is not documented for
    the camera, so decide from the data rather than assuming: a heading in
    radians never exceeds ~6.3, one in degrees runs to 360."""
    return value * 180.0 / 3.141592653589793


def main():
    parser = argparse.ArgumentParser(description="Probe the sim's camera orientation.")
    parser.add_argument("--seconds", type=float, default=25.0)
    parser.add_argument("--acquire", action="store_true",
                        help="call CameraAcquire first. WARNING: this may take "
                             "camera control -- watch the screen while it runs.")
    parser.add_argument("--dll", default=None)
    args = parser.parse_args()

    print("Connecting to Flight Simulator...")
    try:
        link = sc.SimConnect("FaunaCameraProbe", args.dll)
    except sc.SimConnectError as err:
        print("\n%s" % err)
        return 1
    print("Connected via %s\n" % link.dll_path)

    for _key, datum, units, datatype in FIELDS:
        link.add_to_data_definition(DEFINE_ID, datum, units, datatype)
    parse_fields = [(k, u, d) for k, _n, u, d in FIELDS]
    expected = sc.SIMOBJECT_DATA_HEADER + sc.payload_size(parse_fields)

    print("=" * 72)
    print("  KEEP THE AIRCRAFT STILL AND LOOK AROUND.")
    print("  In VR: turn your head. In 2D: pan the camera with the mouse.")
    print("  Watch whether CAM HDG moves while PLANE HDG stays put.")
    print("=" * 72)
    print()

    if args.acquire:
        print("Acquiring the camera. WATCH THE SCREEN -- if your view jumps or\n"
              "you lose control of it, that answers the question on its own.\n")
        try:
            link.camera_acquire("FaunaHunt")
        except sc.SimConnectError as err:
            print("  CameraAcquire failed: %s\n" % err)

    link.camera_get_status()

    samples = []
    status_seen = None
    exceptions = {}
    seen_ids = {}
    camera_raw_sizes = set()
    units = set()
    started = time.monotonic()
    last_print = 0.0

    while time.monotonic() - started < args.seconds:
        link.request_data_on_sim_object_type(
            REQUEST_USER, DEFINE_ID, 0, sc.OBJECT_TYPE_USER)
        try:
            link.camera_get(sc.POSITION_REFERENTIAL_WORLD)
        except sc.SimConnectError as err:
            exceptions[str(err)] = exceptions.get(str(err), 0) + 1

        plane = None
        camera = None
        deadline = time.monotonic() + 0.25
        while time.monotonic() < deadline:
            message = link.get_next_dispatch()
            if message is None:
                time.sleep(0.005)
                continue
            recv_id, raw = message
            seen_ids[recv_id] = seen_ids.get(recv_id, 0) + 1

            if recv_id == sc.RECV_ID_EXCEPTION:
                exc = sc.RecvException.from_buffer_copy(raw)
                name = sc.EXCEPTION_NAMES.get(exc.dwException, str(exc.dwException))
                exceptions[name] = exceptions.get(name, 0) + 1
            elif recv_id == sc.RECV_ID_CAMERA_STATUS:
                st = sc.RecvCameraStatus.from_buffer_copy(raw)
                status_seen = "%s (game controlled: %s)" % (
                    sc.CAMERA_AVAILABILITY.get(st.acquiredState, st.acquiredState),
                    bool(st.gameControlled))
            elif recv_id == sc.RECV_ID_CAMERA_DATA:
                camera_raw_sizes.add(len(raw))
                if len(raw) >= ctypes_size():
                    camera = sc.RecvCameraData.from_buffer_copy(raw)
            elif recv_id == sc.RECV_ID_SIMOBJECT_DATA_BYTYPE and len(raw) >= expected:
                plane = sc.parse_payload(raw, parse_fields)

        if camera is not None:
            plane_hdg = plane["hdg"] if plane else float("nan")
            samples.append((camera.heading, camera.pitch, camera.roll,
                            plane_hdg, camera.fov,
                            camera.rotationReferential, camera.positionReferential))
            now = time.monotonic() - started
            if now - last_print >= 0.6:
                last_print = now
                # Raw, unconverted. Guessing units produced mixed nonsense last
                # time -- read the numbers and decide, do not let code assume.
                print("  looking: pitch %7.2f  heading %7.2f  roll %6.2f | fov %6.3f "
                      "| rotRef %d posRef %d | plane hdg %6.1f"
                      % (camera.pitch, camera.heading, camera.roll, camera.fov,
                         camera.rotationReferential, camera.positionReferential,
                         plane_hdg))
        time.sleep(0.05)

    print()
    print("=" * 72)
    print("RESULT")
    print("=" * 72)

    print("\n  messages received, by type:")
    for rid in sorted(seen_ids):
        label = {sc.RECV_ID_EXCEPTION: "EXCEPTION",
                 sc.RECV_ID_SIMOBJECT_DATA_BYTYPE: "SIMOBJECT_DATA_BYTYPE",
                 sc.RECV_ID_CAMERA_DATA: "CAMERA_DATA",
                 sc.RECV_ID_CAMERA_STATUS: "CAMERA_STATUS"}.get(rid, "id %d" % rid)
        print("      %-24s x%d" % (label, seen_ids[rid]))
    if camera_raw_sizes:
        print("  CAMERA_DATA payload sizes seen: %s (struct expects %d)"
              % (sorted(camera_raw_sizes), ctypes_size()))

    if not samples:
        if sc.RECV_ID_CAMERA_DATA in seen_ids:
            print("\n  Camera data DID arrive but was not parsed -- so the struct")
            print("  layout is wrong, not the API. Compare the sizes above.")
        else:
            print("\n  No CAMERA_DATA message arrived at all.")
            if not args.acquire:
                print("  Next: re-run with --acquire and WATCH THE SCREEN.")
                print("  If data appears and your view is undisturbed, the")
                print("  mechanic is viable. If your view is hijacked, it is not.")
            else:
                print("  It did not arrive even after acquiring, so this call")
                print("  is not usable from an external client.")
    else:
        headings = [s[0] for s in samples]
        pitches = [s[1] for s in samples]
        planes = [s[3] for s in samples if s[3] == s[3]]
        refs = sorted({(s[5], s[6]) for s in samples})
        print("")
        print("  samples ................. %d over %.0fs (%.1f/sec)"
              % (len(samples), args.seconds, len(samples) / args.seconds))
        print("  raw heading ............. %.3f to %.3f  (range %.3f)"
              % (min(headings), max(headings), max(headings) - min(headings)))
        print("  raw pitch ............... %.3f to %.3f" % (min(pitches), max(pitches)))
        print("  raw fov ................. %.3f" % samples[-1][4])
        if planes:
            print("  aircraft heading ........ %.1f to %.1f deg" % (min(planes), max(planes)))
        print("  (rotationReferential, positionReferential) seen: %s" % refs)
        print("    0=NONE 1=SIMOBJECT 2=WORLD 3=EYEPOINT 4=SIMOBJECT_DATUM")

        span = max(headings) - min(headings)
        print()
        if any(r[0] == 1 or r[0] == 4 for r in refs):
            print("  Rotation is reported RELATIVE TO THE AIRCRAFT, so the heading")
            print("  is an offset from the nose -- which is exactly what the")
            print("  mechanic needs, and it already accounts for the aircraft.")
        elif any(r[0] == 2 for r in refs):
            print("  Rotation is WORLD-absolute -- compare it against the bearing")
            print("  to the animal directly.")
        if span < 0.5:
            print("  WARNING: heading barely moved. Either the view was not moved")
            print("  during the test, or this is not the view direction.")
    if status_seen:
        print("\n  camera status ........... %s" % status_seen)
        print("  (reported WITHOUT acquiring, so reading looks free)")
    if exceptions:
        print("\n  exceptions: %s" % ", ".join("%s x%d" % kv for kv in exceptions.items()))

    print("=" * 72)
    link.close()
    return 0


def ctypes_size():
    import ctypes
    return ctypes.sizeof(sc.RecvCameraData)


if __name__ == "__main__":
    raise SystemExit(main())

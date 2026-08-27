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


def degrees(radians):
    """The camera's PBH comes back in radians."""
    return radians * 180.0 / 3.141592653589793


def main():
    parser = argparse.ArgumentParser(description="Probe the sim's camera orientation.")
    parser.add_argument("--seconds", type=float, default=25.0)
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

    link.camera_get_status()

    samples = []
    status_seen = None
    exceptions = {}
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
                if len(raw) >= ctypes_size():
                    camera = sc.RecvCameraData.from_buffer_copy(raw)
            elif recv_id == sc.RECV_ID_SIMOBJECT_DATA_BYTYPE and len(raw) >= expected:
                plane = sc.parse_payload(raw, parse_fields)

        if camera is not None:
            heading = degrees(camera.heading) % 360.0
            pitch = degrees(camera.pitch)
            fov = degrees(camera.fov)
            plane_hdg = plane["hdg"] if plane else float("nan")
            samples.append((heading, pitch, plane_hdg, fov))
            now = time.monotonic() - started
            if now - last_print >= 0.5:
                last_print = now
                print("  CAM HDG %6.1f   PITCH %6.1f   FOV %5.1f   |   PLANE HDG %6.1f   diff %6.1f"
                      % (heading, pitch, fov, plane_hdg,
                         ((heading - plane_hdg + 180) % 360) - 180))
        time.sleep(0.05)

    print()
    print("=" * 72)
    print("RESULT")
    print("=" * 72)

    if not samples:
        print("\nNo camera data came back at all.")
        print("Either CameraGet needs SimConnect_CameraAcquire first, or the")
        print("call is not usable from an external client. Either way, view")
        print("direction cannot be read this way.")
    else:
        cam = [s[0] for s in samples]
        diffs = [((s[0] - s[2] + 180) % 360) - 180 for s in samples
                 if s[2] == s[2]]
        spread = (max(diffs) - min(diffs)) if diffs else 0.0
        print("\n  samples ................. %d over %.0fs (%.1f/sec)"
              % (len(samples), args.seconds, len(samples) / args.seconds))
        print("  camera heading range .... %.1f deg" % (max(cam) - min(cam)))
        print("  camera-minus-plane range  %.1f deg" % spread)
        print("  field of view ........... %.1f deg" % samples[-1][3])
        print()
        if spread > 15:
            print("  The camera moves INDEPENDENTLY of the aircraft.")
            print("  This is what the mechanic needs -- gate identification on")
            print("  the camera heading, and it works the same in 2D and VR.")
        else:
            print("  The camera heading barely diverged from the aircraft's.")
            print("  Either you did not look around during the test, or this")
            print("  reports the aircraft rather than the view. Re-run and")
            print("  deliberately look well off to one side before concluding.")

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

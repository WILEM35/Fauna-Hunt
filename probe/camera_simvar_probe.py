"""Can view direction be read as an ordinary variable?

Fauna Hunt currently gets the player's view direction from SimConnect's camera
call, which only an external program can make. If the same information is
available as a plain simulation variable, the panel can read it ITSELF -- no
helper app, and no dependence on the WASM camera call that appears to be
keeping the probe module from loading.

The F/A-18's helmet-mounted display reads exactly these two, which is the same
problem: where is the pilot looking, including in VR.

Read-only. Safe to run mid-flight.
"""

import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                os.pardir, "PackageSources", "Copys",
                                "fauna-hunt", "Service"))

import simconnect_ffi as sc

FIELDS = [
    ("pitch", "CAMERA GAMEPLAY PITCH YAW:0", "degrees", sc.DATATYPE_FLOAT64),
    ("yaw",   "CAMERA GAMEPLAY PITCH YAW:1", "degrees", sc.DATATYPE_FLOAT64),
    ("hdg",   "PLANE HEADING DEGREES TRUE",  "degrees", sc.DATATYPE_FLOAT64),
]
DEFINE_ID = 7
REQUEST_ID = 700


def main():
    seconds = float(sys.argv[1]) if len(sys.argv) > 1 else 20.0
    try:
        link = sc.SimConnect("FaunaCameraSimvar")
    except sc.SimConnectError as err:
        print("Not connected: %s" % err)
        return 1
    print("Connected.\n")

    for _k, datum, units, dt in FIELDS:
        link.add_to_data_definition(DEFINE_ID, datum, units, dt)
    parse = [(k, u, d) for k, _n, u, d in FIELDS]
    expected = sc.SIMOBJECT_DATA_HEADER + sc.payload_size(parse)

    print("LOOK AROUND -- turn your head in VR, or pan with the mouse.")
    print("Watch whether yaw moves while the aircraft heading stays put.\n")

    samples = []
    started = time.monotonic()
    last = 0.0
    while time.monotonic() - started < seconds:
        link.request_data_on_sim_object_type(REQUEST_ID, DEFINE_ID, 0,
                                             sc.OBJECT_TYPE_USER)
        deadline = time.monotonic() + 0.2
        while time.monotonic() < deadline:
            msg = link.get_next_dispatch()
            if msg is None:
                time.sleep(0.005)
                continue
            rid, raw = msg
            if rid == sc.RECV_ID_EXCEPTION:
                exc = sc.RecvException.from_buffer_copy(raw)
                name = sc.EXCEPTION_NAMES.get(exc.dwException, exc.dwException)
                print("  exception: %s  <- the variable is probably not valid" % name)
            elif rid == sc.RECV_ID_SIMOBJECT_DATA_BYTYPE and len(raw) >= expected:
                d = sc.parse_payload(raw, parse)
                samples.append(d)
                now = time.monotonic() - started
                if now - last >= 0.7:
                    last = now
                    print("   pitch %7.2f   yaw %7.2f   |  aircraft heading %6.1f"
                          % (d["pitch"], d["yaw"], d["hdg"]))
        time.sleep(0.05)

    print("\n" + "=" * 62)
    if not samples:
        print("No data. The variable is not readable this way.")
    else:
        yaws = [s["yaw"] for s in samples]
        pitches = [s["pitch"] for s in samples]
        hdgs = [s["hdg"] for s in samples]
        print("  samples ......... %d" % len(samples))
        print("  yaw ............. %.2f to %.2f   (moved %.2f)"
              % (min(yaws), max(yaws), max(yaws) - min(yaws)))
        print("  pitch ........... %.2f to %.2f   (moved %.2f)"
              % (min(pitches), max(pitches), max(pitches) - min(pitches)))
        print("  aircraft heading  %.1f to %.1f   (moved %.1f)"
              % (min(hdgs), max(hdgs), max(hdgs) - min(hdgs)))
        if max(yaws) - min(yaws) > 2.0:
            print("\n  YAW TRACKS YOUR VIEW. The panel can read this itself.")
        else:
            print("\n  Yaw barely moved -- either the view was not moved, or")
            print("  this is not the view direction.")
    print("=" * 62)
    link.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

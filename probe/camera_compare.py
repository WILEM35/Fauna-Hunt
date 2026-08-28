"""Compare three possible sources of view direction, side by side.

The game reads the player's view today with SimConnect's camera call, which
only an external program can make. If a plain simulation variable carries the
same information, the panel could read it directly and the helper app would not
be needed for this.

A first run showed the variables sitting at exactly zero while the aircraft
turned. That is ambiguous: it looks the same whether the view was never panned
or the variable is simply never populated. So this shows the KNOWN-GOOD camera
call in the same line -- if that one moves and the variables do not, the answer
is settled.

Read-only. Safe mid-flight.
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
    ("state", "CAMERA STATE",                "number",  sc.DATATYPE_FLOAT64),
    ("sub",   "CAMERA SUBSTATE",             "number",  sc.DATATYPE_FLOAT64),
    ("hdg",   "PLANE HEADING DEGREES TRUE",  "degrees", sc.DATATYPE_FLOAT64),
]
DEFINE_ID = 8
REQUEST_ID = 800


def main():
    seconds = float(sys.argv[1]) if len(sys.argv) > 1 else 18.0
    try:
        link = sc.SimConnect("FaunaCameraCompare")
    except sc.SimConnectError as err:
        print("Not connected: %s" % err)
        return 1
    print("Connected.\n")

    for _k, datum, units, dt in FIELDS:
        link.add_to_data_definition(DEFINE_ID, datum, units, dt)
    parse = [(k, u, d) for k, _n, u, d in FIELDS]
    expected = sc.SIMOBJECT_DATA_HEADER + sc.payload_size(parse)

    print("PAN THE VIEW ONLY -- hold the right mouse button and drag, or use")
    print("the hat switch. Try not to turn the aircraft.\n")
    print("  %-9s %-9s | %-11s %-9s | %s" %
          ("var pitch", "var yaw", "CAMERA CALL", "aircraft", "camera mode"))

    rows = []
    started = time.monotonic()
    last = 0.0
    while time.monotonic() - started < seconds:
        link.request_data_on_sim_object_type(REQUEST_ID, DEFINE_ID, 0,
                                             sc.OBJECT_TYPE_USER)
        try:
            link.camera_get(sc.POSITION_REFERENTIAL_WORLD)
        except sc.SimConnectError:
            pass

        data = None
        cam = None
        deadline = time.monotonic() + 0.2
        while time.monotonic() < deadline:
            msg = link.get_next_dispatch()
            if msg is None:
                time.sleep(0.005)
                continue
            rid, raw = msg
            if rid == sc.RECV_ID_SIMOBJECT_DATA_BYTYPE and len(raw) >= expected:
                data = sc.parse_payload(raw, parse)
            elif rid == sc.RECV_ID_CAMERA_DATA:
                cam = sc.RecvCameraData.from_buffer_copy(raw)

        if data:
            ch = cam.heading if cam else float("nan")
            rows.append((data["pitch"], data["yaw"], ch, data["hdg"],
                         data["state"], data["sub"]))
            now = time.monotonic() - started
            if now - last >= 0.8:
                last = now
                print("  %9.2f %9.2f | %11.2f %9.1f | mode %.0f.%.0f"
                      % (data["pitch"], data["yaw"], ch, data["hdg"],
                         data["state"], data["sub"]))
        time.sleep(0.05)

    print("\n" + "=" * 64)
    if not rows:
        print("No data at all.")
    else:
        def span(i):
            vals = [r[i] for r in rows if r[i] == r[i]]
            return (max(vals) - min(vals)) if vals else 0.0
        vp, vy, cc, ah = span(0), span(1), span(2), span(3)
        print("  how much each moved over %.0fs:" % seconds)
        print("     variable pitch ......... %.2f" % vp)
        print("     variable yaw ........... %.2f" % vy)
        print("     camera call heading .... %.2f" % cc)
        print("     aircraft heading ....... %.2f" % ah)
        print("     camera modes seen ...... %s"
              % sorted({(int(r[4]), int(r[5])) for r in rows}))
        print()
        if vy > 2.0 or vp > 2.0:
            print("  THE VARIABLES TRACK THE VIEW. The panel can read this itself,")
            print("  and the helper app is not needed for view direction.")
        elif cc > 2.0:
            print("  The camera CALL moved but the variables did not. So the")
            print("  variables are not a substitute -- view direction has to come")
            print("  from the camera call, which means it cannot come from a panel.")
        else:
            print("  Nothing moved. The view was probably not panned -- try again")
            print("  and pan deliberately.")
    print("=" * 64)
    link.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

"""Parse the import section of a .wasm file.

A WebAssembly module lists every host function it calls, by name, in a
plain import section. That makes an installed module hard evidence of what
the sim's WASM runtime actually provides -- far better than guessing from
headers.
"""
import sys


def leb(buf, i):
    val = 0
    shift = 0
    while True:
        b = buf[i]
        i += 1
        val |= (b & 0x7F) << shift
        if not b & 0x80:
            return val, i
        shift += 7


def imports(path):
    buf = open(path, "rb").read()
    if buf[:4] != b"\0asm":
        return None
    i = 8
    out = []
    while i < len(buf):
        sec = buf[i]
        i += 1
        size, i = leb(buf, i)
        end = i + size
        if sec == 2:
            count, i = leb(buf, i)
            for _ in range(count):
                n, i = leb(buf, i)
                mod = buf[i:i + n].decode("utf-8", "replace"); i += n
                n, i = leb(buf, i)
                fld = buf[i:i + n].decode("utf-8", "replace"); i += n
                kind = buf[i]; i += 1
                if kind == 0:
                    _, i = leb(buf, i)
                elif kind == 1:
                    i += 1
                    fl, i = leb(buf, i)
                    _, i = leb(buf, i)
                    if fl & 1:
                        _, i = leb(buf, i)
                elif kind == 2:
                    fl, i = leb(buf, i)
                    _, i = leb(buf, i)
                    if fl & 1:
                        _, i = leb(buf, i)
                elif kind == 3:
                    i += 2
                out.append((mod, fld))
        i = end
    return out


if __name__ == "__main__":
    for path in sys.argv[1:]:
        try:
            imp = imports(path)
        except Exception as err:
            print("  !! %s: %s" % (path.split("\\")[-1], err))
            continue
        if imp is None:
            continue
        names = sorted({f for _m, f in imp})
        sc = [n for n in names if n.startswith("SimConnect_")]
        fs = [n for n in names if n.startswith("fs") or n.startswith("Comm")]
        print("=" * 70)
        print(path.split("\\")[-1], "-- %d imports" % len(names))
        if sc:
            print("  SimConnect (%d):" % len(sc))
            for n in sc:
                print("     ", n)
        if fs:
            print("  fs*/CommBus:", ", ".join(fs))

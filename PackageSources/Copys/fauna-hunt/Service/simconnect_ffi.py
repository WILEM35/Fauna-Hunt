"""
Minimal ctypes binding for the MSFS 2024 SimConnect C API.

Only the calls the fauna probe needs. No third-party deps -- this talks to
SimConnect.dll from the MSFS 2024 SDK directly.
"""

import ctypes
import os
import sys
from ctypes import wintypes

# ---------------------------------------------------------------- enums

# SIMCONNECT_RECV_ID (SimConnect.h)
RECV_ID_NULL = 0
RECV_ID_EXCEPTION = 1
RECV_ID_OPEN = 2
RECV_ID_QUIT = 3
RECV_ID_SIMOBJECT_DATA = 8
RECV_ID_SIMOBJECT_DATA_BYTYPE = 9
RECV_ID_ENUMERATE_SIMOBJECT_AND_LIVERY_LIST = 38

# SIMCONNECT_DATATYPE
DATATYPE_INT32 = 1
DATATYPE_INT64 = 2
DATATYPE_FLOAT32 = 3
DATATYPE_FLOAT64 = 4
DATATYPE_STRING8 = 5
DATATYPE_STRING32 = 6
DATATYPE_STRING64 = 7
DATATYPE_STRING128 = 8
DATATYPE_STRING256 = 9

STRING_SIZES = {
    DATATYPE_STRING8: 8,
    DATATYPE_STRING32: 32,
    DATATYPE_STRING64: 64,
    DATATYPE_STRING128: 128,
    DATATYPE_STRING256: 256,
}

# SIMCONNECT_SIMOBJECT_TYPE -- ANIMAL exists only in the 2024 SDK
OBJECT_TYPE_USER = 0
OBJECT_TYPE_ALL = 1
OBJECT_TYPE_AIRCRAFT = 2
OBJECT_TYPE_HELICOPTER = 3
OBJECT_TYPE_BOAT = 4
OBJECT_TYPE_GROUND = 5
OBJECT_TYPE_HOT_AIR_BALLOON = 6
OBJECT_TYPE_ANIMAL = 7
OBJECT_TYPE_USER_AVATAR = 8
OBJECT_TYPE_USER_CURRENT = 9

OBJECT_TYPE_NAMES = {
    OBJECT_TYPE_USER: "USER",
    OBJECT_TYPE_ALL: "ALL",
    OBJECT_TYPE_AIRCRAFT: "AIRCRAFT",
    OBJECT_TYPE_HELICOPTER: "HELICOPTER",
    OBJECT_TYPE_BOAT: "BOAT",
    OBJECT_TYPE_GROUND: "GROUND",
    OBJECT_TYPE_HOT_AIR_BALLOON: "BALLOON",
    OBJECT_TYPE_ANIMAL: "ANIMAL",
}

UNUSED = 0xFFFFFFFF

# Byte offset of the payload inside SIMCONNECT_RECV_SIMOBJECT_DATA_BYTYPE:
# dwSize dwVersion dwID dwRequestID dwObjectID dwDefineID dwFlags
# dwentrynumber dwoutof dwDefineCount == 10 DWORDs
SIMOBJECT_DATA_HEADER = 40

# SIMCONNECT_RECV_LIST_TEMPLATE: RECV (3 DWORDs) + dwRequestID dwArraySize
# dwEntryNumber dwOutOf == 7 DWORDs. Each entry is title[256] + livery[256].
LIST_TEMPLATE_HEADER = 28
LIVERY_ENTRY_SIZE = 512

# SIMCONNECT_EXCEPTION codes worth naming in output.
EXCEPTION_NAMES = {
    0: "NONE",
    1: "ERROR",
    2: "SIZE_MISMATCH",
    3: "UNRECOGNIZED_ID",
    4: "UNOPENED",
    5: "VERSION_MISMATCH",
    6: "TOO_MANY_GROUPS",
    7: "NAME_UNRECOGNIZED",
    8: "TOO_MANY_EVENT_NAMES",
    9: "EVENT_ID_DUPLICATE",
    10: "TOO_MANY_MAPS",
    11: "TOO_MANY_OBJECTS",
    12: "TOO_MANY_REQUESTS",
    24: "INVALID_DATA_TYPE",
    25: "INVALID_DATA_SIZE",
    26: "DATA_ERROR",
    27: "INVALID_ARRAY",
    31: "OBJECT_OUTSIDE_REALITY_BUBBLE",
}

def _app_dir():
    """Folder the app actually lives in, frozen by PyInstaller or not."""
    if getattr(sys, "frozen", False):
        return os.path.dirname(sys.executable)
    return os.path.dirname(os.path.abspath(__file__))


# Beside the app FIRST. Anyone running this without the MSFS SDK installed --
# which is everyone except the developer -- relies on the copy shipped in the
# package. The SDK paths are only a fallback for a dev machine.
DEFAULT_DLL_PATHS = [
    os.path.join(_app_dir(), "SimConnect.dll"),
    r"C:\MSFS 2024 SDK\SimConnect SDK\lib\SimConnect.dll",
    r"C:\MSFS SDK\SimConnect SDK\lib\SimConnect.dll",
]


class SimConnectError(RuntimeError):
    pass


class SimConnectLost(SimConnectError):
    """The sim went away mid-session -- reconnect rather than give up."""
    pass


# ctypes creates a fresh object per WinDLL() call. Windows refcounts the module
# so repeated loads are safe, but a service that reconnects for hours would
# churn through them for no reason.
_DLL_CACHE = {}


class RecvHeader(ctypes.Structure):
    _fields_ = [
        ("dwSize", wintypes.DWORD),
        ("dwVersion", wintypes.DWORD),
        ("dwID", wintypes.DWORD),
    ]


class RecvException(ctypes.Structure):
    _fields_ = [
        ("dwSize", wintypes.DWORD),
        ("dwVersion", wintypes.DWORD),
        ("dwID", wintypes.DWORD),
        ("dwException", wintypes.DWORD),
        ("dwSendID", wintypes.DWORD),
        ("dwIndex", wintypes.DWORD),
    ]


class RecvSimObjectData(ctypes.Structure):
    _fields_ = [
        ("dwSize", wintypes.DWORD),
        ("dwVersion", wintypes.DWORD),
        ("dwID", wintypes.DWORD),
        ("dwRequestID", wintypes.DWORD),
        ("dwObjectID", wintypes.DWORD),
        ("dwDefineID", wintypes.DWORD),
        ("dwFlags", wintypes.DWORD),
        ("dwentrynumber", wintypes.DWORD),
        ("dwoutof", wintypes.DWORD),
        ("dwDefineCount", wintypes.DWORD),
    ]


class RecvListTemplate(ctypes.Structure):
    _fields_ = [
        ("dwSize", wintypes.DWORD),
        ("dwVersion", wintypes.DWORD),
        ("dwID", wintypes.DWORD),
        ("dwRequestID", wintypes.DWORD),
        ("dwArraySize", wintypes.DWORD),
        ("dwEntryNumber", wintypes.DWORD),
        ("dwOutOf", wintypes.DWORD),
    ]


class SimConnect:
    """Thin wrapper around the handful of SimConnect entry points we use."""

    def __init__(self, name="FaunaProbe", dll_path=None):
        self.handle = wintypes.HANDLE()
        self.dll_path = self._resolve_dll(dll_path)
        if self.dll_path not in _DLL_CACHE:
            _DLL_CACHE[self.dll_path] = ctypes.WinDLL(self.dll_path)
        self.dll = _DLL_CACHE[self.dll_path]
        self._bind()
        self._open(name)

    @staticmethod
    def _resolve_dll(dll_path):
        candidates = [dll_path] if dll_path else DEFAULT_DLL_PATHS
        for path in candidates:
            if path and os.path.isfile(path):
                return path
        raise SimConnectError(
            "SimConnect.dll not found. Looked in:\n  "
            + "\n  ".join(p for p in candidates if p)
        )

    def _bind(self):
        d = self.dll
        d.SimConnect_Open.restype = ctypes.c_long
        d.SimConnect_Open.argtypes = [
            ctypes.POINTER(wintypes.HANDLE), ctypes.c_char_p, wintypes.HWND,
            wintypes.DWORD, wintypes.HANDLE, wintypes.DWORD,
        ]
        d.SimConnect_Close.restype = ctypes.c_long
        d.SimConnect_Close.argtypes = [wintypes.HANDLE]

        d.SimConnect_AddToDataDefinition.restype = ctypes.c_long
        d.SimConnect_AddToDataDefinition.argtypes = [
            wintypes.HANDLE, wintypes.DWORD, ctypes.c_char_p, ctypes.c_char_p,
            ctypes.c_int, ctypes.c_float, wintypes.DWORD,
        ]
        d.SimConnect_ClearDataDefinition.restype = ctypes.c_long
        d.SimConnect_ClearDataDefinition.argtypes = [wintypes.HANDLE, wintypes.DWORD]

        d.SimConnect_RequestDataOnSimObjectType.restype = ctypes.c_long
        d.SimConnect_RequestDataOnSimObjectType.argtypes = [
            wintypes.HANDLE, wintypes.DWORD, wintypes.DWORD, wintypes.DWORD,
            ctypes.c_int,
        ]

        d.SimConnect_GetNextDispatch.restype = ctypes.c_long
        d.SimConnect_GetNextDispatch.argtypes = [
            wintypes.HANDLE, ctypes.POINTER(ctypes.POINTER(RecvHeader)),
            ctypes.POINTER(wintypes.DWORD),
        ]

        d.SimConnect_GetLastSentPacketID.restype = ctypes.c_long
        d.SimConnect_GetLastSentPacketID.argtypes = [
            wintypes.HANDLE, ctypes.POINTER(wintypes.DWORD),
        ]

        d.SimConnect_EnumerateSimObjectsAndLiveries.restype = ctypes.c_long
        d.SimConnect_EnumerateSimObjectsAndLiveries.argtypes = [
            wintypes.HANDLE, wintypes.DWORD, ctypes.c_int,
        ]

    def _open(self, name):
        hr = self.dll.SimConnect_Open(
            ctypes.byref(self.handle), name.encode("utf-8"), None, 0, None, 0
        )
        if hr < 0:
            # Release anything a partial open may have taken before reporting,
            # so a caller that retries in a loop cannot leak handles.
            if self.handle:
                try:
                    self.dll.SimConnect_Close(self.handle)
                except Exception:
                    pass
            self.handle = wintypes.HANDLE()
            raise SimConnectError(
                "SimConnect_Open failed (0x%08X).\n"
                "Is Microsoft Flight Simulator running with a flight loaded?"
                % (hr & 0xFFFFFFFF)
            )

    # ------------------------------------------------------------- calls

    def add_to_data_definition(self, define_id, datum, units, datatype):
        units_arg = units.encode("utf-8") if units else None
        hr = self.dll.SimConnect_AddToDataDefinition(
            self.handle, define_id, datum.encode("utf-8"), units_arg,
            datatype, 0.0, UNUSED,
        )
        if hr < 0:
            raise SimConnectError(
                "AddToDataDefinition(%s) failed 0x%08X" % (datum, hr & 0xFFFFFFFF)
            )

    def request_data_on_sim_object_type(self, request_id, define_id, radius_m, object_type):
        hr = self.dll.SimConnect_RequestDataOnSimObjectType(
            self.handle, request_id, define_id, radius_m, object_type
        )
        if hr < 0:
            raise SimConnectError(
                "RequestDataOnSimObjectType(type=%s) failed 0x%08X"
                % (OBJECT_TYPE_NAMES.get(object_type, object_type), hr & 0xFFFFFFFF)
            )

    def enumerate_simobjects_and_liveries(self, request_id, object_type):
        hr = self.dll.SimConnect_EnumerateSimObjectsAndLiveries(
            self.handle, request_id, object_type
        )
        if hr < 0:
            raise SimConnectError(
                "EnumerateSimObjectsAndLiveries(type=%s) failed 0x%08X"
                % (OBJECT_TYPE_NAMES.get(object_type, object_type), hr & 0xFFFFFFFF)
            )

    def last_sent_packet_id(self):
        """Send ID of the most recent call -- lets us map exceptions to calls."""
        value = wintypes.DWORD()
        hr = self.dll.SimConnect_GetLastSentPacketID(self.handle, ctypes.byref(value))
        return None if hr < 0 else value.value

    def get_next_dispatch(self):
        """Return (dwID, raw_bytes) or None when the queue is empty."""
        ptr = ctypes.POINTER(RecvHeader)()
        size = wintypes.DWORD()
        hr = self.dll.SimConnect_GetNextDispatch(
            self.handle, ctypes.byref(ptr), ctypes.byref(size)
        )
        if hr < 0 or not ptr:
            return None
        raw = ctypes.string_at(ctypes.cast(ptr, ctypes.c_void_p), size.value)
        return ptr.contents.dwID, raw

    def close(self):
        if self.handle:
            try:
                self.dll.SimConnect_Close(self.handle)
            except Exception:
                pass  # the sim may already be gone; the handle dies with it
            self.handle = wintypes.HANDLE()

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()
        return False


# ------------------------------------------------------- payload parsing

def parse_payload(raw, fields):
    """Unpack a SIMOBJECT_DATA payload given the fields used to define it.

    fields is a list of (name, units, datatype) in the order they were added.
    """
    out = {}
    offset = SIMOBJECT_DATA_HEADER
    for name, _units, datatype in fields:
        if datatype == DATATYPE_FLOAT64:
            value = ctypes.c_double.from_buffer_copy(raw, offset).value
            offset += 8
        elif datatype == DATATYPE_FLOAT32:
            value = ctypes.c_float.from_buffer_copy(raw, offset).value
            offset += 4
        elif datatype == DATATYPE_INT32:
            value = ctypes.c_int32.from_buffer_copy(raw, offset).value
            offset += 4
        elif datatype == DATATYPE_INT64:
            value = ctypes.c_int64.from_buffer_copy(raw, offset).value
            offset += 8
        elif datatype in STRING_SIZES:
            size = STRING_SIZES[datatype]
            chunk = raw[offset:offset + size]
            value = chunk.split(b"\x00", 1)[0].decode("utf-8", errors="replace").strip()
            offset += size
        else:
            raise ValueError("unsupported datatype %r for %s" % (datatype, name))
        out[name] = value
    return out


def parse_livery_list(raw):
    """Unpack SIMCONNECT_RECV_ENUMERATE_SIMOBJECT_AND_LIVERY_LIST.

    Returns (header, [(title, livery), ...]).
    """
    header = RecvListTemplate.from_buffer_copy(raw)
    entries = []
    for index in range(header.dwArraySize):
        base = LIST_TEMPLATE_HEADER + index * LIVERY_ENTRY_SIZE
        if base + LIVERY_ENTRY_SIZE > len(raw):
            break
        title = raw[base:base + 256].split(b"\x00", 1)[0]
        livery = raw[base + 256:base + 512].split(b"\x00", 1)[0]
        entries.append((
            title.decode("utf-8", errors="replace").strip(),
            livery.decode("utf-8", errors="replace").strip(),
        ))
    return header, entries


def payload_size(fields):
    total = 0
    for _name, _units, datatype in fields:
        if datatype in (DATATYPE_FLOAT64, DATATYPE_INT64):
            total += 8
        elif datatype in (DATATYPE_FLOAT32, DATATYPE_INT32):
            total += 4
        else:
            total += STRING_SIZES[datatype]
    return total

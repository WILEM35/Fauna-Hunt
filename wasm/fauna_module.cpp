// Fauna Hunt -- the in-sim data module.
//
// This replaces the helper program that used to run beside the sim. It does
// ONE job: ask the sim what animals are nearby and hand the raw answer to the
// panel. It deliberately does no grouping, no species lookup and no fuzzing --
// all of that stays in the panel, in JavaScript, where it already works and
// where difficulty can be retuned by editing one file.
//
// Two things about MSFS modules that are easy to get wrong, both learned the
// hard way here:
//
//   * A module MUST export malloc and free. The sim allocates inside the
//     module's own memory to hand it strings, and if it cannot find them it
//     refuses to load the module -- reporting only "Error get malloc function
//     pointer" in the developer console, and nothing at all anywhere else.
//   * Every function the module imports must be provided by the sim, or the
//     same silent refusal happens. The stack-protector helper that clang-cl
//     adds by default is NOT provided, hence -fno-stack-protector.
//
// The panel drives the timing. A standalone module gets no tick of its own,
// and registering a dispatch callback means matching a function signature that
// differs between the desktop and WebAssembly builds of SimConnect. Polling
// with GetNextDispatch when the panel asks avoids that entirely.

#include <MSFS/MSFS.h>
#include <MSFS/MSFS_WindowsTypes.h>
#include <MSFS/MSFS_Camera.h>
#include <MSFS/MSFS_CommBus.h>
#include <SimConnect.h>

#include <stdio.h>
#include <string.h>

// Mirrors the helper's data definition exactly, so the panel receives the same
// numbers it always did.
static const int DEF_ALL = 1;
static const int REQ_USER = 100;
static const int REQ_ANIMAL = 200;
static const int REQ_AIRCRAFT = 201;

static const DWORD SEARCH_RADIUS_M = 60000;

// The sim returns at most 250 objects per request. Room for both requests plus
// headroom, since going over would silently drop animals.
static const int MAX_ROWS = 560;

// One CommBus message. Kept well clear of any limit -- the reply is split
// across as many messages as it takes and the panel reassembles them, so this
// size only affects how many messages are sent, never whether it works.
static const int CHUNK_CHARS = 3500;

struct Row
{
    double lat;
    double lon;
    double alt;
    double hdg;
    double gs;
    char   title[256];
};

static HANDLE g_sim = 0;
static bool   g_open = false;

static Row  g_rows[MAX_ROWS];
static int  g_count = 0;
static Row  g_user;
static bool g_haveUser = false;
static int  g_returned = 0;      // how many the sim offered, before our cap

static char g_out[CHUNK_CHARS + 1024];

// Where the player is LOOKING. In VR this is the headset, which the panel
// cannot get any other way: the gameplay pitch/yaw variables track the 2D
// camera only, and in VR they report the aircraft's direction no matter where
// the player's head is pointing. This call is the same one the old helper
// program used, and that one demonstrably followed the headset.
//
// Units are not documented. They are reported raw and the panel decides, using
// the field of view to tell radians from degrees -- one API returns one unit
// for all three, and a field of view is unambiguous where a heading is not.
static bool   g_camOk = false;
static double g_camH = 0.0;
static double g_camP = 0.0;
static double g_camFov = 0.0;
static int    g_camRotRef = 0;
static int    g_camPosRef = 0;

// The camera call takes a referential. Asked for WORLD it returns the
// AIRCRAFT's view direction, not the headset's -- proven by turning the
// helicopter 90 degrees while looking at the same animals: the reading moved
// with the aircraft and ignored the head entirely.
//
// So every referential the API offers is sampled and reported. If any of them
// follows the head, one flight will show it: look forward, then look 90
// degrees to the side WITHOUT turning the aircraft, and see which pair moves.
static const int REF_COUNT = 5;
static bool   g_refOk[REF_COUNT];
static double g_refH[REF_COUNT];
static double g_refP[REF_COUNT];

static void read_all_referentials()
{
    for (int r = 0; r < REF_COUNT; ++r) {
        FsCameraData c;
        if (fsCameraGet(r, &c)) {
            g_refOk[r] = true;
            g_refH[r] = c.pbh.h;
            g_refP[r] = c.pbh.p;
        } else {
            g_refOk[r] = false;
            g_refH[r] = 0.0;
            g_refP[r] = 0.0;
        }
    }
}

static void read_camera()
{
    read_all_referentials();

    FsCameraData cam;
    if (fsCameraGet(FS_POSITION_REFERENTIAL_WORLD, &cam)) {
        g_camOk = true;
        g_camH = cam.pbh.h;
        g_camP = cam.pbh.p;
        g_camFov = cam.fov;
        // The referential says what the angles are measured AGAINST, and it is
        // not necessarily the one asked for: the argument above sets the
        // POSITION referential, while rotation reports its own. Sent on so the
        // panel can tell an absolute heading from one relative to the aircraft
        // -- getting that wrong points the view rule in a direction that is
        // wrong by the aircraft's heading, which reads as "randomly broken".
        g_camRotRef = (int)cam.rotationReferential;
        g_camPosRef = (int)cam.positionReferential;
    } else {
        g_camOk = false;
    }
}

static void reset_batch()
{
    g_count = 0;
    g_returned = 0;
}

static void take(const SIMCONNECT_RECV_SIMOBJECT_DATA_BYTYPE* obj, bool isUser)
{
    const Row* row = (const Row*)&obj->dwData;
    if (isUser) {
        g_user = *row;
        g_user.title[sizeof(g_user.title) - 1] = 0;
        g_haveUser = true;
        return;
    }
    g_returned++;
    if (g_count < MAX_ROWS) {
        g_rows[g_count] = *row;
        g_rows[g_count].title[sizeof(g_rows[g_count].title) - 1] = 0;
        g_count++;
    }
}

static void drain()
{
    SIMCONNECT_RECV* data = 0;
    DWORD size = 0;
    while (SUCCEEDED(SimConnect_GetNextDispatch(g_sim, &data, &size)) && data) {
        if (data->dwID == SIMCONNECT_RECV_ID_SIMOBJECT_DATA_BYTYPE) {
            const SIMCONNECT_RECV_SIMOBJECT_DATA_BYTYPE* obj =
                (const SIMCONNECT_RECV_SIMOBJECT_DATA_BYTYPE*)data;
            if (obj->dwRequestID == REQ_USER) {
                take(obj, true);
            } else if (obj->dwRequestID == REQ_ANIMAL ||
                       obj->dwRequestID == REQ_AIRCRAFT) {
                // A fresh batch starts at the first entry of an animal reply.
                if (obj->dwentrynumber <= 1 && obj->dwRequestID == REQ_ANIMAL) {
                    reset_batch();
                }
                take(obj, false);
            }
        }
        data = 0;
    }
}

// Titles are plain letters and digits, but a stray quote or backslash would
// break the whole message rather than one row, so they are neutralised.
static void safe_title(const char* in, char* out, int cap)
{
    int j = 0;
    for (int i = 0; in[i] && j < cap - 1; ++i) {
        char c = in[i];
        if (c == 34 || c == 92 || c < 32) c = 95;   // " and backslash
        out[j++] = c;
    }
    out[j] = 0;
}

static void send_chunk(int seq, bool last, const char* rows)
{
    int n = snprintf(g_out, sizeof(g_out),
        "{\"seq\":%d,\"last\":%s,\"haveUser\":%s,"
        "\"user\":{\"lat\":%.7f,\"lon\":%.7f,\"alt_ft\":%.1f,\"hdg\":%.2f,\"gs_kt\":%.1f},"
        "\"cam\":{\"ok\":%s,\"h\":%.4f,\"p\":%.4f,\"fov\":%.4f,"
        "\"rotRef\":%d,\"posRef\":%d},"
        "\"refs\":[[%d,%.2f,%.2f],[%d,%.2f,%.2f],[%d,%.2f,%.2f],"
        "[%d,%.2f,%.2f],[%d,%.2f,%.2f]],"
        "\"returned\":%d,\"rows\":[%s]}",
        seq, last ? "true" : "false", g_haveUser ? "true" : "false",
        g_user.lat, g_user.lon, g_user.alt, g_user.hdg, g_user.gs,
        g_camOk ? "true" : "false", g_camH, g_camP, g_camFov,
        g_camRotRef, g_camPosRef,
        g_refOk[0] ? 1 : 0, g_refH[0], g_refP[0],
        g_refOk[1] ? 1 : 0, g_refH[1], g_refP[1],
        g_refOk[2] ? 1 : 0, g_refH[2], g_refP[2],
        g_refOk[3] ? 1 : 0, g_refH[3], g_refP[3],
        g_refOk[4] ? 1 : 0, g_refH[4], g_refP[4],
        g_returned, rows);
    if (n > 0) {
        fsCommBusCall("FaunaHunt.Data", g_out, (unsigned int)strlen(g_out) + 1,
                      FsCommBusBroadcast_JS);
    }
}

static void emit()
{
    static char body[CHUNK_CHARS + 512];
    static char safe[256];
    int used = 0;
    int seq = 0;
    body[0] = 0;

    for (int i = 0; i < g_count; ++i) {
        safe_title(g_rows[i].title, safe, sizeof(safe));
        char one[420];
        int n = snprintf(one, sizeof(one), "%s[\"%s\",%.7f,%.7f,%.1f]",
                         used ? "," : "", safe,
                         g_rows[i].lat, g_rows[i].lon, g_rows[i].alt);
        if (n <= 0) continue;
        if (used + n >= CHUNK_CHARS) {
            send_chunk(seq++, false, body);
            body[0] = 0;
            used = 0;
            // Without the separator the next chunk would start with a comma.
            n = snprintf(one, sizeof(one), "[\"%s\",%.7f,%.7f,%.1f]", safe,
                         g_rows[i].lat, g_rows[i].lon, g_rows[i].alt);
            if (n <= 0) continue;
        }
        memcpy(body + used, one, (size_t)n + 1);
        used += n;
    }
    // Always send a final message, even with no animals: the panel needs to
    // know the reply finished, and that the area really is empty.
    send_chunk(seq, true, body);
}

static void onPoll(const char*, unsigned int, void*)
{
    if (!g_open) {
        const char* err = "{\"seq\":0,\"last\":true,\"error\":\"no simconnect\"}";
        fsCommBusCall("FaunaHunt.Data", err, (unsigned int)strlen(err) + 1,
                      FsCommBusBroadcast_JS);
        return;
    }

    // Collect what the PREVIOUS poll asked for, report it, then ask again.
    drain();
    read_camera();
    emit();

    SimConnect_RequestDataOnSimObjectType(g_sim, REQ_USER, DEF_ALL, 0,
                                          SIMCONNECT_SIMOBJECT_TYPE_USER);
    SimConnect_RequestDataOnSimObjectType(g_sim, REQ_ANIMAL, DEF_ALL,
                                          SEARCH_RADIUS_M,
                                          SIMCONNECT_SIMOBJECT_TYPE_ANIMAL);
    SimConnect_RequestDataOnSimObjectType(g_sim, REQ_AIRCRAFT, DEF_ALL,
                                          SEARCH_RADIUS_M,
                                          SIMCONNECT_SIMOBJECT_TYPE_AIRCRAFT);
}

extern "C" MSFS_CALLBACK void module_init(void)
{
    if (SUCCEEDED(SimConnect_Open(&g_sim, "FaunaHunt", nullptr, 0, 0, 0))) {
        g_open = true;
        SimConnect_AddToDataDefinition(g_sim, DEF_ALL, "PLANE LATITUDE", "degrees");
        SimConnect_AddToDataDefinition(g_sim, DEF_ALL, "PLANE LONGITUDE", "degrees");
        SimConnect_AddToDataDefinition(g_sim, DEF_ALL, "PLANE ALTITUDE", "feet");
        SimConnect_AddToDataDefinition(g_sim, DEF_ALL, "PLANE HEADING DEGREES TRUE", "degrees");
        SimConnect_AddToDataDefinition(g_sim, DEF_ALL, "GROUND VELOCITY", "knots");
        SimConnect_AddToDataDefinition(g_sim, DEF_ALL, "TITLE", nullptr,
                                       SIMCONNECT_DATATYPE_STRING256);
    }
    fsCommBusRegister("FaunaHunt.Poll", onPoll, nullptr);
}

extern "C" MSFS_CALLBACK void module_deinit(void)
{
    if (g_open) SimConnect_Close(g_sim);
}

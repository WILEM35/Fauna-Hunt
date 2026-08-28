// Feasibility probe: does an in-sim WASM module have everything Fauna Hunt
// needs? Three things must compile and link:
//   1. enumerating ANIMAL objects        (SimConnect)
//   2. reading where the player looks    (native fsCameraGet -- no SimConnect)
//   3. talking to the toolbar panel      (CommBus)
// This is not the game; it only proves the calls exist and the toolchain works.

#include <MSFS/MSFS.h>
#include <MSFS/MSFS_WindowsTypes.h>
#include <MSFS/MSFS_Camera.h>
#include <MSFS/MSFS_CommBus.h>
#include <SimConnect.h>

static HANDLE g_sim = 0;

extern "C" MSFS_CALLBACK void module_init(void)
{
    if (SUCCEEDED(SimConnect_Open(&g_sim, "FaunaHuntWasm", nullptr, 0, 0, 0))) {
        SimConnect_AddToDataDefinition(g_sim, 1, "PLANE LATITUDE", "degrees");
        SimConnect_AddToDataDefinition(g_sim, 1, "PLANE LONGITUDE", "degrees");
        SimConnect_AddToDataDefinition(g_sim, 1, "PLANE ALTITUDE", "feet");
        SimConnect_AddToDataDefinition(g_sim, 1, "TITLE", nullptr,
                                       SIMCONNECT_DATATYPE_STRING256);
        // The whole reason the external helper exists.
        SimConnect_RequestDataOnSimObjectType(
            g_sim, 100, 1, 20000, SIMCONNECT_SIMOBJECT_TYPE_ANIMAL);
    }
    fsCommBusRegister("FaunaHunt.Request", nullptr, nullptr);
}

extern "C" MSFS_CALLBACK void module_deinit(void)
{
    if (g_sim) SimConnect_Close(g_sim);
}

// Where the player is looking. In VR this is the headset, which is the whole
// point -- the aircraft's nose is useless for spotting.
extern "C" MSFS_CALLBACK double fauna_view_heading(void)
{
    FsCameraData cam;
    if (!fsCameraGet(FS_POSITION_REFERENTIAL_WORLD, &cam)) return -1.0;
    fsCommBusCall("FaunaHunt.Contacts", "{}", 3, FsCommBusBroadcast_JS);
    return cam.pbh.h + cam.pbh.p + cam.fov;
}

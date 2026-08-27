# SDK request: expose FLYING_ANIMAL through SimConnect

Drafted 2026-08-27 for devsupport.flightsimulator.com. Evidence comes from
`probe/type_sweep.py` in this repository, run over Toronto with 50 flying
animals active.

---

**Title:** `SimConnect: FLYING_ANIMAL container is not reachable through RequestDataOnSimObjectType`

**Category:** SDK / SimConnect (Wishlist, or Bug Report if the omission is unintended)

---

## Summary

The sim maintains a `FLYING_ANIMAL` container, visible and populated in
Developer Mode's Containers window, but no `SIMCONNECT_SIMOBJECT_TYPE` maps to
it. There appears to be no way for a SimConnect client to discover that these
objects exist, let alone read their positions.

`SIMCONNECT_SIMOBJECT_TYPE_ANIMAL` (added in the MSFS 2024 SDK) correctly
returns land fauna, so the ask is narrow: the same treatment for flying fauna.

## Environment

- MSFS 2024, version 2.1.0 (build 66), Microsoft Store
- MSFS 2024 SDK 1.7.3
- SimConnect client via `SimConnect.dll` from the SDK

## What happens

Flying overhead near CYYZ with Developer Mode reporting `FLYING_ANIMAL (50)`
and `ANIMAL (0)`, a SimConnect client calling
`SimConnect_RequestDataOnSimObjectType` at a 20 km radius for **every** type
index from 0 to 20 returns:

| Type | SDK name        | Objects | Sample titles |
|-----:|-----------------|--------:|---------------|
| 0    | USER            | 1       | H500C |
| 1    | ALL             | 271     | H500C, SEAT_H500_PAX_2, ... |
| 2    | AIRCRAFT        | 0       | |
| 3    | HELICOPTER      | 1       | H500C |
| 4    | BOAT            | 0       | |
| 5    | GROUND          | 0       | |
| 6    | HOT_AIR_BALLOON | 0       | |
| 7    | ANIMAL          | 248     | ECaballusMaleVariation3, OAriesAriesMale, BTaurusPrimigenius... |
| 8    | USER_AVATAR     | 1       | |
| 9    | USER_CURRENT    | 1       | H500C |
| 10-20 | (unnamed)      | 0       | rejected with `SIMCONNECT_EXCEPTION_INVALID_ARRAY` |

Not one flying animal is returned by any type, including `ALL`. The 271 objects
under `ALL` are the same 248 animals plus the user aircraft, its seats and a
few others.

`SimConnect_EnumerateSimObjectsAndLiveries` with `ANIMAL` returns 1005 titles,
none of which are birds — consistent with them living in a separate container.

The WASM API does not provide an alternative: `FsSimObjId` appears only as an
*input* to `fsVfxSpawnOnSimObject` and the camera calls, and no header exposes
any means of enumerating sim objects.

## What I expected

Either a `SIMCONNECT_SIMOBJECT_TYPE_FLYING_ANIMAL`, or for flying animals to be
included in `SIMCONNECT_SIMOBJECT_TYPE_ALL`.

## Steps to reproduce

1. Load a flight somewhere with active birds. Developer Mode's Containers
   window should show a non-zero `FLYING_ANIMAL` count.
2. From a SimConnect client, call `SimConnect_RequestDataOnSimObjectType`
   for each type index 0 through 20 with a large radius, requesting `TITLE`
   and position.
3. Observe that no flying animal is returned by any index, while the
   Containers window continues to report them.

A self-contained reproduction script is at
`probe/type_sweep.py` in https://github.com/WILEM35/Fauna-Hunt

## Why it would be useful

I have built a wildlife-spotting add-on that reads fauna positions through
`SIMCONNECT_SIMOBJECT_TYPE_ANIMAL`. Land animals work well. Birds are visible
out of the window and clearly simulated, but invisible to the add-on, so they
cannot be included at all.

More generally, exposing flying fauna would enable bird-strike-awareness tools,
wildlife-survey scenarios, and photography or spotting add-ons. It would also
make the object model consistent: the sim already exposes land fauna, and the
distinction between the two is not visible to users.

## Secondary observation

Possibly unrelated, but worth flagging: in the same session, Developer Mode's
Containers window showed `ANIMAL (0)` at the same moment SimConnect returned
248 animals under `SIMCONNECT_SIMOBJECT_TYPE_ANIMAL`. If the Containers window
is intended to reflect the same object set, one of the two counts looks wrong.

## Suggested change

Add `SIMCONNECT_SIMOBJECT_TYPE_FLYING_ANIMAL` to the enum, or include flying
animals in `ALL`. Read-only position and title access would be sufficient — no
need for AI control or object creation.

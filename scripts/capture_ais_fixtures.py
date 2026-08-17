#!/usr/bin/env python3
"""
Optional: connect to aisstream.io and print one real PositionReport and one real
ShipStaticData message as pretty JSON, so the hand-authored fixtures in
backend/tests/fixtures/ais/ can be checked against reality. Not run in CI.

Requires the `websockets` package (added in a later task's requirements.txt) and
AIS_API_KEY set in the environment.
"""
from __future__ import annotations
import asyncio
import json
import os
import sys

AIS_WS_URL = os.environ.get("AIS_WS_URL", "wss://stream.aisstream.io/v0/stream")
# Small bbox around Mobile Bay, AL (matches this project's HOME_LAT/HOME_LON).
BBOX = [[[30.0, -89.0], [31.5, -87.0]]]


async def _capture(api_key: str) -> None:
    import websockets

    seen = {"PositionReport": False, "ShipStaticData": False}
    async with websockets.connect(AIS_WS_URL) as ws:
        await ws.send(json.dumps({"APIKey": api_key, "BoundingBoxes": BBOX}))
        async for raw in ws:
            msg = json.loads(raw)
            mtype = msg.get("MessageType")
            if mtype in seen and not seen[mtype]:
                print(f"--- {mtype} ---")
                print(json.dumps(msg, indent=2))
                seen[mtype] = True
            if all(seen.values()):
                return


if __name__ == "__main__":
    key = os.environ.get("AIS_API_KEY", "")
    if not key:
        print("AIS_API_KEY is not set — nothing to capture against.", file=sys.stderr)
        sys.exit(1)
    asyncio.run(_capture(key))

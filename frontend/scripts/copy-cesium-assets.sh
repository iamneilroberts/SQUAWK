#!/usr/bin/env bash
# Copies CesiumJS's static Assets/Widgets/Workers/ThirdParty into public/cesium/ so Vite
# serves them as-is. Idempotent (safe to re-run) and runs automatically before dev/build
# via the predev/prebuild npm scripts. Output is gitignored, never committed (G-004).
set -e
cd "$(dirname "$0")/.."
mkdir -p public/cesium
cp -r node_modules/cesium/Build/Cesium/{Assets,Widgets,Workers,ThirdParty} public/cesium/

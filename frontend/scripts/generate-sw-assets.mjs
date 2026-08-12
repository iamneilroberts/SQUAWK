import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";

const clientRoot = resolve("dist/client");
const roots = [resolve(clientRoot, "assets"), resolve(clientRoot, "cesium")];

async function filesBelow(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const paths = [];

  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) paths.push(...await filesBelow(path));
    else if (entry.isFile()) {
      paths.push(`/${relative(clientRoot, path).split(sep).join("/")}`);
    }
  }

  return paths;
}

const assets = (await Promise.all(roots.map(filesBelow))).flat().sort();
if (
  assets.length === 0 ||
  assets.some((path) => !path.startsWith("/assets/") && !path.startsWith("/cesium/")) ||
  assets.some((path) => /^\/assets\/(?:AdminApp-|admin-)/.test(path))
) {
  throw new Error("Refusing to write an invalid service-worker asset manifest");
}

// Per-release cache version derived from the (content-hashed) asset filenames, so it changes
// exactly when the build output changes — never on an identical rebuild. Stamping this into both
// the manifest AND the built service worker gives sw.js changing bytes each real release, which is
// what lets a deploy reach an already-installed PWA: the browser fires `updatefound`, PwaPanel
// surfaces "APPLY READY UPDATE", and applyWaitingUpdate() activates it between flights (sw.js
// still never skipWaiting()s on its own — an active flight is never swapped under the player).
const cacheVersion = `build-${createHash("sha256").update(assets.join("\n")).digest("hex").slice(0, 16)}`;

await writeFile(
  resolve(clientRoot, "sw-assets.json"),
  `${JSON.stringify({ schemaVersion: 1, cacheVersion, assets })}\n`,
  "utf8",
);

// Stamp the same version into the deployed service worker. installShell() requires
// manifest.cacheVersion === CACHE_VERSION, so the two must move together.
const swPath = resolve(clientRoot, "sw.js");
const swSource = await readFile(swPath, "utf8");
const stampedWorker = swSource.replace(
  /const CACHE_VERSION = "[^"]*";/,
  `const CACHE_VERSION = "${cacheVersion}";`,
);
if (stampedWorker === swSource) {
  throw new Error("Failed to stamp CACHE_VERSION into dist/client/sw.js");
}
await writeFile(swPath, stampedWorker, "utf8");

console.log(`service-worker asset manifest: ${assets.length} files (cacheVersion ${cacheVersion})`);

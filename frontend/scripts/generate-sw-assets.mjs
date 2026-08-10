import { readdir, writeFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";

const CACHE_VERSION = "2026-08-10-task13-v1";
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
  assets.some((path) => !path.startsWith("/assets/") && !path.startsWith("/cesium/"))
) {
  throw new Error("Refusing to write an invalid service-worker asset manifest");
}

await writeFile(
  resolve(clientRoot, "sw-assets.json"),
  `${JSON.stringify({ schemaVersion: 1, cacheVersion: CACHE_VERSION, assets })}\n`,
  "utf8",
);

console.log(`service-worker asset manifest: ${assets.length} files`);

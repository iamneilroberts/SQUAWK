/* Explicit, dependency-free service worker. Never cache authenticated or dynamic API responses. */
const CACHE_VERSION = "2026-08-10-task13-v1";
const SHELL_CACHE = `adsb-game-shell-${CACHE_VERSION}`;
const ASSET_CACHE = `adsb-game-assets-${CACHE_VERSION}`;
const OWN_CACHES = [SHELL_CACHE, ASSET_CACHE];
const STATIC_ASSETS = [
  "/manifest.webmanifest",
  "/icons/app-192.png",
  "/icons/app-512.png",
];
const ASSET_MANIFEST_LIMIT = 1_000;
const INSTALL_BATCH_SIZE = 16;

function cacheKind(request) {
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return "none";
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/admin")) return "none";
  if (request.mode === "navigate") return "shell";
  if (
    url.pathname === "/manifest.webmanifest" ||
    url.pathname === "/sw-assets.json" ||
    url.pathname.startsWith("/assets/") ||
    url.pathname.startsWith("/cesium/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname.startsWith("/data/airports/") ||
    url.pathname.startsWith("/data/tutorials/")
  ) return "asset";
  return "none";
}

function validAssetPath(path) {
  return (
    typeof path === "string" &&
    (path.startsWith("/assets/") || path.startsWith("/cesium/")) &&
    !path.includes("..") &&
    !path.includes("\\") &&
    !path.includes("?") &&
    !path.includes("#")
  );
}

async function fetchVerified(path, kind) {
  const response = await fetch(path, { cache: "reload" });
  const contentType = response.headers.get("content-type") ?? "";
  if (!response.ok || response.type !== "basic") {
    throw new Error(`Invalid ${kind} response for ${path}`);
  }

  if (kind === "shell") {
    const html = await response.clone().text();
    if (
      !contentType.includes("text/html") ||
      !html.includes("<title>SQUAWK</title>") ||
      !html.includes('<div id="root"></div>')
    ) {
      throw new Error("Refusing to cache an unrecognized application shell");
    }
  } else if (contentType.includes("text/html")) {
    throw new Error(`Refusing to cache HTML as an asset: ${path}`);
  }

  return response;
}

async function installShell() {
  const manifestResponse = await fetch("/sw-assets.json", { cache: "reload" });
  const manifestContentType = manifestResponse.headers.get("content-type") ?? "";
  if (
    !manifestResponse.ok ||
    manifestResponse.type !== "basic" ||
    manifestContentType.includes("text/html")
  ) {
    throw new Error("Invalid service-worker asset manifest response");
  }

  const manifest = await manifestResponse.clone().json();
  if (
    manifest.schemaVersion !== 1 ||
    manifest.cacheVersion !== CACHE_VERSION ||
    !Array.isArray(manifest.assets) ||
    manifest.assets.length === 0 ||
    manifest.assets.length > ASSET_MANIFEST_LIMIT ||
    new Set(manifest.assets).size !== manifest.assets.length ||
    !manifest.assets.every(validAssetPath)
  ) {
    throw new Error("Invalid service-worker asset manifest");
  }

  const shellCache = await caches.open(SHELL_CACHE);
  const assetCache = await caches.open(ASSET_CACHE);
  await shellCache.put("/", await fetchVerified("/", "shell"));
  await assetCache.put("/sw-assets.json", manifestResponse);

  const paths = [...STATIC_ASSETS, ...manifest.assets];
  for (let offset = 0; offset < paths.length; offset += INSTALL_BATCH_SIZE) {
    const batch = paths.slice(offset, offset + INSTALL_BATCH_SIZE);
    await Promise.all(batch.map(async (path) => {
      await assetCache.put(path, await fetchVerified(path, "asset"));
    }));
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(installShell());
  // Deliberately no skipWaiting(): an active flight is never replaced under the player.
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((key) => key.startsWith("adsb-game-") && !OWN_CACHES.includes(key))
        .map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

async function shellResponse(request) {
  try {
    // The install event owns the known public shell. Never replace it with a navigation
    // response, which could be an Access/interstitial document returned with HTTP 200.
    return await fetch(request);
  } catch {
    return (await caches.match("/")) ?? Response.error();
  }
}

async function assetResponse(request) {
  const cached = await caches.match(request);
  if (cached !== undefined) return cached;
  const response = await fetch(request);
  const contentType = response.headers.get("content-type") ?? "";
  if (response.ok && response.type === "basic" && !contentType.includes("text/html")) {
    const cache = await caches.open(ASSET_CACHE);
    await cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener("fetch", (event) => {
  const kind = cacheKind(event.request);
  if (kind === "shell") event.respondWith(shellResponse(event.request));
  else if (kind === "asset") event.respondWith(assetResponse(event.request));
});

self.addEventListener("sync", (event) => {
  if (event.tag !== "sync-mission-results") return;
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true })
    .then((clients) => clients.forEach((client) => client.postMessage({ type: "SYNC_RESULTS" }))));
});

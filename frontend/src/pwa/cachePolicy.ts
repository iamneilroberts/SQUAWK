export type CacheKind = "none" | "shell" | "asset";

export function cacheKindForRequest(
  url: URL,
  method: string,
  mode: RequestMode,
  origin = "https://game.test",
): CacheKind {
  if (method !== "GET" || url.origin !== origin) return "none";
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/admin")) return "none";
  if (mode === "navigate") return "shell";
  if (
    url.pathname === "/manifest.webmanifest" ||
    url.pathname === "/sw-assets.json" ||
    url.pathname.startsWith("/assets/") ||
    url.pathname.startsWith("/cesium/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname.startsWith(`/data/airports/`) ||
    url.pathname.startsWith("/data/tutorials/")
  ) return "asset";
  return "none";
}

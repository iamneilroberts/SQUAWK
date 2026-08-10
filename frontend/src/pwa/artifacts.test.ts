import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("PWA artifacts", () => {
  it("declares installable landscape icons", () => {
    const manifest = JSON.parse(readFileSync("public/manifest.webmanifest", "utf8"));
    expect(manifest).toMatchObject({ id: "/", scope: "/", start_url: "/", display: "standalone", orientation: "landscape" });
    expect(manifest.icons).toEqual(expect.arrayContaining([
      expect.objectContaining({ sizes: "192x192", type: "image/png" }),
      expect.objectContaining({ sizes: "512x512", type: "image/png" }),
    ]));
  });

  it("keeps updates waiting and delegates result sync only to authenticated window clients", () => {
    const worker = readFileSync("public/sw.js", "utf8");
    const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
    const installHandler = worker.slice(
      worker.indexOf('self.addEventListener("install"'),
      worker.indexOf('self.addEventListener("activate"'),
    );
    expect(installHandler).not.toMatch(/self\.skipWaiting\s*\(/);
    expect(worker).toContain('url.pathname.startsWith("/api/")');
    expect(worker).toContain('fetch("/sw-assets.json"');
    expect(worker).toContain("manifest.cacheVersion !== CACHE_VERSION");
    expect(worker).not.toContain('cache.put("/", response.clone())');
    expect(worker).toContain('!contentType.includes("text/html")');
    expect(worker).toContain('{ type: "SYNC_RESULTS" }');
    expect(worker).not.toContain("x-csrf-token");
    expect(packageJson.scripts.postbuild).toBe("node scripts/generate-sw-assets.mjs");
  });
});

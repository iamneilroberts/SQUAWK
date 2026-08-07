/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// scripts/dev.sh exports .env into the shell before running `npm run dev`, so the same
// ADSB_GAME_PORT the backend binds to is visible here via process.env. Default matches
// backend/app/config.py's default so an unconfigured `.env` still proxies correctly.
const backendPort = process.env.ADSB_GAME_PORT || "8020";

export default defineConfig({
  plugins: [react()],
  define: { CESIUM_BASE_URL: JSON.stringify("/cesium") },
  server: {
    proxy: { "/api": `http://127.0.0.1:${backendPort}` },
    // Vite 5.4.12+ blocks unknown Host headers by default. To expose the dev server
    // through a reverse proxy / Cloudflare tunnel, set ADSB_GAME_PUBLIC_HOST to the
    // public hostname (see .env.example). Unset = default behavior (localhost + IPs).
    ...(process.env.ADSB_GAME_PUBLIC_HOST
      ? { allowedHosts: [process.env.ADSB_GAME_PUBLIC_HOST] }
      : {}),
  },
  // No test files exist yet (frontend logic lands in later tasks). Without this flag
  // `vitest run` exits non-zero on zero test files, which would break `npm run test`
  // as a CI gate before there is anything to test.
  test: { passWithNoTests: true },
});

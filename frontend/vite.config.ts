import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// scripts/dev.sh exports .env into the shell before running `npm run dev`, so the same
// ADSB_GAME_PORT the backend binds to is visible here via process.env. Default matches
// backend/app/config.py's default so an unconfigured `.env` still proxies correctly.
const backendPort = process.env.ADSB_GAME_PORT || "8020";
const routingTests = process.env.ROUTING_TEST === "1";

export default defineConfig(({ mode }) => {
  const legacyDevelopment = mode === "legacy";
  const unitTests = mode === "test";

  return {
    plugins: [
      react(),
      ...(!legacyDevelopment && !unitTests ? [cloudflare()] : []),
    ],
    define: { CESIUM_BASE_URL: JSON.stringify("/cesium") },
    build: {
      rollupOptions: {
        output: {
          chunkFileNames: (chunk) =>
            chunk.name === "AdminApp"
              ? "admin-assets/[name]-[hash].js"
              : "assets/[name]-[hash].js",
          assetFileNames: (asset) =>
            asset.names.some((name) => name === "admin.css")
              ? "admin-assets/[name]-[hash][extname]"
              : "assets/[name]-[hash][extname]",
        },
      },
    },
    server: legacyDevelopment
      ? {
          proxy: { "/api": `http://127.0.0.1:${backendPort}` },
          // Vite blocks unknown Host headers by default. Preserve the existing
          // tunnel opt-in while the Python-backed development path is retired.
          ...(process.env.ADSB_GAME_PUBLIC_HOST
            ? { allowedHosts: [process.env.ADSB_GAME_PUBLIC_HOST] }
            : {}),
        }
      : undefined,
    test: {
      include: routingTests
        ? ["worker/**/*.integration.test.js"]
        : ["src/**/*.test.{ts,tsx}"],
      exclude: routingTests ? [] : ["worker/**"],
    },
  };
});

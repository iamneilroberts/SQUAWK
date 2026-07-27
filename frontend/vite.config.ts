/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  define: { CESIUM_BASE_URL: JSON.stringify("/cesium") },
  server: { proxy: { "/api": "http://127.0.0.1:8010" } },
  // No test files exist yet (frontend logic lands in later tasks). Without this flag
  // `vitest run` exits non-zero on zero test files, which would break `npm run test`
  // as a CI gate before there is anything to test.
  test: { passWithNoTests: true },
});

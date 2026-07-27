/// <reference types="vite/client" />

// Set at runtime in main.tsx so Cesium's Workers/Assets/Widgets resolve from
// public/cesium/ instead of the (nonexistent) npm package path.
interface Window {
  CESIUM_BASE_URL: string;
}

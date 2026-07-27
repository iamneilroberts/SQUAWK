// Must be set before anything imports Cesium, so its Workers/Assets/Widgets resolve
// against public/cesium/ (copied by scripts/copy-cesium-assets.sh) instead of the
// package path, which isn't served in the browser.
window.CESIUM_BASE_URL = "/cesium";

import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/index.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

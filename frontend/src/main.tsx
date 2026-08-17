async function bootstrapPublic(): Promise<void> {
  const [{ captureAuthReturnFragment }, { initializePwa }] = await Promise.all([
    import("./auth/session"),
    import("./pwa/serviceWorker"),
  ]);
  const initialAuthToken = captureAuthReturnFragment(window.location, window.history);
  // Must be set before anything imports Cesium, so its Workers/Assets/Widgets resolve
  // against public/cesium/ instead of the package path.
  window.CESIUM_BASE_URL = "/cesium";
  // Preserve stylesheet order while keeping App/Cesium behind fragment removal.
  await import("cesium/Build/Cesium/Widgets/widgets.css");
  await import("./styles/index.css");
  const [{ default: React }, { default: ReactDOM }, { default: App }] = await Promise.all([
    import("react"),
    import("react-dom/client"),
    import("./App"),
  ]);
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App initialAuthToken={initialAuthToken} />
    </React.StrictMode>,
  );
  initializePwa();
}

async function bootstrapAdmin(): Promise<void> {
  await import("./admin/admin.css");
  const [{ default: React }, { default: ReactDOM }, { default: AdminApp }] = await Promise.all([
    import("react"),
    import("react-dom/client"),
    import("./admin/AdminApp"),
  ]);
  document.title = "SQUAWK CONTROL ROOM";
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode><AdminApp /></React.StrictMode>,
  );
}

const adminPath = window.location.pathname === "/admin" || window.location.pathname.startsWith("/admin/");
void (adminPath ? bootstrapAdmin() : bootstrapPublic());

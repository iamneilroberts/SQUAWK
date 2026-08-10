export type InstallPromptEvent = Event & {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export type PwaSnapshot = {
  supported: boolean;
  installAvailable: boolean;
  standalone: boolean;
  landscape: boolean;
  fullscreen: boolean;
  waiting: boolean;
  online: boolean;
};

let installPrompt: InstallPromptEvent | null = null;
let waitingWorker: ServiceWorker | null = null;
let registration: ServiceWorkerRegistration | null = null;
let initialized = false;
let reloadForUpdate = false;
let snapshot: PwaSnapshot = {
  supported: typeof navigator !== "undefined" && "serviceWorker" in navigator,
  installAvailable: false,
  standalone: false,
  landscape: true,
  fullscreen: false,
  waiting: false,
  online: typeof navigator === "undefined" ? true : navigator.onLine,
};
const listeners = new Set<() => void>();

function standalone(): boolean {
  if (typeof window === "undefined") return false;
  const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return iosStandalone || window.matchMedia("(display-mode: standalone)").matches;
}

function readSnapshot(): PwaSnapshot {
  return {
    supported: "serviceWorker" in navigator,
    installAvailable: installPrompt !== null,
    standalone: standalone(),
    landscape: window.matchMedia("(orientation: landscape)").matches,
    fullscreen: document.fullscreenElement !== null,
    waiting: waitingWorker !== null,
    online: navigator.onLine,
  };
}

function publish(): void {
  snapshot = readSnapshot();
  for (const listener of listeners) listener();
}

function watchRegistration(next: ServiceWorkerRegistration): void {
  registration = next;
  waitingWorker = next.waiting;
  publish();
  next.addEventListener("updatefound", () => {
    const installing = next.installing;
    if (installing === null) return;
    installing.addEventListener("statechange", () => {
      if (installing.state === "installed" && navigator.serviceWorker.controller !== null) {
        waitingWorker = next.waiting ?? installing;
        publish();
      }
    });
  });
}

export function initializePwa(): void {
  if (initialized || typeof window === "undefined") return;
  initialized = true;
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    installPrompt = event as InstallPromptEvent;
    publish();
  });
  window.addEventListener("appinstalled", () => {
    installPrompt = null;
    publish();
  });
  window.addEventListener("online", publish);
  window.addEventListener("offline", publish);
  window.matchMedia("(orientation: landscape)").addEventListener("change", publish);
  window.matchMedia("(display-mode: standalone)").addEventListener("change", publish);
  document.addEventListener("fullscreenchange", publish);
  navigator.serviceWorker?.addEventListener("controllerchange", () => {
    if (reloadForUpdate) window.location.reload();
  });
  publish();
  if (import.meta.env.PROD && "serviceWorker" in navigator) {
    void navigator.serviceWorker.register("/sw.js", { scope: "/" })
      .then(watchRegistration)
      .catch(() => undefined);
  }
}

export function getPwaSnapshot(): PwaSnapshot {
  return snapshot;
}

export function subscribePwa(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function promptInstall(): Promise<boolean> {
  const prompt = installPrompt;
  if (prompt === null) return false;
  await prompt.prompt();
  const choice = await prompt.userChoice;
  if (choice.outcome === "accepted") installPrompt = null;
  publish();
  return choice.outcome === "accepted";
}

export function applyWaitingUpdate(): boolean {
  const worker = waitingWorker ?? registration?.waiting ?? null;
  if (worker === null) return false;
  reloadForUpdate = true;
  worker.postMessage({ type: "SKIP_WAITING" });
  return true;
}

export async function requestAppFullscreen(): Promise<boolean> {
  if (document.fullscreenElement !== null) return true;
  try {
    await document.documentElement.requestFullscreen();
    return true;
  } catch {
    return false;
  }
}

import { useState } from "react";
import ViewerHost from "./globe/ViewerHost";
import ContactLayer from "./globe/ContactLayer";
import OverlayLayers from "./globe/OverlayLayers";
import FlightSession from "./game/FlightSession";
import ContactList from "./panels/ContactList";
import StatusBar from "./panels/StatusBar";
import RotateCard from "./layout/RotateCard";
import { useViewport } from "./layout/useViewport";
import { isNarrowViewport, shouldShowRotateCard } from "./layout/viewport";
import { isImmersiveActive } from "./layout/immersive";
import { useStore } from "./state/store";
import { useUrlTakeover } from "./takeover/useUrlTakeover";

export default function App() {
  const mode = useStore((s) => s.mode);
  // Deep-link auto-takeover (?takeover=<hex>): fires the real ContactList take-control path once
  // the target lands on the feed and is eligible; returns an honest fallback message otherwise.
  // No `?takeover` param → the hook returns null and does nothing, so desktop behaviour is
  // byte-identical to before.
  const takeoverMessage = useUrlTakeover();
  const immersive = useStore((s) => s.immersive);
  const chromeVisible = useStore((s) => s.chromeVisible);
  // Bridged up from ViewerHost's bundle, not zustand: StatusBar is a flex sibling of
  // ViewerHost here, not a Provider descendant, so it can't read viewerContext directly.
  const [terrainNote, setTerrainNote] = useState<string | null>(null);

  // Responsive layout (mobile sub-feature 1). At wide widths `narrow` is false and every
  // branch below falls back to the original desktop render — desktop is unchanged.
  const { width, height } = useViewport();
  const narrow = isNarrowViewport(width);
  const showRotate = shouldShowRotateCard(width, height, mode);
  const [contactsOpen, setContactsOpen] = useState(false);
  // The rotate hint is dismissible so a player can fly in portrait to see how it looks (owner
  // request); once dismissed it stays gone for the session.
  const [rotateDismissed, setRotateDismissed] = useState(false);
  const browseDrawer = narrow && mode === "BROWSE";
  // Mobile immersive/fullscreen flight (#13): collapse the StatusBar to feed-status + attribution,
  // and fade it with the informational chrome while the video-player auto-hide is active.
  const immersiveActive = isImmersiveActive(immersive, narrow, mode);
  const statusFaded = immersiveActive && !chromeVisible;

  return (
    <div className="flex h-full w-full flex-col">
      <div className="flex flex-1 overflow-hidden">
        <div className="relative flex-1">
          <ViewerHost onTerrainNoteChange={setTerrainNote}>
            <ContactLayer />
            <OverlayLayers />
            <FlightSession />
          </ViewerHost>
          {browseDrawer && contactsOpen && (
            <div className="contact-drawer">
              <ContactList />
            </div>
          )}
          {showRotate && !rotateDismissed && (
            <RotateCard onDismiss={() => setRotateDismissed(true)} />
          )}
          {takeoverMessage !== null && mode === "BROWSE" && (
            <div className="takeover-banner">{takeoverMessage}</div>
          )}
        </div>
        {mode === "BROWSE" && !narrow && (
          <div className="w-80 flex-none">
            <ContactList />
          </div>
        )}
      </div>
      <StatusBar
        terrainNote={terrainNote}
        contactsChip={
          browseDrawer
            ? { open: contactsOpen, onToggle: () => setContactsOpen((o) => !o) }
            : undefined
        }
        immersive={immersiveActive}
        faded={statusFaded}
      />
    </div>
  );
}

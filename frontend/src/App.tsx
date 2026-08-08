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
import { useStore } from "./state/store";

export default function App() {
  const mode = useStore((s) => s.mode);
  // Bridged up from ViewerHost's bundle, not zustand: StatusBar is a flex sibling of
  // ViewerHost here, not a Provider descendant, so it can't read viewerContext directly.
  const [terrainNote, setTerrainNote] = useState<string | null>(null);

  // Responsive layout (mobile sub-feature 1). At wide widths `narrow` is false and every
  // branch below falls back to the original desktop render — desktop is unchanged.
  const { width, height } = useViewport();
  const narrow = isNarrowViewport(width);
  const showRotate = shouldShowRotateCard(width, height, mode);
  const [contactsOpen, setContactsOpen] = useState(false);
  const browseDrawer = narrow && mode === "BROWSE";

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
          {showRotate && <RotateCard />}
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
      />
    </div>
  );
}

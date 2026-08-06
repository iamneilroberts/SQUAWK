import { useState } from "react";
import ViewerHost from "./globe/ViewerHost";
import ContactLayer from "./globe/ContactLayer";
import FlightSession from "./game/FlightSession";
import ContactList from "./panels/ContactList";
import StatusBar from "./panels/StatusBar";
import { useStore } from "./state/store";

export default function App() {
  const mode = useStore((s) => s.mode);
  // Bridged up from ViewerHost's bundle, not zustand: StatusBar is a flex sibling of
  // ViewerHost here, not a Provider descendant, so it can't read viewerContext directly.
  const [terrainNote, setTerrainNote] = useState<string | null>(null);

  return (
    <div className="flex h-full w-full flex-col">
      <div className="flex flex-1 overflow-hidden">
        <div className="relative flex-1">
          <ViewerHost onTerrainNoteChange={setTerrainNote}>
            <ContactLayer />
            <FlightSession />
          </ViewerHost>
        </div>
        {mode === "BROWSE" && (
          <div className="w-80 flex-none">
            <ContactList />
          </div>
        )}
      </div>
      <StatusBar terrainNote={terrainNote} />
    </div>
  );
}

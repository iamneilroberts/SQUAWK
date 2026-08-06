import ViewerHost from "./globe/ViewerHost";
import ContactLayer from "./globe/ContactLayer";
import ContactList from "./panels/ContactList";
import StatusBar from "./panels/StatusBar";
import { useStore } from "./state/store";

export default function App() {
  const mode = useStore((s) => s.mode);

  return (
    <div className="flex h-full w-full flex-col">
      <div className="flex flex-1 overflow-hidden">
        <div className="relative flex-1">
          <ViewerHost>
            <ContactLayer />
          </ViewerHost>
        </div>
        {mode === "BROWSE" && (
          <div className="w-80 flex-none">
            <ContactList />
          </div>
        )}
      </div>
      <StatusBar />
    </div>
  );
}

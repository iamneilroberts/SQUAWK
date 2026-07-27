import BrowseGlobe from "./globe/BrowseGlobe";
import ContactList from "./panels/ContactList";
import StatusBar from "./panels/StatusBar";

export default function App() {
  return (
    <div className="flex h-full w-full flex-col">
      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1">
          <BrowseGlobe />
        </div>
        <div className="w-80 flex-none">
          <ContactList />
        </div>
      </div>
      <StatusBar />
    </div>
  );
}

import BrowseGlobe from "./globe/BrowseGlobe";

export default function App() {
  return (
    <div className="flex h-full w-full">
      <div className="flex-1">
        <BrowseGlobe />
      </div>
      {/* Reserved for Task 8: contact list + status bar. */}
      <div className="w-80 flex-none" />
    </div>
  );
}

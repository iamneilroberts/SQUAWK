import { CockpitPrimary } from "../dashboard/UnifiedGlass";
import type { AircraftClassId } from "../mission/types";
import { loadClassById } from "../sim/params";

export default function CockpitPreview({ classId }: { classId: AircraftClassId }) {
  const params = loadClassById(classId);
  return (
    <section className="mission-cockpit-preview" aria-label="Selected aircraft cockpit preview">
      <div className="mission-cockpit-heading">
        <span className="label">SIMULATED COCKPIT PREVIEW</span>
        <span className="label">{params.label}</span>
      </div>
      <div className="mission-cockpit-display">
        <CockpitPrimary snapshot={null} params={params} />
      </div>
      <div className="label mission-cockpit-next">SIGN-IN COMES NEXT · LIVE INSTRUMENTS BEGIN AFTER TAKEOVER</div>
    </section>
  );
}

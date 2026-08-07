/*
 * The windscreen tags themselves: absolutely-positioned DOM over the Cesium canvas, so a click
 * is an ordinary React onClick and nothing has to be taught to Cesium's picking. Hook-free, and
 * given nothing but the output of `projectTraffic` — no store, no viewer, no snapshot.
 */
import type { TrafficTag } from "./trafficProjection";

export default function TrafficTags({ tags, onSelect }: {
  tags: TrafficTag[];
  onSelect(hex: string): void;
}) {
  return (
    <>
      {tags.map((t) => (
        <button
          type="button"
          key={t.hex}
          className={[
            "traffic-tag",
            t.ghost ? "traffic-tag-ghost" : "",
            t.military ? "traffic-tag-mil" : "",
          ].filter(Boolean).join(" ")}
          style={{ left: t.x, top: t.y }}
          onClick={() => onSelect(t.hex)}
        >
          <span className="traffic-tag-label">{t.label}</span>
          <span className="traffic-tag-line">{t.typeLine}</span>
          <span className="traffic-tag-line">{t.altLine}</span>
        </button>
      ))}
    </>
  );
}

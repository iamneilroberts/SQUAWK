/*
 * One collapsible LORAN panel: bracket corners from `.panel`, an uppercase title that is also
 * the collapse control, and a [+]/[-] affordance. Hook-free — the open/closed flag and the
 * handler both come from the parent, which is what makes it testable by calling it.
 */
import type { ReactNode } from "react";

export default function PanelFrame({ title, collapsed, onToggle, children }: {
  title: string;
  collapsed: boolean;
  onToggle(): void;
  children: ReactNode;
}) {
  return (
    <section className="dash-panel panel">
      <button type="button" className="dash-panel-header label" onClick={onToggle}>
        <span>{title}</span>
        <span className="dash-panel-toggle">{collapsed ? "[+]" : "[-]"}</span>
      </button>
      {collapsed ? null : <div className="dash-panel-body">{children}</div>}
    </section>
  );
}

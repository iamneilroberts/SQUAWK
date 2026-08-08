/*
 * "ROTATE TO LANDSCAPE" instrumentation card (spec §2.4, owner decision D4: landscape-first,
 * portrait-tolerant). Shown only when the device is narrow AND held in portrait
 * (shouldShowRotateCard). It is NON-BLOCKING: the backdrop and the card both keep
 * pointer-events off, so the globe (and, in browse, the contact drawer) keep rendering and
 * stay interactive underneath. This deliberately avoids a full portrait flight reflow, which
 * is out of scope for sub-feature 1.
 *
 * Hook-free and prop-free, so it is testable by calling it (collectText), like the HUD.
 * LORAN visual language: amber title, 1px-border translucent panel, bracket corners, no radius.
 */
export default function RotateCard({ onDismiss }: { onDismiss?: () => void } = {}) {
  return (
    <div className="rotate-card-backdrop">
      <div className="panel rotate-card">
        <div className="rotate-card-title">ROTATE TO LANDSCAPE</div>
        <div className="rotate-card-note">
          This flight display is built for a wide screen. Turn your device sideways to fly.
        </div>
        {/* The backdrop and card are pointer-events:none so the globe stays interactive; this
            button re-enables pointer events so the player can dismiss the hint and fly in
            portrait to see how it looks (owner request). */}
        <button type="button" className="status-chip-button rotate-card-dismiss" onClick={onDismiss}>
          DISMISS · FLY IN PORTRAIT
        </button>
      </div>
    </div>
  );
}

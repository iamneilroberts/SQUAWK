/**
 * The BROWSE start card (B3c): fly-first. One primary action — FLY NOW — takes over the nearest
 * flyable live aircraft instantly and unranked, no account and no sign-in. Picking a specific plane
 * or the guided landing tutorial stay available as secondary actions. Replaces the old
 * "Train before you sign in" funnel now that anonymous instant flight exists.
 */
export default function QuickStartNotice({
  onDismiss,
  onFlyNow,
  onSelectPlane,
  onStartTraining,
}: {
  onDismiss: () => void;
  onFlyNow: () => void;
  onSelectPlane: () => void;
  onStartTraining: () => void;
}) {
  return (
    <section className="panel quick-start" aria-labelledby="quick-start-title" data-testid="quick-start-notice">
      <div className="quick-start-heading">
        <h1 id="quick-start-title">Take the controls</h1>
        <button type="button" className="auth-close" aria-label="Dismiss how to fly" onClick={onDismiss}>×</button>
      </div>
      <p className="quick-start-copy">
        Fly a real aircraft over live terrain — and land it. No account needed.
      </p>
      <button
        type="button"
        className="control-button quick-start-action quick-start-flynow"
        data-testid="quick-start-flynow"
        onClick={onFlyNow}
      >
        ▶ Fly now
      </button>
      <button type="button" className="quick-start-secondary" data-testid="quick-start-select" onClick={onSelectPlane}>
        Pick a plane
      </button>
      <button type="button" className="quick-start-secondary" data-testid="quick-start-training" onClick={onStartTraining}>
        Training · guided landing
      </button>
      <p className="quick-start-hint">FLY NOW takes over the nearest flyable plane</p>
    </section>
  );
}

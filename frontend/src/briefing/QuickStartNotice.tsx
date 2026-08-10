export const QUICK_START_STEPS = [
  "Choose a supported airborne plane.",
  "Review its assigned route and runway.",
  "Choose an eligible alternative if you prefer.",
  "Press TAKE CONTROLS and sign in.",
  "Follow guidance and land for a score.",
] as const;

export default function QuickStartNotice({
  onDismiss,
  onSelectPlane,
}: {
  onDismiss: () => void;
  onSelectPlane: () => void;
}) {
  return (
    <section className="panel quick-start" aria-labelledby="quick-start-title" data-testid="quick-start-notice">
      <div className="quick-start-heading">
        <h1 id="quick-start-title">How to fly</h1>
        <button type="button" className="auth-close" aria-label="Dismiss how to fly" onClick={onDismiss}>×</button>
      </div>
      <ol className="quick-start-steps">
        {QUICK_START_STEPS.map((step) => <li key={step}>{step}</li>)}
      </ol>
      <button type="button" className="control-button quick-start-action" data-testid="quick-start-select" onClick={onSelectPlane}>
        Select a plane
      </button>
    </section>
  );
}

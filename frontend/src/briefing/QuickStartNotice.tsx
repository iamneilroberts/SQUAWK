export const QUICK_START_STEPS = [
  "Start with a guided Cessna landing — no account required.",
  "Learn the controls on a short, repeatable final approach.",
  "Return to live traffic and choose a supported airborne plane.",
  "Preview its route, runway, and simulated cockpit.",
  "Press TAKE CONTROLS and sign in only when you are ready to fly.",
] as const;

export default function QuickStartNotice({
  onDismiss,
  onStartTraining,
  onSelectPlane,
}: {
  onDismiss: () => void;
  onStartTraining: () => void;
  onSelectPlane: () => void;
}) {
  return (
    <section className="panel quick-start" aria-labelledby="quick-start-title" data-testid="quick-start-notice">
      <div className="quick-start-heading">
        <h1 id="quick-start-title">Train before you sign in</h1>
        <button type="button" className="auth-close" aria-label="Dismiss how to fly" onClick={onDismiss}>×</button>
      </div>
      <p className="quick-start-copy">
        Fly a complete guided landing first. Live aircraft and account sign-in come afterward.
      </p>
      <ol className="quick-start-steps">
        {QUICK_START_STEPS.map((step) => <li key={step}>{step}</li>)}
      </ol>
      <div className="label quick-start-account">No account or email required for training</div>
      <button type="button" className="control-button quick-start-action" data-testid="quick-start-training" onClick={onStartTraining}>
        Start landing training
      </button>
      <button type="button" className="quick-start-secondary" data-testid="quick-start-select" onClick={onSelectPlane}>
        Browse live planes
      </button>
    </section>
  );
}

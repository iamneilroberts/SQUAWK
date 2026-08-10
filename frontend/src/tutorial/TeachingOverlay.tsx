import type { TutorialLesson } from "./lessons";

export function TeachingOverlay({ lesson, onContinue, onQuit }: {
  lesson: TutorialLesson;
  onContinue(): void;
  onQuit(): void;
}) {
  return (
    <div className="teaching-overlay">
      <section className="panel teaching-card" role="dialog" aria-label="Tutorial teaching moment">
        <div className="label">TEACHING MOMENT</div>
        <h2>{lesson.title}</h2>
        <p>{lesson.body}</p>
        <button className="control-button" type="button" onClick={onContinue}>CONTINUE</button>
        <button className="auth-secondary" type="button" onClick={onQuit}>QUIT TRAINING</button>
      </section>
    </div>
  );
}

export function CoachingCard({ lesson, onDismiss }: {
  lesson: TutorialLesson;
  onDismiss(): void;
}) {
  return (
    <aside className="panel coaching-card" aria-live="polite">
      <div className="label">FIRST-FLIGHT COACHING</div>
      <strong>{lesson.title}</strong>
      <p>{lesson.body}</p>
      <button className="auth-secondary" type="button" onClick={onDismiss}>GOT IT</button>
    </aside>
  );
}

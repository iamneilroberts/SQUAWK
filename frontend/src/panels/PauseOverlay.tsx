/*
 * Esc pauses (spec §6). It cannot be made to mean "quit": Esc always exits pointer lock and
 * Chrome rate-limits re-locking, so pause is the only honest thing it can do.
 *
 * Resuming is deliberately TWO steps, because spec §6 requires the resume gesture to be a
 * canvas click: RESUME arms it and steps the overlay out of the way, and flight only
 * continues when the player actually clicks the globe. The armed state has to say so on
 * screen, or a dismissed overlay just looks like a frozen game.
 */
export default function PauseOverlay({
  armed,
  onArmResume,
  onQuit,
}: {
  /** True once RESUME has been pressed and we are waiting for the canvas click. */
  armed: boolean;
  onArmResume(): void;
  onQuit(): void;
}) {
  if (armed) {
    return (
      <div className="pause-overlay pause-overlay-armed">
        <div className="panel pause-card">
          <div className="label">CLICK THE GLOBE TO RESUME</div>
          <button className="control-button" onClick={onQuit}>
            QUIT TO BROWSE
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="pause-overlay">
      <div className="panel pause-card">
        <div className="label">PAUSED</div>
        <button className="control-button" onClick={onArmResume}>
          RESUME
        </button>
        <button className="control-button" onClick={onQuit}>
          QUIT TO BROWSE
        </button>
      </div>
    </div>
  );
}

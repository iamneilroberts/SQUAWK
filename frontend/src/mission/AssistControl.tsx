import { useStore } from "../state/store";
import { nextAssistMode } from "./assists";
import type { AssistState } from "./assistState";

export function AssistControlBody({
  assist,
  onCycle,
}: {
  assist: AssistState;
  onCycle: () => void;
}) {
  return (
    <button
      type="button"
      className={`assist-control assist-control-${assist.current.toLowerCase()}`}
      onClick={onCycle}
      aria-label={`Flight guidance ${assist.current}; highest used ${assist.highestUsed}`}
    >
      <span>ASSIST</span>
      <strong>{assist.current}</strong>
      <small>MAX {assist.highestUsed}</small>
    </button>
  );
}

export default function AssistControl() {
  const assist = useStore((state) => state.assist);
  if (assist === null) return null;
  return (
    <AssistControlBody
      assist={assist}
      onCycle={() => useStore.getState().setAssistMode(nextAssistMode(assist.current))}
    />
  );
}

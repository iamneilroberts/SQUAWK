import {
  highestAssist,
  type AssistMode,
} from "./assists";

export type AssistState = {
  current: AssistMode;
  highestUsed: AssistMode;
};

export function initialAssistState(mode: AssistMode): AssistState {
  return { current: mode, highestUsed: mode };
}

export function selectAssist(state: AssistState, mode: AssistMode): AssistState {
  return {
    current: mode,
    highestUsed: highestAssist(state.highestUsed, mode),
  };
}

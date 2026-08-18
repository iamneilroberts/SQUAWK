/*
 * One HUD warning chip, shared by the glass-cockpit HUD (Hud.tsx) and the immersive bar
 * (ImmersiveHudBar.tsx) so both fade TERRAIN UNVERIFIED identically.
 *
 * Most warnings (STALL / OVERSPEED / SINK RATE / PULL UP …) are safety-critical and stay fully lit
 * for as long as the condition holds. TERRAIN UNVERIFIED is informational — we simply do not know
 * the ground height here — so after a few seconds it fades to a faint ghost (a pure-CSS opacity
 * animation, see .hud-warning-terrain in tokens.css) instead of nagging permanently. It is never
 * removed: the chip stays in the DOM (and in the aria-live region) at low opacity, so the
 * information is still there on a glance.
 *
 * Deliberately HOOK-FREE: the HUD render tree is walked by the no-jsdom unit tests (spec §8), which
 * call every function component directly, so a hook here would throw. The fade is therefore pure
 * CSS. Re-trigger handling comes for free too: the warnings list keys each chip by its text, so
 * when the condition clears the chip UNMOUNTS and a genuinely new occurrence MOUNTS a fresh chip —
 * which restarts the CSS animation from full strength. No JS timer, no reset wiring.
 */
export default function HudWarning({ warning }: { warning: string }) {
  const fades = warning === "TERRAIN UNVERIFIED";
  return <span className={"hud-warning" + (fades ? " hud-warning-terrain" : "")}>{warning}</span>;
}

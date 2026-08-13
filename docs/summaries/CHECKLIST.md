# Turboprop (`tprop`) epic — checklist

Branch `tprop` off `mongols-rich-hud` (9954b20 == live prod, has biz + trim fix).
Plan: `docs/superpowers/plans/2026-08-13-tprop-flight-model.md` (committed 261438d)
Handoff: `~/.claude/coordination/adsb-game/handoffs/pause-2026-08-13-tprop-epic.md`
Execute via `superpowers:subagent-driven-development`.

- [x] Task 1: `params/tprop.json` + `loadTprop` + envelope test (KEEP trim-to-level test) + turboprop lapse decision (piston → measure → additive `turboprop` variant)
- [x] Task 2: mission profile + six-pack dashboard profile + model dims (string-keyed)
- [x] Task 3: `AircraftClassId` union flip + all consumers + `tprop-types.json` + resolveClass + ALL 3 worker allowlists
- [x] Task 4: decision log (TP-001/TP-002) + full gate — deploy + owner device-verify still pending (owner-only, not run by this session)
- [ ] After tprop: `heavy` archetype (777-class + widebody designator reassignment)

_Updated: 2026-08-13 — tprop docs + gate done (534842f, 827a3cb, a52e38a + docs commit); deploy/device-verify pending (owner)_

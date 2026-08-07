# adsb-game — current checklist
- [x] Phase B merged to origin/main @ 4ac6862
- [x] Dashboard 6 SDD tasks + final review + fix wave (code HEAD eefbba8)
- [x] Durable public URL live: https://adsb.voygent.app (Docker :8021 + loran tunnel; verified 200)
- [ ] Owner acceptance flight (remote OK: https://adsb.voygent.app) — runbook checkpoints 14–25 → sign-off
- [ ] On sign-off: merge → main + push; docker compose up -d --build from main; rm SDD workspaces; drop stash@{0}
- [ ] Cloudflare dashboard cleanup (owner): junk adsb.voygent.app.voygent.ai + 3 stale voygent.ai records (plain DNS only — Trap 4)
- [ ] Strip adsb.voygent.ai from ~/.cloudflared/config.yml + sudo restart cloudflared-voygent
- [ ] Airliner (737-800): brainstorm → spec → plan → SDD (prereqs: per-class ASI face, turbofan lapse row, Mach limit)
- [ ] Controllable-only filter toggle: brainstorm (list vs globe) → implement + review

_Updated: 2026-08-07 — hindustanis_

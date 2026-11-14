# 0004 — composed capability folders

A capability is a folder (federation/, catalog/, proxy/, access/, live/)
of single-job files buckle.<thing>.<role>.ts with colocated *.test.ts,
fixtures/, and a thin index.ts barrel. Nothing imports past a barrel.
Variants are files (.fetch.anthropic.ts), not if-branches. Warn at 400
lines (composing wrong), stop at 1200, hard fail 1500 (check-laws).

Amendment (restructure, post-29b1164): the DAG is the truth —
`schemas ← fault ← {problem, settings} ← {access, admission,
federation, live.trace} ← {catalog, live} ← proxy ← main`. Composition
roots live flat in src/ (main, settings, kit, fault, problem, pick).
Enforced: no catch outside fault.ts/settings.ts; no process.env
outside settings.ts; no timeout constants outside the settings schema
(check-laws 2f/2g/2h). Unit worlds are hermetic: kit composes
defaults ⊕ world only — never b1's docker/registry endpoints.

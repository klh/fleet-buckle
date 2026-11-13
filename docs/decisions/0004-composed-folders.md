# 0004 — composed capability folders

A capability is a folder (federation/, catalog/, proxy/, access/, live/)
of single-job files buckle.<thing>.<role>.ts with colocated *.test.ts,
fixtures/, and a thin index.ts barrel. Nothing imports past a barrel.
Variants are files (.fetch.anthropic.ts), not if-branches. Warn at 400
lines (composing wrong), stop at 1200, hard fail 1500 (check-laws).

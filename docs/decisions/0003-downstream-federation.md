# 0003 — downstream-only federation with per-hop grants

hubs = peers we pull from. Never call upstream; acyclic by construction.
A peer's models appear only if the requesting principal holds a grant on
that peer — checked against that peer's OWN registry at every hop.
Identity is Entra-mappable (upn ids, kind, groups), not Entra.
Demo: b1→{b2,b3}, b2→{b3}, b3→{} — see deploy/settings/.

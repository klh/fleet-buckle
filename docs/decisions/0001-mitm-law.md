# 0001 — the MITM law

buckle is a man-in-the-middle interface for LLM traffic: fiddling,
exposure, key management, tracking, context injection. Everything
forwards to litellm untouched. In-loop jobs: (1) context injection per
context_policy, (2) key management (PATHS, minted), (3) tracking + live
overview, (4) federation. Never reimplement engine faces.

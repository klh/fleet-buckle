# 0002 — strictly JSON5

All authored config is *.settings.json5. No yaml is authored by us.
litellm's internal config is GENERATED at boot inside the container from
the JSON catalog — an artifact, never repo config. Compose files are
container wiring only (image/ports/mounts/env PATHS) and carry zero
buckle config. Secrets are file PATHS; values never ride artifacts.

# litellm/

The engine contract. buckle forwards EVERYTHING to litellm except the
four in-loop jobs (context injection, keys, tracking, federation).

- Image is pinned (digest) in compose — never `latest`.
- litellm's config file is GENERATED at boot, inside the container, from
  buckle's JSON catalog (mode 0600). It is an artifact of our JSON5
  config, never authored, never committed. We do not do yaml.

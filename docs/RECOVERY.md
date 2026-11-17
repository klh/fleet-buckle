# Recovery

## Images

Fallback image tags in `deploy/compose.azure.yaml` (the `:-` defaults, e.g.
`WORKER_IMAGE`) track the last PROVEN deploy (see the version matrix in
`docs/worker-moved.md`); update them in the same change that rolls a new image.

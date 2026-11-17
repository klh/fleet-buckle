# Health sidecar placement (review #12)

Status: dispositioned, no wiring change. Closes #8.

## Question
Does `fleet-health` share a container/event loop with the served process, so a hung server could starve the probe and break the "health is outside-process" law?

## Audit
- `deploy/compose.azure.yaml`: `health:` is its own service. It is built from `klh/fleet-health#v1.0.0`, which is a separate image, container and process. It has `depends_on: [buckle]` only for start order.
- `deploy/settings/azure.health.settings.json5`: the probe polls `http://buckle:4111/healthz` over the container network and serves its verdict on its own port (4112).
- `test/deploy/compose.test.yaml` (`health1`..): same shape, one sidecar container per unit, host ports 47x2.
- `Dockerfile` (the served image) runs only `bun src/main.ts`. It does not bundle or import `@fleet/health`.
- `tools/src/buckle.mint-keys.ts` is a one-shot key mint and does not spawn any health process.
- `deploy/compose.yaml` has no health service. It only carries a comment about the sidecar.

## Mechanism
- **Own failure domain.** The probe runs in a separate container with its own PID namespace and its own Bun event loop. A hung or blocked buckle loop cannot starve it.
- **Probe timeouts live in the sidecar.** A hung `/healthz` surfaces as a failed probe, which is a "down" verdict served from the sidecar's own port.
- **Own port.** Consumers read the verdict from 4112, not from the served process.

## Residual
`deploy/compose.yaml` (the base file) has no sidecar. It should not claim one, so the comment there is aspirational. This is out of scope here. A compose-lint test is not added because no wiring fix landed.

Out of scope: probing external hubs, metric alerting.

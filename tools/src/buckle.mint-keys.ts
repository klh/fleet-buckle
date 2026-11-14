// buckle.mint-keys.ts — mint the STUB-mode topology keys: per-principal
// key files (0600) generated from each buckle's access registry into
// test/deploy/keys/.gen (gitignored), which compose mounts read-only at
// /etc/buckle/keys. The minter itself lives in buckle.keys.mint.ts
// (shared with the real-mode launcher). Idempotent.
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { mintTopologyKeys } from "./buckle.keys.mint.ts";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const KEYS = join(ROOT, "test/deploy/keys/.gen");

// the three-buckle topology lives in test/deploy/settings (b2/b3 were
// always there; b1 moved to join them — deploy/ is the real hub)
await mintTopologyKeys(KEYS, {
  b1: {
    defaults: join(ROOT, "deploy/settings/default.settings.json5"),
    settings: join(ROOT, "test/deploy/settings/b1.settings.json5"),
    over: join(ROOT, "test/deploy/settings/b1.stub.json5"),
  },
  b2: {
    defaults: join(ROOT, "deploy/settings/default.settings.json5"),
    settings: join(ROOT, "test/deploy/settings/b2.settings.json5"),
    over: join(ROOT, "test/deploy/settings/b2.stub.json5"),
  },
  b3: {
    defaults: join(ROOT, "deploy/settings/default.settings.json5"),
    settings: join(ROOT, "test/deploy/settings/b3.settings.json5"),
    over: join(ROOT, "test/deploy/settings/b3.stub.json5"),
  },
});
console.log(`keys dir: ${KEYS}`);

// buckle.mint-keys.ts — mint the STUB-mode topology keys: per-principal
// key files (0600) generated from each buckle's access registry into
// test/deploy/keys/.gen (gitignored), which compose mounts read-only at
// /etc/buckle/keys. The minter itself lives in buckle.keys.mint.ts
// (shared with the real-mode launcher). Idempotent.
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { mintTopologyKeys, topologyUnits } from "./buckle.keys.mint.ts";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const KEYS = join(ROOT, "test/deploy/keys/.gen");

// the three-buckle topology map lives in buckle.keys.mint.ts (the
// ONE home — this stub mint and the real launcher both read it)
await mintTopologyKeys(KEYS, topologyUnits("stub"));
console.log(`keys dir: ${KEYS}`);

// buckle.gen-openapi.ts — write openapi.json from the wire schemas, or
// --check to fail CI when the committed file has drifted.
import { buildOpenApi } from "../../src/schemas/buckle.openapi.ts";

const path = new URL("../../openapi.json", import.meta.url).pathname;
const doc = JSON.stringify(buildOpenApi(), null, 2) + "\n";

if (process.argv.includes("--check")) {
  const committed = await Bun.file(path).text();
  if (committed !== doc) {
    console.error(
      "openapi.json has drifted from the wire schemas — run `bun run gen:openapi`",
    );
    process.exit(1);
  }
  console.log("openapi.json is in sync");
} else {
  await Bun.write(path, doc);
  console.log(`wrote ${path}`);
}

// worker.probe.ts — the probe leg: fetch the hub's model catalog and
// ask the HEAVIEST question the worker ever makes. Case law (owner
// 2026-11-16): .prefer tokens are lowercased at parse; requests use
// the catalog's ORIGINAL casing (lower→original resolved here).
import { z } from "zod";
import { env } from "./worker.env.ts";

/** a model ask that must answer STRICT JSON to count as working */
export type Prober = (hub: string, model: string, maxTokens: number) => Promise<boolean>;

const ChatReplySchema = z
  .object({ choices: z.array(z.object({ message: z.object({ content: z.string() }) })) })
  .passthrough();

const CatalogRowSchema = z.object({
  id: z.string(),
  // the buckle tags every row with WHICH provider serves it —
  // provider= scopes the ladder to one provider's rows
  origin: z.object({ kind: z.string(), label: z.string() }).optional(),
});

// two catalog dialects live in the wild: the OpenAI {data: […]}
// list and the buckle's own {hub, models: […]} projection — accept
// either (rows prefer `models`, falling back to `data`)
const CatalogSchema = z
  .object({
    data: z.array(CatalogRowSchema).optional(),
    models: z.array(CatalogRowSchema).optional(),
  })
  .passthrough();

const PLAN_SHAPE = {
  type: "object",
  properties: {
    summary: { type: "string" },
    files: {
      type: "array",
      items: {
        type: "object",
        properties: { path: { type: "string" }, content: { type: "string" } },
        required: ["path", "content"],
        additionalProperties: false,
      },
      minItems: 1,
      maxItems: 5,
    },
  },
  required: ["summary", "files"],
  additionalProperties: false,
} as const;

/** ~4 KB of realistic file-content noise — sized like a real plan ask */
const DUMMY_FILES = `### src/app.js
function pressKey(key) {
  const { displayValue } = calculator.state;
  if (key === "+") calculator.pendingOperator = key;
  else if (key === "=") calculator.equals();
  else calculator.digit(key);
  render();
}
function render() {
  document.getElementById("display").textContent = calculator.state.displayValue;
  document.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => pressKey(b.dataset.key)));
}
### styles.css
.calculator { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
.button { border: 1px solid #ccc; border-radius: 4px; padding: 12px 0; font-size: 18px; }
.button.operator { background: #09f; color: #fff; }
### index.html
<div class="calculator"><output id="display">0</output><button data-key="1">1</button></div>
${"<!-- padding to a realistic plan-ask footprint ".repeat(60)}-->
`;

/**
 * the hub's catalog as lower→original casing (the request-side id).
 * provider!="" scopes the map to that provider's rows (rows whose
 * origin.label matches — a buckle fronts several providers; rows
 * without provenance drop under a scope). Unreachable/undecodable
 * hubs yield an EMPTY map — callers then use verbatim tokens and
 * let the probe decide.
 */
export const fetchCatalog = async (
  hub: string,
  provider = "",
): Promise<Map<string, string>> => {
  const map = new Map<string, string>();
  const r = await fetch(`${hub}/v1/models`, {
    headers: { authorization: `Bearer ${env.buckleKey}` },
    signal: AbortSignal.timeout(10_000),
  }).catch((_e: unknown) => null);
  if (!r?.ok) return map;
  const parsed = CatalogSchema.safeParse(await r.json().catch((_e: unknown) => null));
  if (!parsed.success) return map;
  const rows = parsed.data.models ?? parsed.data.data ?? [];
  for (const row of rows) {
    if (provider !== "" && row.origin?.label !== provider) continue;
    map.set(row.id.toLowerCase(), row.id);
  }
  return map;
};

/** JSON.parse inside a promise executor — a throw becomes a catch
 * (the repo's no-try-catch law keeps fault boundaries in fault.ts;
 * the probe leg must degrade to false, never crash the boot) */
const parseJson = (raw: string): Promise<unknown> =>
  new Promise((resolve) => {
    resolve(JSON.parse(raw));
  }).catch((_e: unknown) => null);

/** the heaviest ask the worker makes, verbatim shape: a plan-style
 * STRICT-JSON rewrite ask with real file contents inline. NO
 * max_tokens unless the prefer knob sets one. ANY failure — network
 * refused (the hub may still be warming when the worker boots),
 * non-200, undecodable body, non-JSON reply — is a FAILED CANDIDATE
 * (false), never a crash: the boot picker treats it as tier-walk
 * input and compose restart carries the durable posture.
 */
export const probeModel: Prober = async (hub, model, maxTokens) => {
  const content = `You are implementing a GitHub issue on the probe repo. Rewrite the affected files IN FULL.

Reply with STRICT JSON only, no prose, no code fence, matching this shape:
${JSON.stringify(PLAN_SHAPE)}
Example reply — same structure, but choose the CORRECT values for this input:
${JSON.stringify({ summary: "what changed", files: [{ path: "src/app.js", content: "full file" }] })}

---
issue #probe: add a percent button

current file contents:
${DUMMY_FILES}`;
  const r = await fetch(`${hub}/v1/chat/completions`, {
    method: "POST",
    headers: { authorization: `Bearer ${env.buckleKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content }],
      ...(maxTokens > 0 ? { max_tokens: maxTokens } : {}),
    }),
    signal: AbortSignal.timeout(120_000),
  }).catch((_e: unknown) => null);
  if (!r?.ok) return false;
  const parsed = ChatReplySchema.safeParse(await r.json().catch((_e: unknown) => null));
  if (!parsed.success) return false;
  const text = parsed.data.choices[0]?.message?.content ?? "";
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) return false;
  return (await parseJson(text.slice(start, end + 1))) !== null;
};

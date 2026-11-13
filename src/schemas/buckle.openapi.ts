// buckle.openapi.ts — openapi.json is GENERATED from the wire schemas
// (zod → JSON Schema inside an OpenAPI 3.1 shell), committed, CI-diffed.
// Consumers and tests use it; it can never drift from code.
import { z } from "zod";
import { BuckleModelsResponse } from "./buckle.model.wire.zod.ts";
import { BuckleTreeResponse } from "./buckle.tree.zod.ts";
import { BuckleStatsResponse } from "./buckle.stats.zod.ts";
import { BuckleProblem } from "./buckle.problem.zod.ts";
import { BuckleHealthz } from "./buckle.healthz.zod.ts";

const json = (schema: z.ZodType): unknown =>
  z.toJSONSchema(schema, { io: "output", target: "draft-2020-12" });

export function buildOpenApi(): Record<string, unknown> {
  const problem = json(BuckleProblem);
  return {
    openapi: "3.1.0",
    info: {
      title: "@fleet/buckle",
      version: "0.1.0",
      description:
        "The LLM MITM gateway: context injection, key management, " +
        "tracking, downstream federation, live overview.",
    },
    paths: {
      "/healthz": {
        get: {
          summary: "Own liveness face (the fleet-health sidecar polls this)",
          responses: {
            200: { content: { "application/json": { schema: json(BuckleHealthz) } } },
          },
        },
      },
      "/metrics": {
        get: {
          summary:
            "Prometheus export: requests, inflight, tok/s per model/provider/buckle",
          responses: {
            200: {
              content: { "text/plain": { schema: { type: "string" } } },
            },
          },
        },
      },
      "/v1/models": {
        get: {
          summary: "Federated model list for the authenticated principal",
          description:
            "Own providers' models (fetched, with verbatim provider " +
            "metadata) plus every downstream peer's models the principal " +
            "holds grants on — per-hop checked.",
          responses: {
            200: {
              "content": { "application/json": { schema: json(BuckleModelsResponse) } },
            },
            default: {
              "content": { "application/json": { schema: problem } },
            },
          },
        },
      },
      "/v1/tree": {
        get: {
          summary: "The federated tree (buckles, models, stats, connections)",
          responses: {
            200: {
              "content": { "application/json": { schema: json(BuckleTreeResponse) } },
            },
            default: {
              "content": { "application/json": { schema: problem } },
            },
          },
        },
      },
      "/stats": {
        get: {
          summary: "Live stats: inflight + tok/s per model, per buckle",
          responses: {
            200: {
              "content": { "application/json": { schema: json(BuckleStatsResponse) } },
            },
          },
        },
      },
      "/connections": {
        get: {
          summary: "WHO is connected to which buckle (users + machines)",
          responses: {
            200: {
              "content": { "application/json": { schema: json(BuckleStatsResponse) } },
            },
          },
        },
      },
    },
  };
}

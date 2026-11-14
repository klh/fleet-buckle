// buckle.openapi.ts — openapi.json is GENERATED from the wire schemas
// (zod → JSON Schema inside an OpenAPI 3.1 shell), committed, CI-diffed.
// Consumers and tests use it; it can never drift from code. The paths
// here MIRROR main.ts's route table — one builder per face.
import { z } from "zod";
import { BuckleModelsResponse } from "./buckle.model.wire.zod.ts";
import { BuckleTreeResponse } from "./buckle.tree.zod.ts";
import { BuckleStatsResponse } from "./buckle.stats.zod.ts";
import { BuckleProblem } from "./buckle.problem.zod.ts";
import { BuckleHealthz } from "./buckle.healthz.zod.ts";

const json = (schema: z.ZodType): unknown =>
  z.toJSONSchema(schema, { io: "output", target: "draft-2020-12" });

/** the json response envelope */
const ok = (schema: z.ZodType) => ({
  content: { "application/json": { schema: json(schema) } },
});

/** the problem+json fallback envelope every guarded face answers with */
const problems = () => ({
  content: { "application/problem+json": { schema: json(BuckleProblem) } },
});

const healthzPath = () => ({
  get: {
    summary: "Own liveness face (the fleet-health sidecar polls this)",
    responses: { 200: ok(BuckleHealthz) },
  },
});

const metricsPath = () => ({
  get: {
    summary: "Prometheus export: requests, inflight, tok/s per model/provider/buckle",
    responses: {
      200: { content: { "text/plain": { schema: { type: "string" } } } },
    },
  },
});

const chatPath = () => ({
  post: {
    summary: "The MITM forward loop (OpenAI wire)",
    description:
      "Validates the model exists in this buckle's catalog " +
      "(drift fails loud), then forwards to the unit's litellm " +
      "engine with the W3C trace CONTINUED (same trace id, new " +
      "span id on every hop). Response passes through untouched.",
    requestBody: {
      content: {
        "application/json": {
          schema: {
            type: "object",
            required: ["model", "messages"],
            properties: {
              model: { type: "string" },
              messages: { type: "array" },
            },
          },
        },
      },
    },
    responses: {
      200: {
        description: "engine response, passed through",
        content: { "application/json": { schema: { type: "object" } } },
      },
      default: problems(),
    },
  },
});

const modelsPath = () => ({
  get: {
    summary: "Federated model list for the authenticated principal",
    description:
      "Own providers' models (fetched, with verbatim provider " +
      "metadata) plus every downstream peer's models the principal " +
      "holds grants on — per-hop checked.",
    responses: { 200: ok(BuckleModelsResponse), default: problems() },
  },
});

const treePath = () => ({
  get: {
    summary: "The federated tree (buckles, models, stats, connections)",
    responses: { 200: ok(BuckleTreeResponse), default: problems() },
  },
});

const statsPath = () => ({
  get: {
    summary: "Live stats: inflight + tok/s per model, per buckle",
    responses: { 200: ok(BuckleStatsResponse), default: problems() },
  },
});

export function buildOpenApi(): Record<string, unknown> {
  return {
    openapi: "3.1.0",
    info: {
      title: "@fleet/buckle",
      version: "0.1.0",
      description:
        "The LLM MITM gateway: context injection, key management, " +
        "tracking, downstream federation, live overview.",
    },
    // mirrors main.ts's route table — a face there has a row here
    paths: {
      "/healthz": healthzPath(),
      "/metrics": metricsPath(),
      "/v1/chat/completions": chatPath(),
      "/v1/models": modelsPath(),
      "/v1/tree": treePath(),
      "/v1/stats": statsPath(),
    },
  };
}

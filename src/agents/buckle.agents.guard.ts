// agents/buckle.agents.guard.ts — the execution guard (lifted from
// durable/execution-guard.ts + fenced-models.ts): pin the registry
// publication for THIS job and enforce host policy at every native
// boundary (each tool call, each model dispatch). Model legs are
// fenced to the HTTP OpenAI-compatible BUCKLE route — the /w/<slug>
// lane seam — with retries off (the durable job owns retry policy).
import { attempt } from "../fault.ts";
import {
  createRegistry,
  defineExtension,
  type HarnessOptions,
  hook,
  ToolTask,
} from "@earendil-works/pi-durable";
import type { FetchFunction } from "@earendil-works/pi-ai";
import type { Models } from "@earendil-works/pi-ai/models";
import type { Authorize, AgentJobSpec } from "./buckle.agents.zod.ts";

/** The initial agents plane supports Buckle's HTTP OpenAI wire only.
 *  No WebSocket escape, no image/classifier transports. */
type FenceCheck = (model: { api: string }) => void;
type FenceOptions = <T extends { fetch?: FetchFunction }>(input?: T) => T;

function streamOverrides(
  base: Models,
  allowed: FenceCheck,
  options: FenceOptions,
): Pick<Models, "stream" | "streamSimple" | "streamDeferred"> {
  return {
    stream(model, context, input) {
      allowed(model);
      return base.stream(model, context, options(input));
    },
    streamSimple(model, context, input) {
      allowed(model);
      return base.streamSimple(model, context, options(input));
    },
    streamDeferred(model, handle, input) {
      allowed(model);
      return base.streamDeferred(model, handle, options(input));
    },
  };
}

function completeOverrides(
  base: Models,
  allowed: FenceCheck,
  options: FenceOptions,
): Pick<Models, "complete" | "completeSimple" | "fetchDeferred" | "cancelDeferred"> {
  return {
    complete(model, context, input) {
      allowed(model);
      return base.complete(model, context, options(input));
    },
    completeSimple(model, context, input) {
      allowed(model);
      return base.completeSimple(model, context, options(input));
    },
    fetchDeferred(model, handle, input) {
      allowed(model);
      return base.fetchDeferred(model, handle, options(input));
    },
    cancelDeferred(model, handle, input) {
      allowed(model);
      return base.cancelDeferred(model, handle, options(input));
    },
  };
}

function fencedModels(base: Models, authorize: Authorize, spec: AgentJobSpec): Models {
  const allowed: FenceCheck = (model) => {
    if (model.api !== "openai-completions")
      throw new Error("agents: model legs must ride the buckle OpenAI-compatible lane route");
  };
  const options: FenceOptions = (input) => {
    const original = input?.fetch ?? globalThis.fetch;
    const fetch = new Proxy(original, {
      async apply(target, receiver, args) {
        await attempt(
          () => authorize("execute", spec),
          (fault) => {
            throw new Error("agents: execution denied before provider dispatch", {
              cause: fault,
            });
          },
        );
        return Reflect.apply(target, receiver, args);
      },
    });
    return Object.assign({}, input, { fetch, maxRetries: 0 });
  };
  const overrides = {
    ...streamOverrides(base, allowed, options),
    ...completeOverrides(base, allowed, options),
    generateImages() {
      throw new Error("agents: use an approved image worker adapter");
    },
    classify() {
      throw new Error("agents: use an approved classifier worker adapter");
    },
  };
  return new Proxy(base, {
    get(target, property) {
      if (Object.hasOwn(overrides, property)) return Reflect.get(overrides, property);
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

/** Pin registry publication for this job; enforce host policy at each
 *  native boundary. The guard name is reserved — a colliding install
 *  refuses rather than doubling up. */
export function executionGuard(
  runtime: Pick<HarnessOptions, "registry" | "models">,
  authorize: Authorize,
  spec: AgentJobSpec,
) {
  const registry = createRegistry();
  for (const extension of runtime.registry.snapshot().installed()) {
    if (extension.name === "buckle-execution-guard")
      throw new Error("agents: reserved execution guard name");
    registry.install(extension);
  }
  const guard = defineExtension({
    name: "buckle-execution-guard",
    hooks: [
      hook(ToolTask, {
        async beforeTool() {
          await authorize("execute", spec);
          return undefined;
        },
      }),
    ],
  });
  registry.install(guard);
  return {
    registry,
    guard,
    models: () =>
      fencedModels(
        typeof runtime.models === "function" ? runtime.models() : runtime.models,
        authorize,
        spec,
      ),
  };
}

// buckle.events.bus.test.ts — the bus contract: parsed-at-emit
// (drift fails loud), fan-out in subscribe order, and the
// constructors as the ONE event construction site (kind-correct by
// construction, absent optionals omitted).
import { describe, expect, test } from "bun:test";
import {
  BuckleEvent,
  createEventBus,
  failedEventOf,
  openedEventOf,
  servedEventOf,
} from "./buckle.events.bus.ts";

describe("EventBus", () => {
  test("fan-out: every subscriber sees every event, in order", () => {
    const bus = createEventBus();
    const seen1: string[] = [];
    const seen2: string[] = [];
    bus.subscribe((e) => seen1.push(e.kind));
    bus.subscribe((e) => seen2.push(e.kind));
    bus.emit(openedEventOf({ at: 1, principal: "carol", model: "m1" }));
    bus.emit(
      servedEventOf({
        at: 2, principal: "carol", model: "m1", leg: "engine", status: 200, tokens: 5, latencyMs: 10,
      }),
    );
    expect(seen1).toEqual(["request.opened", "request.served"]);
    expect(seen2).toEqual(["request.opened", "request.served"]);
  });

  test("emit validates through the schema — drift fails loud", () => {
    const bus = createEventBus();
    expect(() =>
      bus.emit({ kind: "request.served", at: 1, principal: "", model: "m", leg: "engine", status: 200, tokens: 0, latencyMs: 0 }),
    ).toThrow();
  });

  test("constructors omit absent optionals and keep present ones", () => {
    expect(
      openedEventOf({ at: 1, principal: "carol", model: "m1" }),
    ).toEqual({
      kind: "request.opened", at: 1, principal: "carol", model: "m1",
    });
    expect(
      openedEventOf({ at: 1, principal: "carol", principalKind: "human", model: "m1" }),
    ).toEqual({
      kind: "request.opened", at: 1, principal: "carol", principalKind: "human", model: "m1",
    });
    const failed = failedEventOf({
      at: 3, principal: "carol", model: "m1", leg: "hop", peer: "b2", fault: "timeout", latencyMs: 9,
    });
    expect(BuckleEvent.parse(failed).kind).toBe("request.failed");
  });

  test("tracker + exposition subscribers collect from the bus", async () => {
    // the wiring main does at boot, proven at the seam: opened →
    // inflight, served → banked tokens + counted model
    const { createLive, subscribeTracker } = await import("../metrics/buckle.metrics.tracker.ts");
    const { createMetrics, subscribeExposition } = await import("../metrics/buckle.metrics.exposition.ts");
    const bus = createEventBus();
    const live = createLive("b1");
    const metrics = createMetrics("b1");
    subscribeTracker(bus, live);
    subscribeExposition(bus, metrics);
    bus.emit(openedEventOf({ at: Date.now(), principal: "carol", model: "m1" }));
    bus.emit(
      servedEventOf({ at: Date.now(), principal: "carol", model: "m1", leg: "engine", status: 200, tokens: 7, latencyMs: 3 }),
    );
    const snap = live.snapshot();
    expect(snap.models.find((m) => m.model === "m1")?.tokens).toBe(7);
    expect(snap.models.find((m) => m.model === "m1")?.inflight).toBe(0);
    expect(metrics.render()).toContain('buckle_requests_total{buckle="b1",model="m1"} 1');
  });
});

// buckle.metrics.stats.test.ts — the stats fold's contract: the mem
// cache (TTL window, single-flight) and the fleet ROLLUP
// (kind-split sessions, longest running, top token consumers).
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { createLive } from "./buckle.metrics.tracker.ts";
import { createStatsCache, statsBody } from "./buckle.metrics.stats.ts";
import { mergeSettings } from "../schemas/buckle.settings.zod.ts";
import { BuckleStatsResponse } from "../schemas/buckle.stats.zod.ts";
import { mintKeyDir, stubPeer } from "../kit.ts";
import { readToken } from "../settings.ts";

/** one honest peer body, built through the wire schema itself */
function peerBody(hub: string, agentTokens: number) {
  return BuckleStatsResponse.parse({
    self: {
      hub,
      models: [{ model: "peer-model", inflight: 0, requests: 3, tokens: agentTokens, tps: 0 }],
      active_models: 1,
      current_connections: 1,
      tps: 4,
      principals: [],
      sessions: {
        by_kind: { agent: 1 },
        longest_running_s: 12,
        top_tokens: [{ principal: "peer-agent", kind: "agent", requests: 3, tokens: agentTokens }],
      },
    },
    peers: {},
    rollup: {
      hubs: 1,
      tps: 4,
      current_connections: 1,
      active_models: 1,
      sessions: { users: 0, agents: 1, services: 0 },
      longest_running_s: 12,
      top_tokens: [{ hub, principal: "peer-agent", kind: "agent", tokens: agentTokens }],
    },
  });
}

function settingsOf(port: number, statsCacheMs?: number) {
  const dir = mintKeyDir({ "peer-p.token": "peer-token\n" });
  return mergeSettings(
    { hub: { label: "t" } },
    {
      hubs: { p: { url: `http://127.0.0.1:${port}`, token_file: join(dir, "peer-p.token") } },
      ...(statsCacheMs === undefined ? {} : { timeouts: { stats_cache_ms: statsCacheMs } }),
    },
  );
}

describe("the stats mem cache", () => {
  test("one peer pull per TTL window — concurrent GETs share the flight", async () => {
    const peer = stubPeer(peerBody("p1", 10));
    const cache = createStatsCache(settingsOf(peer.port, 60_000), readToken);
    const first = await cache.peers();
    const second = await cache.peers();
    expect(first["p"]?.hub).toBe("p1");
    expect(second).toBe(first);
    expect(peer.hits).toBe(1);
    await cache.peers(); // still inside the window
    expect(peer.hits).toBe(1);
    peer.stop();
  });

  test("ttl 0 = always fresh (every call pulls)", async () => {
    const peer = stubPeer(peerBody("p1", 10));
    const cache = createStatsCache(settingsOf(peer.port, 0), readToken);
    await cache.peers();
    await cache.peers();
    expect(peer.hits).toBe(2);
    peer.stop();
  });

  test("a dead peer folds an honest null, never a throw", async () => {
    const cache = createStatsCache(settingsOf(1, 0), readToken); // nothing on port 1
    const peers = await cache.peers();
    expect(peers["p"]).toBeNull();
  });
});

describe("the fleet rollup", () => {
  test("kind-split sessions, distinct active models, longest running, top tokens — hub-labelled", async () => {
    const peer = stubPeer(peerBody("p1", 10));
    const settings = settingsOf(peer.port, 60_000);
    const live = createLive("t");
    live.open("alice@fleet", "human", "m1");
    live.close("alice@fleet", "m1", 5);
    live.open("bot-1", "agent", "m1");
    live.close("bot-1", "m1", 50);
    const body = await statsBody(settings, live, createStatsCache(settings, readToken));
    expect(body.self.hub).toBe("t");
    expect(body.rollup.hubs).toBe(2);
    // both hubs active on m1 + the peer's own model = 2 distinct ids
    expect(body.rollup.active_models).toBe(2);
    expect(body.rollup.sessions).toEqual({ users: 1, agents: 2, services: 0 });
    expect(body.rollup.top_tokens[0]).toEqual({
      hub: "t",
      principal: "bot-1",
      kind: "agent",
      tokens: 50,
    });
    peer.stop();
  });
});

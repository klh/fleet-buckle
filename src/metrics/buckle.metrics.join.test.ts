import { describe, expect, test } from "bun:test";
import { joinReceipts, exposeReadModel } from "./buckle.metrics.join.ts";
import { BuckleReadModel } from "../schemas/buckle.stats.zod.ts";
import fixture from "../schemas/fixtures/read-model.v1.json";

const corr = (id: string) => ({ ...fixture.rows[0]!.correlation, request_id: id });
const req = (id: string) => ({ correlation: corr(id), model: "m", attempts: 1 });

describe("read model join", () => {
  test("fixture is schema-valid with W14 fields", () => {
    const m = BuckleReadModel.parse(fixture);
    expect(m.rows[0]!.correlation.writer_epoch).toBe(3);
  });
  test("missing price → null cost, never 0", () => {
    const m = joinReceipts({ requests: [req("a")], spend: [{ request_id: "a", priced: false }], now: 1, lastSuccessAt: 1, outage: false });
    expect(m.rows[0]!.cost_usd).toBeNull();
    expect(m.rows[0]!.cost_state).toBe("missing_price");
  });
  test("spend lag → null + spend_lag; later receipt prices it", () => {
    const a = joinReceipts({ requests: [req("a")], spend: [], now: 1, lastSuccessAt: 1, outage: false });
    expect(a.rows[0]!.cost_state).toBe("spend_lag");
    const b = joinReceipts({ requests: [req("a")], spend: [{ request_id: "a", cost_usd: 0.5 }], now: 2, lastSuccessAt: 2, outage: false });
    expect(b.rows[0]!.cost_usd).toBe(0.5);
  });
  test("collector outage is stated; labels bounded", () => {
    const m = joinReceipts({ requests: [req("a")], spend: [], now: 1, lastSuccessAt: null, outage: true });
    expect(m.collector).toEqual({ state: "outage", last_success_at: null });
    const text = exposeReadModel(m);
    expect(text).toContain("buckle_collector_up 0");
    expect(text).not.toContain("req-");
    expect(text).not.toContain("runner_uuid");
    expect(text).not.toContain("a\"");
  });
});

import { describe, it, expect, vi } from "vitest";
import * as dbModule from "../db";
import { getSwitchSavings } from "./switchSavings";

describe("getSwitchSavings — no N+1 queries", () => {
  it("issues O(1) DB calls regardless of candidate count", async () => {
    const selectSpy = vi.spyOn(dbModule.db, "select");

    await getSwitchSavings({ months: 24, topN: 5 });

    // With the fix, db.select is called a fixed number of times in the
    // pre-fetch phase (shows-join, expenses, artists, etc.), not once
    // per candidate. The exact count varies by implementation; the
    // invariant is that it stays bounded and small, not proportional
    // to candidate count.
    const callCount = selectSpy.mock.calls.length;
    expect(callCount).toBeLessThan(20);

    selectSpy.mockRestore();
  });
});

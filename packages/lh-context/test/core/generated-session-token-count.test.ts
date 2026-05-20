import { describe, expect, it } from "vitest";
import { generatedSessionTokenCount } from "../../src/core/util.js";

describe("generatedSessionTokenCount", () => {
  it("falls back to generatedOutput.generatedSessionTokenCount when metadata is absent", () => {
    const thread = {
      threadViewOutputSummary: {
        generatedOutput: {
          generatedSessionTokenCount: 2345,
        },
      },
    };

    expect(generatedSessionTokenCount(thread, [])).toEqual({
      count: 2345,
      label: "unknown",
      source: "thread_view_output_summary.generatedSessionTokenCount",
    });
  });

  it("falls back to latest non-zero assistant usage when thread output summary count is absent", () => {
    const records = [
      { type: "message", message: { role: "assistant", usage: { totalTokens: 1234 } } },
      { type: "message", message: { role: "user" } },
      { type: "message", message: { role: "assistant", usage: { totalTokens: 5678 } } },
    ];

    expect(generatedSessionTokenCount({}, records)).toEqual({
      count: 5678,
      label: "provider_exact",
      source: "latest_assistant_usage",
    });
  });

  it("returns undefined when only zero-valued synthetic assistant usage exists and no thread count exists", () => {
    const records = [
      { type: "message", message: { role: "assistant", usage: { totalTokens: 0 } } },
    ];

    expect(generatedSessionTokenCount({}, records)).toBeUndefined();
  });
});

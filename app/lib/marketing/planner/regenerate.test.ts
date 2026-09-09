import { describe, it, expect } from "vitest";
import { parseFills, type GapRequest } from "./decide";

// regenerateSlot itself is Firestore + a model call, so what is tested here is
// the guarantee it depends on: that a one-gap request with a single allowed
// channel cannot come back with a different channel, whatever the model says.
//
// That is the whole reason a regenerate can promise "the date, time and
// channel never move" without re-running assign.

function oneGap(channel: "linkedin" | "instagram" | "twitter" | "email"): GapRequest {
  return {
    gap_id: "regen__slot1",
    type: "reel",
    index_in_set: 0,
    of_in_set: 1,
    allowed_channels: [channel],
    default_channel: channel,
    eligible_campaign_ids: ["c1"],
  };
}

describe("the one-gap regenerate request", () => {
  it("pins the channel even when the model answers with another", () => {
    const gap = oneGap("instagram");
    const { fills, warnings } = parseFills(
      {
        fills: [
          {
            gap_id: gap.gap_id,
            channel: "linkedin", // not in allowed_channels
            theme: "A new angle",
            hook: "A hook",
            body: ["One", "Two"],
            cta: "An ask",
          },
        ],
      },
      [gap]
    );
    expect(fills[0].channel).toBe("instagram");
    expect(warnings.join(" ")).toContain("not allowed");
  });

  it("keeps the campaign when the model returns the one it was given", () => {
    const gap = oneGap("instagram");
    const { fills } = parseFills(
      { fills: [{ gap_id: gap.gap_id, campaign_id: "c1", theme: "T" }] },
      [gap]
    );
    expect(fills[0].campaignId).toBe("c1");
  });

  it("refuses a campaign the slot does not belong to", () => {
    const gap = oneGap("instagram");
    const { fills } = parseFills(
      { fills: [{ gap_id: gap.gap_id, campaign_id: "someone-elses", theme: "T" }] },
      [gap]
    );
    expect(fills[0].campaignId).toBeNull();
  });

  it("marks an empty answer as needing a theme, which is the refuse signal", () => {
    // regenerateSlot treats needsTheme as "do not write this over good
    // content" — the opposite of the plan path, which persists skeletons on
    // purpose so a run still produces correctly dated slots.
    const gap = oneGap("instagram");
    const { fills } = parseFills({ fills: [] }, [gap]);
    expect(fills[0].needsTheme).toBe(true);
    expect(fills[0].theme).toBe("");
  });

  it("still applies the character caps", () => {
    const gap = oneGap("instagram");
    const { fills } = parseFills(
      {
        fills: [
          {
            gap_id: gap.gap_id,
            theme: "t".repeat(500),
            hook: "h".repeat(500),
            body: Array.from({ length: 30 }, () => "b".repeat(900)),
          },
        ],
      },
      [gap]
    );
    expect(fills[0].theme.length).toBe(120);
    expect(fills[0].hook.length).toBe(200);
    expect(fills[0].body).toHaveLength(8);
    expect(fills[0].body[0].length).toBe(300);
  });
});

import { describe, it, expect } from "vitest";
import { calendarEmbedUrl, calendarOpenUrl } from "./calendar-links";

// Real secondary-calendar ids carry an "@" and the zone carries a "/". Both
// must survive as query values, which is the only way these can be wrong.
const ID = "c_020c872e@group.calendar.google.com";

describe("calendarEmbedUrl", () => {
  it("encodes the id and the zone", () => {
    const url = calendarEmbedUrl(ID, "America/New_York");
    expect(url).toContain("src=c_020c872e%40group.calendar.google.com");
    expect(url).toContain("ctz=America%2FNew_York");
    expect(url).toContain("mode=WEEK");
  });

  it("falls back to UTC", () => {
    expect(calendarEmbedUrl(ID)).toContain("ctz=UTC");
  });
});

describe("calendarOpenUrl", () => {
  it("encodes the id", () => {
    expect(calendarOpenUrl(ID)).toBe(
      "https://calendar.google.com/calendar/u/0/r?cid=c_020c872e%40group.calendar.google.com"
    );
  });
});

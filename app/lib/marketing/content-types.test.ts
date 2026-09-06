import { describe, it, expect } from "vitest";
import {
  CONTENT_TYPES,
  CONTENT_TYPE_KEYS,
  PUBLISHABLE_TYPES,
  COMPONENT_TYPES,
  contentTypeLabel,
  defaultChannelsFor,
  implausibleChannels,
} from "./content-types";
import { CHANNELS } from "./posting-windows";

describe("CONTENT_TYPES", () => {
  it("has unique keys", () => {
    expect(new Set(CONTENT_TYPE_KEYS).size).toBe(CONTENT_TYPE_KEYS.length);
  });

  it("only names channels the planner knows how to schedule", () => {
    // A channel with no posting window falls back to DEFAULT_WINDOW, which is
    // survivable — but a typo here would silently schedule to nowhere useful.
    for (const type of CONTENT_TYPES) {
      for (const channel of type.channels) {
        expect(CHANNELS, `${type.key} -> ${channel}`).toContain(channel);
      }
    }
  });

  it("gives every type at least one channel", () => {
    // A type with no channels can never be placed: resolveChannels would fall
    // through to "every channel is allowed", which is not what an empty list
    // here would be intending to say.
    for (const type of CONTENT_TYPES) {
      expect(type.channels.length, type.key).toBeGreaterThan(0);
    }
  });

  it("keeps the old vocabulary working", () => {
    // Quotas already saved against these must not become unrecognised.
    for (const legacy of ["post", "post_alt", "hook", "cta"]) {
      expect(CONTENT_TYPE_KEYS).toContain(legacy);
    }
  });

  it("splits publishable formats from post components", () => {
    expect(PUBLISHABLE_TYPES.map((t) => t.key)).toContain("reel");
    expect(COMPONENT_TYPES.map((t) => t.key)).toEqual(["hook", "cta"]);
    expect(PUBLISHABLE_TYPES.length + COMPONENT_TYPES.length).toBe(
      CONTENT_TYPES.length
    );
  });

  it("puts each format only where it can actually be published", () => {
    expect(defaultChannelsFor("reel")).toEqual(["instagram"]);
    expect(defaultChannelsFor("newsletter")).toEqual(["email"]);
    expect(defaultChannelsFor("thread")).toEqual(["twitter"]);
    expect(defaultChannelsFor("carousel")).not.toContain("email");
  });
});

describe("contentTypeLabel", () => {
  it("uses the table when it knows the key", () => {
    expect(contentTypeLabel("post_alt")).toBe("Alt post");
    expect(contentTypeLabel("cta")).toBe("CTA");
  });

  it("titlecases a key it has never seen", () => {
    // Quota keys are free-form, so this has to degrade rather than blank out.
    expect(contentTypeLabel("live_stream")).toBe("Live Stream");
  });
});

describe("implausibleChannels", () => {
  it("flags a format on a channel that cannot carry it", () => {
    expect(implausibleChannels("reel", ["instagram", "email"])).toEqual(["email"]);
  });

  it("stays quiet when the pairing is fine", () => {
    expect(implausibleChannels("post", ["linkedin", "twitter"])).toEqual([]);
  });

  it("says nothing about a type it does not know", () => {
    // Never block on an unrecognised key — the table is guidance, not schema.
    expect(implausibleChannels("live_stream", ["email"])).toEqual([]);
  });
});

describe("defaultChannelsFor", () => {
  it("returns an empty list for an unknown type", () => {
    expect(defaultChannelsFor("live_stream")).toEqual([]);
  });
});

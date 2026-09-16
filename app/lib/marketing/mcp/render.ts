// Turning a piece into something a model can read. Pure.
//
// A tool that answers with a wall of JSON makes the model do parsing work it is
// mediocre at, and spends context on punctuation. Every read tool here returns
// prose as its content block AND the projection as structuredContent, so a
// model reads the first and a program can still use the second.
//
// Everything renders from AgentSlot — the projection — rather than from the
// Slot itself. That is deliberate and is the second line of defence on the one
// rule that would be most embarrassing to break: projectSlot has already
// stripped `note` (production direction: "shot 2, cut to the whiteboard"), so a
// renderer working from the projection cannot emit one even by mistake.

import type { AgentSlot } from "../../types";

export interface RenderedRange {
  from: string;
  to: string;
  timezone: string;
}

/** One piece, in full. What you would need to actually make and post it. */
export function renderSlot(slot: AgentSlot, warnings: string[] = []): string {
  const lines: string[] = [];

  lines.push(`${slot.format_label} · ${slot.channel}`);
  lines.push(
    slot.date
      ? `Scheduled ${slot.date} at ${slot.time_local ?? "a time not set"} (${slot.timezone})`
      : "Not scheduled"
  );
  lines.push(
    slot.publishable
      ? "READY — released by a human, copy matches the brief"
      : `NOT READY — ${whyNotReady(slot)}`
  );
  if (slot.campaign?.title) lines.push(`Campaign: ${slot.campaign.title}`);
  lines.push("");

  lines.push(`THEME: ${slot.theme || "not set"}`);
  lines.push("");

  if (slot.copy.state !== "missing") {
    lines.push("COPY");
    if (slot.copy.headline) lines.push(`Headline: ${slot.copy.headline}`);
    for (const block of slot.copy.blocks) {
      lines.push(`${block.label}: ${block.text}`);
      if (block.on_screen) lines.push(`  on screen: ${block.on_screen}`);
    }
    if (slot.copy.caption) {
      lines.push("");
      lines.push(`Caption: ${slot.copy.caption}`);
    }
    if (slot.copy.hashtags.length) lines.push(`Hashtags: ${slot.copy.hashtags.join(" ")}`);
    lines.push("");
  }

  // The brief goes in when there is no copy — there is nothing else to show —
  // and alongside STALE copy, where the mismatch is the point.
  if (slot.copy.state !== "ready") {
    lines.push("BRIEF");
    if (slot.brief.one_line) lines.push(slot.brief.one_line);
    if (slot.brief.hook) lines.push(`Hook: ${slot.brief.hook}`);
    slot.brief.body.forEach((beat, i) => lines.push(`  ${i + 1}. ${beat}`));
    if (slot.brief.cta) lines.push(`Ask: ${slot.brief.cta}`);
    lines.push("");
  }

  if (slot.published) {
    lines.push(
      `ALREADY PUBLISHED at ${slot.published.published_at}` +
        (slot.published.external_url ? ` — ${slot.published.external_url}` : "")
    );
    lines.push("");
  }

  if (warnings.length) {
    lines.push("WARNINGS");
    warnings.forEach((w) => lines.push(`- ${w}`));
    lines.push("");
  }

  lines.push(`id: ${slot.id}`);
  return lines.join("\n").trim();
}

/** A window of pieces, one block each. */
export function renderSlotList(range: RenderedRange, slots: AgentSlot[]): string {
  if (slots.length === 0) {
    return `Nothing scheduled between ${range.from} and ${range.to} (${range.timezone}).`;
  }

  const header =
    `${slots.length} piece${slots.length === 1 ? "" : "s"} between ${range.from} and ` +
    `${range.to}, in ${range.timezone}. Dates are the client's local calendar.`;

  // No blank element in this array. The separator applies between every pair,
  // so an empty string added for spacing renders as its own divided block —
  // the list then opens with an empty piece, which reads as a piece that
  // failed to load.
  return [header, ...slots.map((s) => renderSlot(s))].join("\n\n---\n\n");
}

export function renderClients(
  clients: { id: string; name: string; timezone: string; status: string }[],
  key: { name: string; scopes: readonly string[]; scopeKind: "client" | "agency" }
): string {
  const lines = [
    key.scopeKind === "agency"
      ? `This key ("${key.name}") covers the whole agency, so every other tool needs a client_id.`
      : `This key ("${key.name}") covers one client, so client_id can be omitted.`,
    `It may: ${key.scopes.join(", ")}`,
    "",
  ];
  if (clients.length === 0) {
    lines.push("No clients are reachable with this key.");
  } else {
    clients.forEach((c) =>
      lines.push(`${c.name} — ${c.timezone} — ${c.status} — id: ${c.id}`)
    );
  }
  return lines.join("\n");
}

/** Voice and visual identity, as prose rather than a nested object. */
export function renderBrand(brand: {
  business_name: string;
  voice: Record<string, unknown>;
  positioning: Record<string, unknown>;
  icp: Record<string, unknown>;
  messaging: Record<string, unknown>;
  visual: Record<string, unknown>;
  lessons: string[];
  logo: { url: string | null };
}): string {
  const lines: string[] = [`BRAND: ${brand.business_name || "unnamed"}`, ""];

  section(lines, "VOICE", brand.voice);
  section(lines, "POSITIONING", brand.positioning);
  section(lines, "WHO THEY SELL TO", brand.icp);
  section(lines, "MESSAGING", brand.messaging);
  section(lines, "VISUAL", brand.visual);

  if (brand.logo.url) {
    lines.push(`LOGO: ${brand.logo.url}`);
    lines.push("");
  }

  // Last and unmissable: these are the rules a human wrote after rejecting
  // work, so they override general instinct about what good copy looks like.
  if (brand.lessons.length) {
    lines.push("RULES THIS CLIENT'S OPERATOR HAS TAUGHT — these override your instincts:");
    brand.lessons.forEach((l) => lines.push(`- ${l}`));
    lines.push("");
  }

  return lines.join("\n").trim();
}

function whyNotReady(slot: AgentSlot): string {
  if (slot.copy.state === "missing") return "no copy has been written yet";
  if (slot.copy.state === "stale") return "the brief changed after the copy was written";
  if (slot.status === "posted") return "it has already been published";
  return `a human has not released it (status: ${slot.status})`;
}

/**
 * Renders a free-form object without pretending to know its shape.
 *
 * voice, positioning and the rest are author-controlled documents — the app
 * never validates them — so anything that assumed particular keys would render
 * blanks the moment somebody restructured their strategy.
 */
function section(lines: string[], title: string, value: Record<string, unknown>) {
  const entries = Object.entries(value ?? {}).filter(
    ([, v]) => v !== null && v !== undefined && v !== ""
  );
  if (entries.length === 0) return;

  lines.push(title);
  for (const [key, v] of entries) {
    lines.push(`${label(key)}: ${flatten(v)}`);
  }
  lines.push("");
}

function label(key: string): string {
  return key.replace(/_/g, " ");
}

function flatten(value: unknown): string {
  if (Array.isArray(value)) return value.map(flatten).filter(Boolean).join("; ");
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => `${label(k)} ${flatten(v)}`)
      .join("; ");
  }
  return String(value);
}

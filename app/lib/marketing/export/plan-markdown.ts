import type { Slot } from "../../types";
import { contentTypeLabel } from "../content-types";

// The content plan as a document.
//
// Pure on purpose: it takes slots and returns a string, so the output can be
// asserted character by character in a test rather than eyeballed in a
// browser. Everything else under lib/marketing/planner is built the same way.
//
// Markdown rather than PDF because this is meant to be pasted — into Slack, an
// email, a Google Doc, a client's project tracker. A PDF is a better handoff
// artefact and is one step away (@react-pdf/renderer is already a dependency),
// but it is not what unblocks anyone today.

export interface PlanDocMeta {
  clientName: string;
  timezone: string;
  start: string;
  end: string;
  /** Injectable so tests are not time-dependent. */
  generatedAt?: Date;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/**
 * "2026-09-08" -> "Tue 8 Sep".
 *
 * Fixed tables rather than toLocaleDateString: this is a document, and its
 * bytes should not change with the platform's ICU data. (en-GB renders
 * September as "Sept", en-US as "Sep" — same code, different output, on a
 * server versus a browser.)
 *
 * Parsed as UTC so a reader west of Greenwich never sees the 8th as the 7th.
 */
function dayLabel(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return date;
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

function titleCase(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Statuses worth naming in a document. A planned slot is the unremarkable case. */
function statusNote(status: string): string {
  return status === "planned" ? "" : ` _(${status})_`;
}

export function planMarkdown(slots: Slot[], meta: PlanDocMeta): string {
  const generated = meta.generatedAt ?? new Date();
  const lines: string[] = [];

  lines.push(`# Content plan — ${meta.clientName}`);
  lines.push("");
  lines.push(`**${meta.start} to ${meta.end}** · times shown in ${meta.timezone}`);
  lines.push("");

  const live = slots.filter(
    (s) => s.status !== "cancelled" && s.status !== "skipped"
  );

  if (live.length === 0) {
    lines.push("_No content scheduled in this range._");
    lines.push("");
  } else {
    lines.push(
      `${live.length} piece${live.length === 1 ? "" : "s"} of content scheduled.`
    );
    lines.push("");

    // Grouped by ISO week, in date order. Insertion order is preserved by the
    // Map, and listSlots already returns slots sorted by date and time.
    const byWeek = new Map<string, Slot[]>();
    for (const slot of live) {
      const key = slot.week_key || "Unscheduled";
      const bucket = byWeek.get(key);
      if (bucket) bucket.push(slot);
      else byWeek.set(key, [slot]);
    }

    for (const [weekKey, weekSlots] of byWeek) {
      lines.push(`## ${weekKey}`);
      lines.push("");
      for (const slot of weekSlots) {
        const heading =
          `**${dayLabel(slot.date)} · ${slot.time_local}** — ` +
          `${titleCase(slot.channel)} · ${contentTypeLabel(slot.type)}` +
          statusNote(slot.status);
        lines.push(`### ${heading}`);
        lines.push("");
        // needs_theme means the model was unreachable when this was planned.
        // Saying so is more useful than printing an empty heading.
        lines.push(slot.needs_theme || !slot.theme ? "_Theme not set._" : slot.theme);
        lines.push("");
        if (slot.brief) {
          lines.push(slot.brief);
          lines.push("");
        }
        if (slot.hook) {
          lines.push(`**Hook** — ${slot.hook}`);
          lines.push("");
        }
        if (slot.body?.length) {
          // Numbered, because for a carousel or a reel the order is the piece.
          slot.body.forEach((beat, i) => lines.push(`${i + 1}. ${beat}`));
          lines.push("");
        }
        if (slot.cta) {
          lines.push(`**CTA** — ${slot.cta}`);
          lines.push("");
        }
        const meta: string[] = [];
        if (slot.campaign_title) meta.push(`Campaign: ${slot.campaign_title}`);
        if (slot.rationale) meta.push(slot.rationale);
        if (meta.length > 0) {
          lines.push(`_${meta.join(" · ")}_`);
          lines.push("");
        }
      }
    }
  }

  const dropped = slots.length - live.length;
  if (dropped > 0) {
    lines.push(
      `_${dropped} cancelled or skipped slot${dropped === 1 ? "" : "s"} omitted._`
    );
    lines.push("");
  }

  lines.push("---");
  lines.push("");
  lines.push(`Generated ${generated.toISOString().slice(0, 16).replace("T", " ")} UTC`);

  return lines.join("\n");
}

/** A filename that sorts chronologically and survives every filesystem. */
export function planFilename(clientName: string, start: string, end: string): string {
  const slug =
    clientName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "client";
  return `${slug}-content-plan-${start}-to-${end}.md`;
}

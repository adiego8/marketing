// What the model is offered, and what it is told about each one. Pure.
//
// Tool descriptions are the only documentation a language model is guaranteed
// to read. Every rule that matters — the publish gate, what counts as a real
// platform id, that a piece with stale copy must not go out — lives in the
// text here rather than in a spec file, because the spec file is not in the
// context window and this is.

import { z } from "zod/v4";
import type { ApiKeyScope } from "../../types";

/**
 * Annotations are set in full on every tool, never partially.
 *
 * The SDK's defaults are the unsafe ones: `destructiveHint` and
 * `openWorldHint` both default to TRUE when omitted, so a read-only tool that
 * simply forgot to mention it is presented to the host as destructive. A test
 * asserts all four are present on every tool for exactly that reason.
 */
export interface ToolAnnotations {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
}

export interface ToolSpec {
  name: string;
  scope: ApiKeyScope;
  title: string;
  description: string;
  inputSchema: Record<string, z.ZodType>;
  annotations: ToolAnnotations;
}

const READ: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  // True: these read a live database that changes underneath us, not a closed
  // set the model could reason about exhaustively.
  openWorldHint: true,
};

const WRITE: ToolAnnotations = {
  readOnlyHint: false,
  // It adds a record; it destroys nothing. Marking it destructive would train
  // operators to click through a warning that does not mean what it says.
  destructiveHint: false,
  // The whole point of the idempotency key — a repeat is a replay, not a
  // second post.
  idempotentHint: true,
  openWorldHint: true,
};

/** Every tool a key could ever be granted, in the order they should be tried. */
export const TOOLS: ToolSpec[] = [
  {
    name: "list_clients",
    scope: "brand:read",
    title: "List clients",
    description:
      "List the clients this API key can reach, with their timezones. Call this first. " +
      "If the key covers a whole agency, every other tool needs a client_id from here; " +
      "if it covers a single client, client_id can be omitted everywhere.",
    inputSchema: {},
    annotations: READ,
  },
  {
    name: "list_scheduled_content",
    scope: "schedule:read",
    title: "List scheduled content",
    description:
      "What a client is scheduled to publish in a given window, with the finished copy. " +
      "Dates are calendar dates in the CLIENT's timezone, never UTC. " +
      "By default only pieces cleared for publishing are returned: a human has released them " +
      "and their copy was written from the brief they currently carry. " +
      "Set include_unready to see drafts and pieces whose copy has gone stale — useful for " +
      "answering questions about the plan, never for deciding what to post.",
    inputSchema: {
      client_id: z
        .string()
        .optional()
        .describe("Required when the key covers a whole agency. From list_clients."),
      period: z
        .enum(["day", "week", "month"])
        .optional()
        .describe("Resolved in the client's timezone. Weeks start Monday. Defaults to week."),
      date: z
        .string()
        .optional()
        .describe("YYYY-MM-DD anchor for period. Defaults to today in the client's timezone."),
      from: z.string().optional().describe("YYYY-MM-DD. Use with `to` instead of period."),
      to: z.string().optional().describe("YYYY-MM-DD, inclusive. At most 92 days from `from`."),
      channel: z
        .string()
        .optional()
        .describe("Limit to one channel, e.g. linkedin, instagram, twitter, email."),
      include_unready: z
        .boolean()
        .optional()
        .describe("Include pieces that are NOT cleared to publish. Default false."),
    },
    annotations: READ,
  },
  {
    name: "get_content",
    scope: "schedule:read",
    title: "Get one piece",
    description:
      "One scheduled piece in full: the brief it was written from, the finished copy, and any " +
      "platform limits it exceeds. Re-read a piece immediately before publishing it — briefs " +
      "get edited, and copy written from an older brief must not go out.",
    inputSchema: {
      slot_id: z.string().describe("From list_scheduled_content."),
      client_id: z.string().optional().describe("Required for an agency-wide key."),
    },
    annotations: READ,
  },
  {
    name: "get_brand",
    scope: "brand:read",
    title: "Get brand and voice",
    description:
      "How this client sounds and looks: voice, positioning, who they sell to, their colours " +
      "and fonts, and the specific rules their operator has taught the system — things like " +
      "words to avoid. Read this before writing or judging any copy for them.",
    inputSchema: {
      client_id: z.string().optional().describe("Required for an agency-wide key."),
    },
    annotations: READ,
  },
  {
    name: "report_published",
    scope: "schedule:publish",
    title: "Report a published piece",
    description:
      "Record that a piece has actually been published. " +
      "ONLY call this after the post genuinely exists on the platform — external_id must be the " +
      "platform's own identifier for it, not one you invent. Never call it to indicate intent, " +
      "and never to mark something done on a user's say-so alone. " +
      "Calling it twice for the same piece and external_id is safe: the second call replays the " +
      "first rather than recording a second publication.",
    inputSchema: {
      slot_id: z.string().describe("The piece that was published."),
      external_id: z
        .string()
        .describe("The platform's own id for the post, e.g. a LinkedIn share urn."),
      external_url: z.string().optional().describe("Public URL of the post, if there is one."),
      published_at: z
        .string()
        .optional()
        .describe("ISO-8601 instant. Defaults to now. Must not be in the future."),
      client_id: z.string().optional().describe("Required for an agency-wide key."),
    },
    annotations: WRITE,
  },
  {
    name: "report_failed",
    scope: "schedule:publish",
    title: "Report a failed attempt",
    description:
      "Record that publishing a piece was attempted and failed, and why. The piece stays " +
      "scheduled and released so it can be retried — this only leaves a note a human will see. " +
      "Use it when the platform rejected the post, not when you simply chose not to publish.",
    inputSchema: {
      slot_id: z.string().describe("The piece that could not be published."),
      reason: z.string().describe("What went wrong, in one or two sentences."),
      client_id: z.string().optional().describe("Required for an agency-wide key."),
    },
    annotations: WRITE,
  },
];

/**
 * The tools a key may use.
 *
 * A key without `schedule:publish` must not merely be refused when it calls
 * report_published — it must never be offered it. A model shown a tool it
 * cannot use will call it, be refused, and try again; and a tool list is also
 * a disclosure, telling the caller what the system can do at all.
 */
export function toolsForScopes(scopes: readonly string[]): ToolSpec[] {
  const granted = new Set(scopes);
  return TOOLS.filter((t) => granted.has(t.scope));
}

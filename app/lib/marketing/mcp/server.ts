// Wiring the tools to the modules that already do the work.
//
// This file decides nothing. Every judgement it relies on — which client, what
// range, is a piece publishable, is this report a replay or a conflict — lives
// in a pure module beside it and is tested there. What is left here is the
// translation between an MCP tool call and a function call, which is exactly
// the part this repo cannot unit-test (it mocks nothing), so it is kept thin
// on purpose.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { serializeClient } from "../../firestore";
import { getSlot, listSlots, markSlotPublished, markSlotFailed } from "../slots";
import { getStrategy } from "../strategy";
import { listLessons } from "../lessons-store";
import { lessonsFor } from "../lessons";
import { resolveRange } from "../agent/range";
import {
  projectSlot,
  publishable,
  projectBranding,
  safeLogoUrl,
  slotWarnings,
  sortKeyOf,
} from "../agent/project";
import { parsePublishBody } from "../agent/publish";
import {
  resolveClient,
  clientsForKey,
  NEEDS_CLIENT,
} from "../agent/route-helpers";
import { hasScope } from "../api-keys";
import type { StoredKey } from "../api-keys-store";
import { TOOLS, toolsForScopes, type ToolSpec } from "./tools";
import { idempotencyKeyFor } from "./idempotency";
import { renderSlot, renderSlotList, renderBrand, renderClients } from "./render";

/** A tool result. Text only — see the note on structuredContent below. */
type ToolResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

function say(text: string): ToolResult {
  return { content: [{ type: "text", text }] };
}

/**
 * A refusal the model can act on.
 *
 * isError rather than a thrown exception: a thrown one becomes a protocol
 * error, which most hosts surface as "the tool broke" and the model cannot
 * reason about. This comes back as content it can read and correct.
 */
function refuse(text: string): ToolResult {
  return { content: [{ type: "text", text }], isError: true };
}

/**
 * Build a server for one request.
 *
 * A fresh instance every time, never hoisted to module scope: the transport
 * carries a `_hasHandledRequest` flag and the key differs per caller, so a
 * shared server would either refuse the second request or answer it with the
 * first caller's permissions.
 */
export function buildMcpServer(key: StoredKey): McpServer {
  const server = new McpServer(
    {
      name: "numerico-marketing",
      version: "1.0.0",
      description:
        "What each marketing client is scheduled to publish, in their own voice, " +
        "and a way to report back what actually went out.",
    },
    {
      instructions:
        "Call list_clients first — it says whether the other tools need a client_id. " +
        "Dates are calendar dates in each client's own timezone, never UTC. " +
        "Only publish pieces reported as READY: a human released them and their copy " +
        "matches the brief it was written from.",
    }
  );

  // Scope-filtered, so a key without schedule:publish never sees the write
  // tools at all rather than being refused when it calls them.
  for (const spec of toolsForScopes(key.scopes)) {
    server.registerTool(
      spec.name,
      {
        title: spec.title,
        description: spec.description,
        inputSchema: spec.inputSchema,
        annotations: spec.annotations,
      },
      // The SDK types the callback against the declared schema; the handler
      // below narrows from a record, which is why the cast is here and not in
      // the handlers themselves.
      (async (args: Record<string, unknown>) =>
        handle(key, spec, args ?? {})) as never
    );
  }

  return server;
}

async function handle(
  key: StoredKey,
  spec: ToolSpec,
  args: Record<string, unknown>
): Promise<ToolResult> {
  // Belt and braces. toolsForScopes already withheld this tool, so reaching
  // here would mean a registration bug rather than a caller one — but a scope
  // check that exists only at registration time is one refactor from gone.
  if (!hasScope(key, spec.scope)) {
    return refuse(`This API key does not carry the ${spec.scope} scope.`);
  }

  const str = (k: string): string | undefined =>
    typeof args[k] === "string" && args[k].trim() ? (args[k] as string).trim() : undefined;

  if (spec.name === "list_clients") {
    const clients = await clientsForKey(key);
    return say(
      renderClients(
        clients.map((c) => {
          const client = serializeClient(c.id, c.data);
          return {
            id: client.id,
            name: client.name,
            timezone: client.timezone,
            status: client.status,
          };
        }),
        {
          name: key.name,
          scopes: key.scopes,
          reachesAll: key.clientIds === null,
        }
      )
    );
  }

  // Everything else is about exactly one client.
  const resolved = await resolveClient(key, str("client_id") ?? null);
  if ("error" in resolved) {
    return refuse(
      resolved.error === "needs_client"
        ? NEEDS_CLIENT
        : "No such client, or this key cannot reach it."
    );
  }
  const clientId = resolved.client.id;
  const timezone = String(resolved.client.data.timezone || "UTC");

  switch (spec.name) {
    case "list_scheduled_content": {
      const range = resolveRange(
        {
          period: str("period") ?? null,
          date: str("date") ?? null,
          from: str("from") ?? null,
          to: str("to") ?? null,
        },
        timezone
      );
      if ("error" in range) return refuse(range.error);

      const { from, to } = range.range;
      const all = await listSlots(clientId, { start: from, end: to });
      const channel = str("channel")?.toLowerCase();

      /**
       * Unready pieces are hidden unless asked for, exactly as over REST.
       *
       * A model shown a draft alongside a released piece has no reliable way
       * to keep them apart across a long conversation, and the cost of getting
       * it wrong is a half-written thought on a client's feed.
       */
      const includeUnready = args.include_unready === true;

      const matched = all
        .filter((s) => {
          if (s.status === "cancelled" || s.status === "skipped") return false;
          if (channel && s.channel.toLowerCase() !== channel) return false;
          if (!includeUnready && !publishable(s)) return false;
          return true;
        })
        .sort((a, b) => sortKeyOf(a).localeCompare(sortKeyOf(b)));

      return say(
        renderSlotList({ from, to, timezone }, matched.map(projectSlot))
      );
    }

    case "get_content": {
      const slotId = str("slot_id");
      if (!slotId) return refuse("slot_id is required.");

      const slot = await getSlot(clientId, slotId);
      if (!slot) return refuse("No such piece for this client.");

      return say(renderSlot(projectSlot(slot), slotWarnings(slot)));
    }

    case "get_brand": {
      const client = serializeClient(resolved.client.id, resolved.client.data);
      const strategy = await getStrategy(clientId);
      // listLessons, not lessonsForPrompt: the latter swallows a Firestore
      // error and returns [], which would tell the model this client has no
      // voice rules when in fact we could not read them.
      const lessons = await listLessons(clientId);

      return say(
        renderBrand({
          business_name: strategy?.business_name || client.name,
          voice: (strategy?.voice ?? {}) as Record<string, unknown>,
          positioning: (strategy?.positioning ?? {}) as Record<string, unknown>,
          icp: (strategy?.icp ?? {}) as Record<string, unknown>,
          messaging: (strategy?.messaging ?? {}) as Record<string, unknown>,
          visual: projectBranding(client.branding) as unknown as Record<string, unknown>,
          lessons: lessonsFor(lessons, "copy"),
          logo: { url: safeLogoUrl(client.logo_url) },
        })
      );
    }

    case "report_published": {
      const slotId = str("slot_id");
      const externalId = str("external_id");
      if (!slotId) return refuse("slot_id is required.");
      if (!externalId) {
        return refuse(
          "external_id is required — the platform's own id for the post that now exists."
        );
      }

      const parsed = parsePublishBody({
        external_id: externalId,
        external_url: str("external_url"),
        published_at: str("published_at"),
        // Derived when absent, because a model that retries will not remember
        // the key it sent — and without this its truthful second report would
        // be refused as a conflict forever.
        idempotency_key: idempotencyKeyFor(slotId, externalId, str("idempotency_key")),
      });
      if ("error" in parsed) return refuse(parsed.error);

      const outcome = await markSlotPublished(clientId, slotId, parsed.value, key.prefix);
      if (!outcome) return refuse("No such piece for this client.");
      if ("rejected" in outcome) return refuse(outcome.rejected);

      if ("conflict" in outcome) {
        const existing = outcome.slot.publication;
        return refuse(
          "That piece was already published, under a different report" +
            (existing?.external_url ? `: ${existing.external_url}` : "") +
            ". Nothing was changed. If you published it a second time by mistake, tell the operator."
        );
      }

      return say(
        (outcome.replayed
          ? "Already recorded — this is the same report as before, so nothing changed.\n\n"
          : "Recorded as published.\n\n") + renderSlot(projectSlot(outcome.slot))
      );
    }

    case "report_failed": {
      const slotId = str("slot_id");
      const reason = str("reason");
      if (!slotId) return refuse("slot_id is required.");
      if (!reason) return refuse("reason is required — say what went wrong.");

      const slot = await markSlotFailed(clientId, slotId, reason, key.prefix);
      if (!slot) return refuse("No such piece for this client.");

      return say(
        "Noted. The piece stays scheduled and released so it can be retried, and " +
          "an operator will see the reason.\n\n" +
          renderSlot(projectSlot(slot))
      );
    }
  }

  // Unreachable while TOOLS and this switch agree; a refusal rather than a
  // throw so a half-added tool degrades instead of breaking the session.
  return refuse(`Tool ${spec.name} is not implemented.`);
}

/** Exported for the route's 405 body, so the method list has one source. */
export const TOOL_NAMES = TOOLS.map((t) => t.name);

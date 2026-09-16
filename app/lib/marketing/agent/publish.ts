// What happens when an agent says "I published this". Pure.
//
// The whole write-back policy is one function of (slot as it stands, report as
// it arrived). Keeping it pure is what makes the rules testable at all — the
// Firestore side is a transaction that calls in here and does what it is told,
// so "a retry must not post twice" is a unit test rather than something you
// discover from a client's feed.

import { publishable } from "./project";
import type { Publication, Slot } from "../../types";

/** Long enough for any platform id, short enough not to be a payload. */
const MAX_FIELD_CHARS = 256;
const MAX_REASON_CHARS = 1000;

/**
 * How far ahead of us a reported publish time may be.
 *
 * Clock skew between two machines is seconds, not hours. A generous window
 * still catches the mistake this is really for: a unix-millis integer sent
 * where an ISO string was expected, which parses as a date in the year 56000.
 */
const MAX_CLOCK_SKEW_MS = 24 * 60 * 60 * 1000;

export interface PublishReport {
  externalId: string;
  externalUrl: string | null;
  publishedAt: string;
  idempotencyKey: string;
}

export type Parsed<T> = { value: T } | { error: string };

export function parsePublishBody(
  raw: Record<string, unknown>,
  now = new Date()
): Parsed<PublishReport> {
  const externalId = text(raw.external_id);
  if (!externalId) {
    return { error: "external_id is required — the platform's id for the post." };
  }
  if (externalId.length > MAX_FIELD_CHARS) {
    return { error: `Keep external_id under ${MAX_FIELD_CHARS} characters.` };
  }

  const idempotencyKey = text(raw.idempotency_key);
  if (!idempotencyKey) {
    return {
      error:
        "idempotency_key is required — it is what makes a retry safe to send twice.",
    };
  }
  if (idempotencyKey.length > MAX_FIELD_CHARS) {
    return { error: `Keep idempotency_key under ${MAX_FIELD_CHARS} characters.` };
  }

  let externalUrl: string | null = null;
  const rawUrl = text(raw.external_url);
  if (rawUrl) {
    externalUrl = httpUrl(rawUrl);
    if (!externalUrl) {
      return { error: "external_url must be an http or https URL." };
    }
  }

  // Optional, because not every platform hands back a timestamp. Defaulting to
  // now is honest: it is when we were told, and reported_at records that too.
  let publishedAt = now.toISOString();
  const rawAt = text(raw.published_at);
  if (rawAt) {
    const parsed = Date.parse(rawAt);
    if (Number.isNaN(parsed)) {
      return { error: "published_at must be an ISO-8601 instant." };
    }
    if (parsed - now.getTime() > MAX_CLOCK_SKEW_MS) {
      return { error: "published_at is too far in the future to be a real time." };
    }
    publishedAt = new Date(parsed).toISOString();
  }

  return { value: { externalId, externalUrl, publishedAt, idempotencyKey } };
}

export function parseFailedBody(raw: Record<string, unknown>): Parsed<string> {
  const reason = text(raw.reason);
  if (!reason) {
    return { error: "reason is required — say what went wrong." };
  }
  return { value: reason.slice(0, MAX_REASON_CHARS) };
}

export type PublishDecision =
  /** Nothing has been published here. Write it. */
  | { action: "write" }
  /** The same request arrived twice. Answer with what is already stored. */
  | { action: "replay"; publication: Publication }
  /** Something else was published here. Refuse, and say what. */
  | { action: "conflict"; publication: Publication }
  /** This piece was never publishable. */
  | { action: "reject"; reason: string };

/**
 * What to do with an incoming report.
 *
 * The publication check comes FIRST, before the gate. A piece that has already
 * gone out has status "posted", which is not publishable — so asking the gate
 * first would turn every legitimate retry into a rejection, which is exactly
 * the case idempotency exists to handle.
 */
export function publishDecision(slot: Slot, report: PublishReport): PublishDecision {
  const existing = slot.publication;

  if (existing) {
    // The caller's own assertion that this is the same request. Taking it at
    // its word is the point: second-guessing it with a comparison of
    // external_id would answer 409 to a retry the agent cannot recover from.
    return existing.idempotency_key === report.idempotencyKey
      ? { action: "replay", publication: existing }
      : { action: "conflict", publication: existing };
  }

  // Never served as publishable, so a report about it is indistinguishable
  // from someone probing for slot ids. The route answers 404, not 400 — the
  // same reasoning that makes a client from another agency read as missing.
  if (!publishable(slot)) {
    return {
      action: "reject",
      reason:
        "That piece is not released for publishing — it must be confirmed, with copy written from its current brief.",
    };
  }

  return { action: "write" };
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function httpUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

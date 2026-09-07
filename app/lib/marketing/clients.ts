// Server-only Firestore access for clients. Never import from a client component.
import { db, COLLECTIONS, FieldValue, serializeClient } from "../firestore";
import type { Session } from "../auth";

export interface ClientWrite {
  name: string;
  website_url: string | null;
  logo_url: string | null;
  description: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  timezone: string;
  branding: Record<string, unknown> | null;
}

const FIELD_MAP: Record<string, string> = {
  name: "name",
  website_url: "websiteUrl",
  logo_url: "logoUrl",
  description: "description",
  contact_email: "contactEmail",
  contact_phone: "contactPhone",
  timezone: "timezone",
  branding: "branding",
  status: "status",
};

const STATUSES = ["active", "paused", "archived"];

function optionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

// Rejects an obviously invalid IANA zone. Intl throws on an unknown zone, which
// is the cheapest correct check available without pulling in a zone list.
function isValidTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export function parseClientCreate(
  body: unknown
): { data: ClientWrite } | { error: string } {
  const b = (body ?? {}) as Record<string, unknown>;

  const name = typeof b.name === "string" ? b.name.trim() : "";
  if (!name) return { error: "Name is required." };

  const timezone =
    typeof b.timezone === "string" && b.timezone.trim() ? b.timezone.trim() : "UTC";
  if (!isValidTimezone(timezone)) {
    return { error: `"${timezone}" is not a valid IANA timezone.` };
  }

  return {
    data: {
      name,
      website_url: optionalString(b.website_url),
      logo_url: optionalString(b.logo_url),
      description: optionalString(b.description),
      contact_email: optionalString(b.contact_email),
      contact_phone: optionalString(b.contact_phone),
      timezone,
      // The Python schema accepted branding on create and silently dropped it.
      branding:
        b.branding && typeof b.branding === "object"
          ? (b.branding as Record<string, unknown>)
          : null,
    },
  };
}

// Partial update. Unlike the Python (which used exclude_none=True and so could
// never clear a field), an explicit null clears; only an ABSENT key is skipped.
export function parseClientPatch(
  body: unknown
): { data: Record<string, unknown> } | { error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const update: Record<string, unknown> = {};

  for (const [apiField, docField] of Object.entries(FIELD_MAP)) {
    if (!(apiField in b)) continue;
    const value = b[apiField];

    if (apiField === "name") {
      const name = typeof value === "string" ? value.trim() : "";
      if (!name) return { error: "Name cannot be empty." };
      update[docField] = name;
    } else if (apiField === "status") {
      if (typeof value !== "string" || !STATUSES.includes(value)) {
        return { error: `Status must be one of: ${STATUSES.join(", ")}.` };
      }
      update[docField] = value;
    } else if (apiField === "timezone") {
      const tz = typeof value === "string" ? value.trim() : "";
      if (!tz || !isValidTimezone(tz)) {
        return { error: `"${String(value)}" is not a valid IANA timezone.` };
      }
      update[docField] = tz;
    } else if (apiField === "branding") {
      update[docField] =
        value && typeof value === "object" ? value : null;
    } else {
      update[docField] = optionalString(value);
    }
  }

  if (Object.keys(update).length === 0) {
    return { error: "No recognised fields to update." };
  }
  return { data: update };
}

export async function listClients(
  session: Session,
  opts: { status?: string; search?: string } = {}
) {
  const snap = await db()
    .collection(COLLECTIONS.clients)
    .where("agencyId", "==", session.agencyId)
    .get();

  let rows = snap.docs.map((doc) => serializeClient(doc.id, doc.data()));

  if (opts.status) {
    rows = rows.filter((r) => r.status === opts.status);
  }
  // Firestore has no substring match (the Python used SQL ILIKE). Filtering in
  // memory matches the house pattern and is fine at agency scale.
  if (opts.search) {
    const needle = opts.search.toLowerCase();
    rows = rows.filter((r) => r.name.toLowerCase().includes(needle));
  }

  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

export async function createClient(session: Session, data: ClientWrite) {
  const ref = db().collection(COLLECTIONS.clients).doc();
  await ref.set({
    agencyId: session.agencyId,
    name: data.name,
    websiteUrl: data.website_url,
    logoUrl: data.logo_url,
    description: data.description,
    contactEmail: data.contact_email,
    contactPhone: data.contact_phone,
    timezone: data.timezone,
    branding: data.branding,
    status: "active",
    researchStatus: null,
    research: null,
    googleCalendarId: null,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  const snap = await ref.get();
  return serializeClient(ref.id, snap.data() ?? {});
}

export async function updateClient(clientId: string, update: Record<string, unknown>) {
  const ref = db().collection(COLLECTIONS.clients).doc(clientId);
  await ref.set({ ...update, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  const snap = await ref.get();
  return serializeClient(ref.id, snap.data() ?? {});
}

// Soft delete. The Python hard-cascaded across six tables in one transaction;
// in Firestore that is neither atomic nor reversible, and lib/api.ts already
// types the response as { archived: boolean }.
export async function archiveClient(clientId: string) {
  await db()
    .collection(COLLECTIONS.clients)
    .doc(clientId)
    .set({ status: "archived", updatedAt: FieldValue.serverTimestamp() }, { merge: true });
}

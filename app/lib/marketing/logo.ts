/**
 * Logo upload rules: what counts as an image, where it is stored, and how its
 * URL is built. Pure — no network, no Firebase — so every decision here is
 * covered by offline tests and the route above it is only plumbing.
 *
 * Ported from ~/Projects/numerico/notifications/lib/logo.ts, which solved this
 * first. One substantive change: objects are keyed by CLIENT rather than by
 * user, because a logo here belongs to an agency's client, not to the person
 * who happened to upload it.
 */

export type LogoType = "image/png" | "image/jpeg" | "image/gif" | "image/webp";

/** A logo does not need more, and Vercel caps a request body at ~4.5 MB regardless. */
export const MAX_LOGO_BYTES = 1024 * 1024;

const EXTENSIONS: Record<LogoType, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

export function extensionFor(type: LogoType): string {
  return EXTENSIONS[type];
}

/** Human-readable list for error messages, so the UI and the API agree. */
export const ALLOWED_LOGO_LABEL = "PNG, JPEG, GIF or WebP";

function startsWith(bytes: Uint8Array, signature: number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((byte, index) => bytes[offset + index] === byte);
}

/**
 * Identify the image from its own bytes.
 *
 * The browser-supplied content-type is not evidence of anything — it is
 * trivially set to "image/png" on an HTML file. That matters more than usual
 * here because the stored object ends up fetchable on a googleapis.com URL, and
 * serving attacker-supplied HTML from a trusted-looking host is the classic
 * stored-XSS-by-upload path. The sniffed type also decides the stored
 * extension, so a mislabelled file cannot land wearing a misleading one.
 *
 * SVG is deliberately absent: it is a real image format, but it can carry
 * script, and a brand mark gets embedded in contexts we do not control.
 */
export function sniffImageType(bytes: Uint8Array): LogoType | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return "image/gif";
  // RIFF....WEBP — the four size bytes between the two markers are skipped.
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) {
    return "image/webp";
  }
  return null;
}

const PREFIX = "marketing/clients";

/** Everything one client owns lives under this prefix, and nothing else may. */
export function clientPrefix(clientId: string): string {
  return `${PREFIX}/${clientId}/`;
}

/**
 * A fresh random name every time, so replacing a logo yields a NEW url.
 *
 * Image proxies and browsers cache aggressively, and the object is stored
 * immutable; reusing the path would leave everyone looking at the previous
 * logo indefinitely.
 */
export function storagePathFor(clientId: string, extension: string): string {
  return `${clientPrefix(clientId)}${crypto.randomUUID()}.${extension}`;
}

const FIREBASE_STORAGE_HOST = "firebasestorage.googleapis.com";

/**
 * The download URL for an object, in the same form the Firebase client SDK's
 * getDownloadURL() returns.
 *
 * Deliberately NOT file.makePublic(): that sets a per-object ACL, and uniform
 * bucket-level access — the default on new buckets — disables object ACLs
 * outright, so it fails with a 400. A download token goes through the Firebase
 * Storage service instead of GCS IAM, so it works either way with no bucket
 * permission changes and never expires.
 *
 * Knowing the URL is what grants access. That is the right model for a brand
 * mark an external publisher fetches unauthenticated — and it is what keeps
 * GET /api/agent/v1/logo's bare 302 working, since that forwards no credentials.
 */
export function downloadUrlFor(bucket: string, path: string, token: string): string {
  return `https://${FIREBASE_STORAGE_HOST}/v0/b/${bucket}/o/${encodeURIComponent(path)}?alt=media&token=${token}`;
}

/**
 * Recover the object path from a stored URL, so replacing a logo can delete the
 * old object rather than orphaning it.
 *
 * Returns null unless the path sits under this client's own prefix. A value
 * read back out of Firestore must never be able to make us delete another
 * client's object — even though only our own upload route can write that field
 * today, and even though the field used to accept anything an operator typed.
 */
export function objectPathFromUrl(
  url: string | null | undefined,
  clientId: string
): string | null {
  if (!url) return null;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" || parsed.hostname !== FIREBASE_STORAGE_HOST) return null;

  const match = parsed.pathname.match(/^\/v0\/b\/[^/]+\/o\/(.+)$/);
  if (!match) return null;

  let path: string;
  try {
    path = decodeURIComponent(match[1]);
  } catch {
    return null;
  }

  // No traversal, and inside this client's own prefix.
  if (path.includes("..")) return null;
  return path.startsWith(clientPrefix(clientId)) ? path : null;
}

import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getAdminBucket, storageBucketName } from "@/lib/firebase-admin";
import { updateClient } from "@/lib/marketing/clients";
import {
  ALLOWED_LOGO_LABEL,
  MAX_LOGO_BYTES,
  downloadUrlFor,
  extensionFor,
  objectPathFromUrl,
  sniffImageType,
  storagePathFor,
} from "@/lib/marketing/logo";
import {
  requireClient,
  jsonError,
  serverError,
} from "@/lib/marketing/route-helpers";

type Params = { params: Promise<{ clientId: string }> };

/**
 * The only way logo_url can be set. `logo_url` was removed from FIELD_MAP, so
 * PATCH /clients/[clientId] no longer accepts it and the field cannot hold an
 * arbitrary string.
 *
 * That matters here more than in a normal app: GET /api/agent/v1/logo answers a
 * bare 302 with whatever this field holds, so an operator-typed value was a
 * redirect to any host they cared to name.
 *
 * Validation order matters — size before sniffing, so a huge file is rejected
 * without being read into a buffer, and the sniffed bytes (never the client's
 * declared content-type) decide both acceptance and the stored extension.
 */

/**
 * Best effort. An orphaned object costs a fraction of a cent; failing an
 * operator's upload because the previous file could not be removed would be the
 * wrong trade.
 */
async function deleteIfOurs(url: unknown, clientId: string): Promise<void> {
  const path = objectPathFromUrl(typeof url === "string" ? url : null, clientId);
  if (!path) return;
  try {
    await getAdminBucket().file(path).delete({ ignoreNotFound: true });
  } catch (error) {
    console.warn(`Could not delete previous logo ${path}`, error);
  }
}

// POST /api/v1/clients/[clientId]/logo — multipart, field name "file".
export async function POST(request: Request, { params }: Params) {
  try {
    const { clientId } = await params;
    const ctx = await requireClient(clientId);
    if ("response" in ctx) return ctx.response;

    let file: File | null = null;
    try {
      const form = await request.formData();
      const value = form.get("file");
      if (value instanceof File) file = value;
    } catch {
      return jsonError("Expected a multipart form upload.", 400);
    }
    if (!file) return jsonError("No file was uploaded.", 400);

    if (file.size > MAX_LOGO_BYTES) {
      return jsonError(
        `That file is ${Math.round(file.size / 1024)} KB. Logos must be 1 MB or smaller.`,
        413
      );
    }

    const bytes = new Uint8Array(await file.arrayBuffer());

    // The client's content-type is not evidence. Only the bytes are.
    const type = sniffImageType(bytes);
    if (!type) {
      return jsonError(`That file is not a ${ALLOWED_LOGO_LABEL} image.`, 415);
    }

    const previous = ctx.client.data.logoUrl;
    const path = storagePathFor(clientId, extensionFor(type));
    const token = randomUUID();

    try {
      await getAdminBucket()
        .file(path)
        .save(Buffer.from(bytes), {
          contentType: type,
          metadata: {
            // Immutable is safe because storagePathFor never reuses a path.
            cacheControl: "public, max-age=31536000, immutable",
            // What makes the object readable WITHOUT a per-object ACL, which
            // uniform bucket-level access would refuse. See lib/marketing/logo.ts.
            metadata: { firebaseStorageDownloadTokens: token },
          },
        });
    } catch (error) {
      console.error("Logo upload failed", error);
      // The misconfiguration message names its own variable, so surface it.
      if (error instanceof Error && error.message.includes("not configured")) {
        return jsonError(error.message, 503);
      }
      return jsonError(
        "Could not store the logo. Check that Firebase Storage is enabled for this project.",
        502
      );
    }

    const logoUrl = downloadUrlFor(storageBucketName(), path, token);
    const client = await updateClient(clientId, { logoUrl });

    // Only after the new one is safely recorded.
    await deleteIfOurs(previous, clientId);

    return NextResponse.json(client);
  } catch (error) {
    return serverError("Upload logo error", error);
  }
}

/**
 * DELETE /api/v1/clients/[clientId]/logo — clear it.
 *
 * Necessary because the URL text field is gone: without this there would be no
 * way to remove a logo at all.
 */
export async function DELETE(_request: Request, { params }: Params) {
  try {
    const { clientId } = await params;
    const ctx = await requireClient(clientId);
    if ("response" in ctx) return ctx.response;

    const previous = ctx.client.data.logoUrl;
    const client = await updateClient(clientId, { logoUrl: null });
    await deleteIfOurs(previous, clientId);

    return NextResponse.json(client);
  } catch (error) {
    return serverError("Remove logo error", error);
  }
}

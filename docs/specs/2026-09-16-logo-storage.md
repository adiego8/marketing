# Logo upload

*2026-09-16. Reverses the "File upload for logos — URL field only" non-goal in
`2026-04-14-multi-tenant-design.md`.*

## Why

`logo_url` was a text box an operator pasted a URL into, and nothing validated it
beyond a trim. Two things made that worth fixing once the agent API existed:

- `GET /api/agent/v1/logo` answers a **bare 302** with whatever the field holds.
  An operator-typed value was therefore a redirect from our domain to any host
  they cared to name, which `safeLogoUrl` had to keep defending forever.
- A client's logo is the one brand asset an external publisher genuinely needs,
  so it should live somewhere we control rather than on someone else's CDN.

## The shape

```
POST   /api/v1/clients/{clientId}/logo    multipart, field "file"
DELETE /api/v1/clients/{clientId}/logo    clears it and removes the object
```

Session-authed, behind `requireClient`. Objects live at
`marketing/clients/{clientId}/{uuid}.{ext}`.

**Upload is now the only writer.** `logo_url` was removed from `FIELD_MAP` in
`lib/marketing/clients.ts`, so `parseClientPatch` and `parseClientCreate` no
longer accept it, and the Branding page's URL input is gone. The field can only
ever hold a URL this route wrote. That is the whole point of the change.

## Decisions worth the ink

**Ported, not invented.** `~/Projects/numerico/notifications` solved this first —
`lib/logo.ts` and `app/api/branding/logo/route.ts`. Same stack, same conclusions.
The one substantive change is that objects are keyed by **client** rather than by
user, because a logo here belongs to an agency's client, not to whoever uploaded
it.

**A download token, not `makePublic()`.** `makePublic()` sets a per-object ACL,
and uniform bucket-level access — the default on new Firebase buckets — disables
object ACLs outright, so it fails at runtime with a 400. Nothing in
`@google-cloud/storage`'s types anticipates this. A
`firebaseStorageDownloadTokens` metadata entry gives
`https://firebasestorage.googleapis.com/v0/b/{bucket}/o/{path}?alt=media&token={uuid}`
— permanent, unguessable, routed through the Firebase Storage service rather
than GCS IAM, needing no bucket configuration. Signed URLs were rejected: V4
signing caps at seven days, and a logo that expires is a broken logo. It would
also break the agent API's 302, which forwards no credentials.

Note `getDownloadURL()` from `firebase-admin/storage` **reads** an existing token
and throws when there is none — it cannot mint one. The route sets the token
itself.

**The bytes decide, never the declared type.** A browser's `Content-Type` is
trivially `image/png` on an HTML file, and the stored object ends up fetchable
from a googleapis.com URL — serving attacker-supplied HTML from a trusted-looking
host is the classic stored-XSS-by-upload path. `sniffImageType` reads magic
bytes, and the sniffed type also picks the stored extension so a mislabelled file
cannot land wearing a misleading one.

**SVG is refused.** A real image format, but it can carry script and a brand mark
gets embedded where we do not control the context. PNG, JPEG, GIF, WebP only;
1 MB cap, matching the sibling so both apps' error copy agrees.

**A new random filename every upload**, with `cacheControl: immutable`. Reusing
the path would leave every browser and image proxy serving the previous logo
indefinitely.

**`objectPathFromUrl` refuses anything outside the client's own prefix**, so a
value read back out of Firestore can never aim a delete at another client's
object — which matters precisely because that field used to accept arbitrary
strings. Deletion is best effort and happens only *after* the new URL is
recorded: an orphaned object costs a fraction of a cent, and failing an
operator's upload because the old file would not delete is the wrong trade.

**No new environment variable.** `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` already
existed in `.env.example` and was simply empty. It is read server-side despite
the prefix — a bucket name is not a secret, and a second copy would be one more
thing to forget on deploy. `@google-cloud/storage` is now a declared dependency:
it was present only as an *optional* dep of `firebase-admin`, which `require()`s
it at runtime, and a dependency we rely on should not be one `npm install` away
from vanishing.

## Known holes

- **Archiving a client does not delete its objects.** Archiving is a soft delete
  and nothing else cascades either, so this is consistent rather than special —
  but the storage bill grows monotonically.
- **No resizing or format conversion.** A 1 MB PNG is served as a 1 MB PNG.
- **No `storage.rules` file.** Nothing client-side touches the bucket; all access
  is through the Admin SDK, and the download token is what grants read.
- **Per-slot media still does not exist.** This makes the storage pattern real,
  but an Instagram carousel still cannot be published from words alone. That is
  the next project, and the bigger one.

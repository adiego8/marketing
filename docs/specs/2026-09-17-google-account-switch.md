# One Google account per agency, enforced

2026-09-17

## The bug

Syncing a client failed with `Could not read the calendar (Not Found)`, a
`Not Found` per slot, and `0 events written · 4 failed`.

The Google grant is stored per agency (`googleCredentials/{agencyId}`). The
calendar id is stored per client (`googleCalendarId`). Nothing kept the two
consistent: across the whole repo `googleCalendarId` was written in three
places — `null` at client creation, `null` in the seed, and once in
`ensureClientCalendar` — and **never cleared or re-validated**.

`ensureClientCalendar` returns a stored id without checking it and only creates
a calendar when the field is empty, which it never became again. So once the
connected account changed, every client pointed at a calendar the new account
could not see, and every call 404'd: the `events.list` feeding reconcile, then
each `events.patch`/`insert` in the push loop.

Two things let the switch happen unnoticed:

- `saveGoogleCredentials` merges, overwriting the stored `email` silently.
- `authUrl` sent `prompt: "consent"`, which shows the permissions screen but
  **not** the account chooser — so "Reconnect" re-consents as whoever is already
  signed in, and an intended account switch silently reconnects the same
  account.

## The shape of the fix

**Disconnect forgets.** `disconnect()` now calls `clearAgencyGoogleState` before
deleting the credential — every client's `googleCalendarId`, and every slot's
`googleEventId` and friends. Clearing runs *first*: a half-failed clear leaves
the agency connected, so a retry is a plain retry, whereas losing the token
first would strand the ids with no path back.

Nothing is deleted from Google. The calendars and events stay in the account
that owns them; we drop our pointers at them.

**Connecting a different account is refused.** `decideConnect` is a pure
function in `google.ts`, checked in the OAuth callback. It cannot live in
`/google/start` — the account is unknown until `exchangeCode` reads the email
out of the `id_token`, so the refusal necessarily lands after the user has
cleared Google's consent screen. On refusal the just-issued refresh token is
revoked and the callback redirects with `google=account-mismatch`.

Reconnecting the **same** account stays allowed, and that is load-bearing, not a
convenience: it is the only cure for a grant predating the calendar scope, which
`getConnectionStatus` reports as `needsReconnect`. An email we do not have on
either side allows — a mismatch we cannot prove is not a mismatch.

**`select_account` was added** to the consent prompt. Without it the reconnect
after a disconnect silently grabs the still-signed-in session, and switching
accounts remains impossible even with a working Disconnect.

**Settings gained the Disconnect button** — which did not exist anywhere.
`disconnectGoogle()` had been in `lib/api.ts` with zero callers, so building the
gate without building the door would have locked the app onto one account
permanently. `/google/status` now returns `linked_clients` so the confirmation
can name a true number rather than threatening "every client".

**A missing calendar is one warning, not twenty errors.** `syncSlots` reads the
error `code` from the listing; a 404 means the calendar itself is gone, so it
sets `calendarMissing`, says so once, and returns without attempting writes that
would all 404. `POST /clients/{id}/calendar/reset` is the cure, surfaced as a
**Reset calendar** button beside the warning.

Explicit rather than a silent self-heal: a 404 can also be a scope problem or a
transient failure, and abandoning a calendar full of events on that evidence is
not a decision to make on the user's behalf.

## Decisions

- **Events in the old account are left alone.** They remain the client's record,
  and the old calendar stays openable.
- **The reset is per client**, not agency-wide — a hand-deleted calendar is one
  client's problem.
- **`"pending"`, not `"removed"`,** for a reset slot: "removed" would claim we
  deleted the event from Google, which is exactly what this does not do.
- **`googleEventLocked` is released.** The lock says "a human edited *this*
  event"; carried onto a fresh event it would suppress the first title written.

## What this does not do

- Delete our events from the old account's calendars.
- Per-client Google accounts — the grant stays one per agency; this enforces it.
- Log past account switches. Nothing recorded them.
- Change reconcile's judgements, which were already right here: refusing to read
  "absent" as "deleted" is what stopped this bug from cancelling entire
  schedules.

## Notes

`?google=` result codes had been read on the schedule page only. The campaign
workspace passed its own path as `returnTo` and never read the result, so a
failed connection there reported nothing at all. The map and reader moved to
`lib/google-result.ts`; schedule, campaigns and settings all use it.

/**
 * Google Calendar URLs, split out of calendar.ts so the browser can build them.
 *
 * calendar.ts imports googleapis and firebase-admin; a "use client" page that
 * imported these from there would drag both into the browser bundle. They are
 * pure string builders with no dependencies, so they live on their own.
 */

export function calendarEmbedUrl(calendarId: string, timezone = "UTC"): string {
  return (
    `https://calendar.google.com/calendar/embed?src=${encodeURIComponent(calendarId)}` +
    `&ctz=${encodeURIComponent(timezone)}&mode=WEEK`
  );
}

export function calendarOpenUrl(calendarId: string): string {
  return `https://calendar.google.com/calendar/u/0/r?cid=${encodeURIComponent(calendarId)}`;
}

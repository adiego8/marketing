/**
 * Numerico's visual vocabulary, as class strings.
 *
 * numerico-website has no component library at all — no shadcn, no Radix, no
 * cva. Its design system is Tailwind utility strings repeated inline, and its
 * consistency comes from copy-paste discipline. This file is the same idea with
 * the copy-paste taken out: plain strings, no wrappers, no variant machinery,
 * greppable, and overridable by appending classes at the call site.
 *
 * Palette is Numerico's throughout — stone-50 ground, white surfaces, slate
 * ink, slate-200 borders. The accent is teal rather than the website's amber,
 * so this reads as a sibling product and amber stays free to mean "degraded".
 */

/* ----------------------------------------------------------------- fields -- */

/**
 * What is left of the form tokens after Input / Textarea / Select took over.
 *
 * `micro` stays because it still has ten callers that are NOT field labels —
 * `<p>`, `<span>` and `<legend>` naming a group of controls or a section. Those
 * want the treatment without wanting a control attached to it.
 *
 * `label`, `input`, `inputSm`, `textarea` and `select` are gone: they carried
 * three mismatched heights and a `focus:outline-none` that suppressed the app's
 * only focus indicator. `label` had zero callers even before that.
 */
export const field = {
  /** Micro-label naming a group of controls, or a section inside a form. */
  micro: "block text-xs uppercase tracking-wide text-slate-500 mb-1.5",
  /**
   * A file input. The native button cannot be styled, so ::file-selector-button
   * is restyled rather than left looking like 1998. Not worth a component for
   * one call site, and a file input's geometry is its own anyway.
   */
  file:
    "block w-full text-sm text-slate-600 file:mr-3 file:inline-flex file:items-center " +
    "file:px-3 file:py-1.5 file:border file:border-slate-300 file:rounded-lg " +
    "file:text-xs file:font-semibold file:text-slate-700 file:bg-white " +
    "file:hover:border-slate-400 file:cursor-pointer file:transition-colors",
};

/* --------------------------------------------------------------- surfaces -- */

export const surface = {
  card: "rounded-xl bg-white border border-slate-200 shadow-sm",
  /** Cards hover by taking an accent border, never by lifting. */
  cardHover:
    "rounded-xl bg-white border border-slate-200 shadow-sm transition-all hover:border-teal-600 hover:shadow-md",
  /** Body padding for a card. Kept separate so headers can sit flush. */
  pad: "p-5 sm:p-6",
  padSm: "p-4",
  /** A stat tile: smaller, quieter, no shadow. */
  tile: "rounded-xl border border-slate-200 bg-white p-4",
  /** Numerico's empty state. `border-dashed` appears nowhere else. */
  empty:
    "rounded-xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center",
  /** A list of rows, the website's preferred alternative to a table. */
  list: "divide-y divide-slate-200 border border-slate-200 rounded-xl bg-white overflow-hidden",
  /** Wrapper for a real <table>. */
  table: "rounded-xl border border-slate-200 bg-white overflow-hidden",
  /** An inset panel inside a card — raw JSON, previews, references. */
  inset: "rounded-lg bg-stone-50 border border-slate-200 p-3",
};

/* ------------------------------------------------------------------- text -- */

export const text = {
  h1: "text-2xl sm:text-3xl text-slate-900",
  h2: "text-xl sm:text-2xl text-slate-900",
  h3: "text-base sm:text-lg text-slate-800",
  /** Card and section titles. */
  cardTitle: "text-sm font-semibold text-slate-900",
  /** Accent eyebrow. teal-700 rather than 600: this is small text. */
  eyebrow: "text-xs uppercase tracking-widest text-teal-700",
  /** Neutral section label. */
  label: "text-xs uppercase tracking-widest text-slate-500",
  muted: "text-sm text-slate-500",
  micro: "text-xs text-slate-500",
  mono: "font-mono text-xs text-slate-500",
  /** A count in a summary strip. Tabular so columns of figures line up. */
  stat: "text-2xl text-slate-900 tabular-nums",
};

/* ---------------------------------------------------------------- banners -- */

export const banner = {
  error:
    "rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600",
  warn: "rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700",
  info: "rounded-lg border border-teal-200 bg-teal-50 px-4 py-3 text-sm text-teal-700",
};

/* ------------------------------------------------------------------ table -- */

export const table = {
  head: "text-xs uppercase tracking-wide text-slate-500 text-left font-medium px-4 py-2.5",
  row: "border-t border-slate-100 hover:bg-stone-50 transition-colors",
  cell: "px-4 py-3 text-sm text-slate-800",
  cellMuted: "px-4 py-3 text-sm text-slate-500",
};

/* ------------------------------------------------------------------ pager -- */

/**
 * Previous / next through a list, as one control.
 *
 * This was two separate outline buttons reading "‹ Previous" and "Next ›" with
 * a loose "3 of 8" floating between them — three elements that belong together
 * and did not look it. A segmented frame with the position inside reads as the
 * single control it is, and takes about half the width.
 */
/**
 * Back up one level.
 *
 * The chevron is a sibling element rather than a "←" baked into the label, so
 * the icon matches the pager beside it and the label stays plain text that can
 * be a campaign's name.
 */
export const backLink =
  "inline-flex items-center gap-1 text-sm text-slate-500 hover:text-teal-700 transition-colors";

export const pager = {
  frame:
    "inline-flex items-stretch rounded-lg border border-slate-200 bg-white overflow-hidden divide-x divide-slate-200 shrink-0",
  step:
    "px-2.5 flex items-center text-slate-500 transition-colors hover:bg-stone-50 hover:text-slate-800 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-white disabled:hover:text-slate-500",
  count:
    "px-3 py-1.5 flex items-center text-xs text-slate-500 tabular-nums select-none",
};

/* ------------------------------------------------------------------ piece -- */

/**
 * A written piece — theme, hook, beats, ask.
 *
 * Deliberately not a table row. A piece is five fields of prose of wildly
 * different lengths; squeezing them into one `<td>` is why the plan was
 * unreadable. The card gives each field its own line and lets the beats be an
 * actual list.
 */
export const piece = {
  card: "rounded-xl border border-slate-200 bg-white p-4 transition-colors hover:border-slate-300",
  /** Dropped, or otherwise out of the plan. */
  cardMuted: "rounded-xl border border-slate-200 bg-stone-50/70 p-4",
  meta: "flex items-center gap-2 mb-2",
  theme: "font-semibold text-slate-900 leading-snug",
  hook: "text-sm text-slate-700 mt-1.5",
  beats: "text-sm text-slate-600 mt-2 space-y-1 list-decimal ml-4 marker:text-slate-300",
  cta: "text-sm text-teal-700 mt-2 font-medium",
  rationale: "text-xs text-slate-500 mt-2",
};

/* ------------------------------------------------------------------ shell -- */

export const shell = {
  /** Page container inside the client shell's <main>. */
  page: "max-w-5xl",
  /** Header block above a page's content. */
  header: "flex items-start justify-between gap-4 mb-8",
};

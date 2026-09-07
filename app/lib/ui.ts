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

/* ---------------------------------------------------------------- buttons -- */

export const btn = {
  /** Solid accent. The one primary action on a screen. */
  primary:
    "inline-flex items-center justify-center px-6 py-3 bg-teal-600 text-white rounded-lg hover:bg-teal-500 transition-all font-semibold disabled:opacity-50 disabled:cursor-not-allowed",
  primarySm:
    "inline-flex items-center justify-center px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-500 transition-all text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed",
  /** Slate fill. Secondary weight without competing with the accent. */
  dark: "inline-flex items-center justify-center px-6 py-3 bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-all font-semibold disabled:opacity-50 disabled:cursor-not-allowed",
  darkSm:
    "inline-flex items-center justify-center px-4 py-2 bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-all text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed",
  outline:
    "inline-flex items-center justify-center px-5 py-2.5 border border-slate-300 text-slate-700 rounded-lg hover:border-slate-400 transition-all text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed",
  outlineSm:
    "inline-flex items-center justify-center px-3 py-1.5 border border-slate-300 text-slate-700 rounded-lg hover:border-slate-400 transition-all text-xs font-semibold disabled:opacity-50 disabled:cursor-not-allowed",
  ghost:
    "inline-flex items-center justify-center px-3 py-1.5 text-slate-500 rounded-lg hover:bg-stone-50 hover:text-slate-700 transition-colors text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed",
  danger:
    "inline-flex items-center justify-center px-4 py-2 border border-red-200 text-red-600 rounded-lg hover:bg-red-50 transition-all text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed",
  /** Text-only, for back links and sign out. */
  link: "text-sm text-slate-500 hover:text-teal-700 transition-colors",
};

/**
 * Segmented toggle, for choices rendered as a row of buttons (the plan
 * horizon, the quota's channel picker). Selected reads as a filled accent.
 */
export function toggle(selected: boolean) {
  return selected
    ? "px-3 py-1.5 rounded-lg text-sm font-semibold bg-teal-600 text-white transition-all"
    : "px-3 py-1.5 rounded-lg text-sm font-semibold border border-slate-300 text-slate-700 hover:border-slate-400 transition-all";
}

/* ----------------------------------------------------------------- fields -- */

export const field = {
  label: "block text-sm text-slate-700 mb-2",
  /** Micro-label above a field inside a dense form. */
  micro: "block text-xs uppercase tracking-wide text-slate-400 mb-1.5",
  input:
    "w-full bg-white border border-slate-200 rounded-lg px-4 py-3 text-slate-800 placeholder-slate-400 focus:outline-none focus:border-teal-600 transition-colors text-sm",
  inputSm:
    "w-full bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:border-teal-600 transition-colors",
  textarea:
    "w-full bg-white border border-slate-200 rounded-lg px-4 py-3 text-slate-800 placeholder-slate-400 focus:outline-none focus:border-teal-600 transition-colors text-sm resize-y",
  select:
    "bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 focus:outline-none focus:border-teal-600 transition-colors",
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
  label: "text-xs uppercase tracking-widest text-slate-400",
  muted: "text-sm text-slate-500",
  micro: "text-xs text-slate-400",
  mono: "font-mono text-xs text-slate-500",
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
  head: "text-xs uppercase tracking-wide text-slate-400 text-left font-medium px-4 py-2.5",
  row: "border-t border-slate-100 hover:bg-stone-50 transition-colors",
  cell: "px-4 py-3 text-sm text-slate-800",
  cellMuted: "px-4 py-3 text-sm text-slate-500",
};

/* ------------------------------------------------------------------ shell -- */

export const shell = {
  /** Page container inside the client shell's <main>. */
  page: "max-w-5xl",
  /** Header block above a page's content. */
  header: "flex items-start justify-between gap-4 mb-8",
};

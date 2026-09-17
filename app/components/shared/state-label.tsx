import type { ReactNode } from "react";

/**
 * A read-only state word under a piece: sync health, copy readiness.
 *
 * These used to stack inside the Schedule table's Status cell alongside a pill,
 * a select, a link and a button — nine controls under one column header. They
 * are the same words; they just have room now.
 *
 * Lifted out of the schedule page when the campaign workspace needed the same
 * "copy ready" / "copy is older than the brief" line. Two surfaces stating a
 * piece's readiness in two different vocabularies would be worse than either.
 */
export function StateLabel({
  tone,
  title,
  children,
}: {
  tone: "good" | "warn" | "bad" | "muted";
  title?: string;
  children: ReactNode;
}) {
  const color = {
    good: "text-teal-700",
    warn: "text-amber-700",
    bad: "text-red-700",
    muted: "text-slate-400",
  }[tone];
  return (
    <span className={`text-[11px] uppercase tracking-wide ${color}`} title={title}>
      {children}
    </span>
  );
}

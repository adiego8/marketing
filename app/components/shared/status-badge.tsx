import { statusPill, statusLabel } from "@/lib/ui-status";

/**
 * Thin wrapper over the shared status vocabulary in lib/ui-status.ts, kept
 * because several pages render a status without caring how it is coloured.
 */
export function StatusBadge({ status }: { status: string }) {
  return <span className={statusPill(status)}>{statusLabel(status)}</span>;
}

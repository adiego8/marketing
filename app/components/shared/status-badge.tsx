import { Badge } from "@/components/ui/badge";

const STATUS_STYLES: Record<string, string> = {
  running: "bg-blue-100 text-blue-800",
  completed: "bg-green-100 text-green-800",
  failed: "bg-red-100 text-red-800",
  // Plan run statuses.
  proposed: "bg-blue-100 text-blue-800",
  committed: "bg-green-100 text-green-800",
  degraded: "bg-amber-100 text-amber-800",
  noop: "bg-zinc-100 text-zinc-700",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <Badge variant="outline" className={STATUS_STYLES[status] || ""}>
      {status}
    </Badge>
  );
}

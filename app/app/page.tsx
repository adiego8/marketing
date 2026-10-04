"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { listClients, createClient, deleteClient } from "@/lib/api";
import { AppShell } from "@/components/layout/app-shell";
import { PageHeader } from "@/components/layout/page-header";
import { banner, surface, table } from "@/lib/ui";
import { statusPill } from "@/lib/ui-status";
import type { ClientListItem } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { TableSkeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useConfirm } from "@/components/ui/confirm-provider";

export default function ClientListPage() {
  const confirm = useConfirm();
  const router = useRouter();
  const [clients, setClients] = useState<ClientListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("active");
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);

  // Create form
  const [newName, setNewName] = useState("");
  const [newWebsite, setNewWebsite] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newDescription, setNewDescription] = useState("");
  // Defaults to the browser's zone: whoever creates the client is usually in,
  // or near, the market it posts to. Every scheduling decision uses this.
  const [newTimezone, setNewTimezone] = useState(
    Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
  );

  const fetchClients = async () => {
    try {
      const params: Record<string, string > = {};
      if (statusFilter) params.status = statusFilter;
      if (search) params.search = search;
      const data = await listClients(params);
      setClients(data);
      setError(null);
    } catch (e) {
      // Rendered, not just logged: an empty list and a failed request look
      // identical otherwise, which is exactly when you need to tell them apart.
      setError(e instanceof Error ? e.message : "Could not load clients");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchClients();
  }, [statusFilter]);

  useEffect(() => {
    const timeout = setTimeout(fetchClients, 300);
    return () => clearTimeout(timeout);
  }, [search]);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    setCreateError(null);
    try {
      const client = await createClient({
        name: newName,
        website_url: newWebsite || undefined,
        contact_email: newEmail || undefined,
        contact_phone: newPhone || undefined,
        description: newDescription || undefined,
        timezone: newTimezone || undefined,
      });
      setShowCreate(false);
      setNewName("");
      setNewWebsite("");
      setNewEmail("");
      setNewPhone("");
      setNewDescription("");
      router.push(`/clients/${client.id}`);
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : "Could not create client");
    } finally {
      setCreating(false);
    }
  };

  return (
    <AppShell>
      <div className="max-w-5xl">
        {/* The lockup, the email and the Settings / Sign out links used to sit
            in a bar of their own here. The rail carries all three now. */}
        <PageHeader
          title="Clients"
          description="Everyone you plan and schedule content for."
          actions={
            <Button variant="primary" size="md" onClick={() => setShowCreate(true)}>
              Add client
            </Button>
          }
        />

        <Dialog open={showCreate} onOpenChange={setShowCreate}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New client</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <div>
                <Input
                  label="Name *"
                  size="md"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Company name"
                />
              </div>
              <div>
                <Input
                  label="Website"
                  size="md"
                  value={newWebsite}
                  onChange={(e) => setNewWebsite(e.target.value)}
                  placeholder="https://…"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Input
                    label="Email"
                    size="md"
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    placeholder="contact@…"
                  />
                </div>
                <div>
                  <Input
                    label="Phone"
                    size="md"
                    value={newPhone}
                    onChange={(e) => setNewPhone(e.target.value)}
                    placeholder="+1…"
                  />
                </div>
              </div>
              <div>
                <Input
                  label="Notes"
                  size="md"
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  placeholder="Internal notes…"
                />
              </div>
              <div>
                <Input
                  label="Timezone"
                  size="md"
                  value={newTimezone}
                  onChange={(e) => setNewTimezone(e.target.value)}
                  placeholder="America/New_York"
                />
                <p className="text-xs text-slate-500 mt-1.5">
                  IANA zone. Posting times are scheduled in this client&apos;s
                  local time.
                </p>
              </div>
              {createError && <p className={banner.error}>{createError}</p>}
              <Button
                loading={creating}
                variant="primary"
                size="md"
                fullWidth
                onClick={handleCreate}
                disabled={!newName.trim() || creating}
              >
                {creating ? "Creating…" : "Create client"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        <div className="flex flex-wrap gap-3 mb-4">
          <Input
            size="sm"
            aria-label="Search by name…"
            className="max-w-xs"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name…"
          />
          <Select
            size="sm"
            aria-label="Filter by status"
            wrapperClassName="w-auto"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="paused">Paused</option>
            <option value="archived">Archived</option>
          </Select>
        </div>

        {error && <p className={`${banner.error} mb-4`}>{error}</p>}

        {loading ? (
          <TableSkeleton columns={6} />
        ) : clients.length === 0 ? (
          <div className={surface.empty}>
            <p className="text-slate-700 text-lg">No clients yet.</p>
            <p className="text-slate-500 text-sm mt-1">
              Add one to start planning content.
            </p>
            <Button
              variant="primary"
              size="md"
              className="mt-6"
              onClick={() => setShowCreate(true)}
            >
              Add client
            </Button>
          </div>
        ) : (
          <div className={`${surface.table} overflow-x-auto`}>
            <table className="w-full">
              <thead>
                <tr className="bg-stone-50">
                  <th className={table.head}>Name</th>
                  <th className={table.head}>Status</th>
                  <th className={table.head}>Website</th>
                  <th className={table.head}>Contact</th>
                  <th className={table.head}>Created</th>
                  <th className={table.head}></th>
                </tr>
              </thead>
              <tbody>
                {clients.map((c) => (
                  <tr
                    key={c.id}
                    className={`${table.row} cursor-pointer`}
                    onClick={() => router.push(`/clients/${c.id}`)}
                  >
                    <td className={`${table.cell} font-medium`}>{c.name}</td>
                    <td className={table.cell}>
                      <span className={statusPill(c.status)}>{c.status}</span>
                    </td>
                    <td className={table.cellMuted}>{c.website_url || "—"}</td>
                    <td className={table.cellMuted}>{c.contact_email || "—"}</td>
                    <td className={table.cellMuted}>
                      {new Date(c.created_at).toLocaleDateString()}
                    </td>
                    <td className={`${table.cell} text-right`}>
                      <button
                        onClick={async (e) => {
                          e.stopPropagation();
                          const ok = await confirm({
                            title: `Delete "${c.name}"?`,
                            message:
                              "Everything belonging to this client goes with it — its strategy, campaigns, content and schedule.",
                            confirmLabel: "Delete client",
                          });
                          if (ok) {
                            deleteClient(c.id).then(() => fetchClients());
                          }
                        }}
                        className="text-xs text-slate-500 hover:text-red-600 transition-colors"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppShell>
  );
}

"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { listClients, createClient, deleteClient } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type { ClientListItem } from "@/lib/types";

const STATUS_COLORS: Record<string, string> = {
  active: "bg-green-100 text-green-800",
  paused: "bg-yellow-100 text-yellow-800",
  archived: "bg-zinc-100 text-zinc-800",
};

export default function ClientListPage() {
  const router = useRouter();
  const { user, signOut } = useAuth();
  const [clients, setClients] = useState<ClientListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("active");
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);

  // Create form
  const [newName, setNewName] = useState("");
  const [newWebsite, setNewWebsite] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newDescription, setNewDescription] = useState("");

  const fetchClients = async () => {
    try {
      const params: Record<string, string> = {};
      if (statusFilter) params.status = statusFilter;
      if (search) params.search = search;
      const data = await listClients(params);
      setClients(data);
    } catch (e) {
      console.error("Failed to fetch clients:", e);
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
    try {
      const client = await createClient({
        name: newName,
        website_url: newWebsite || undefined,
        contact_email: newEmail || undefined,
        contact_phone: newPhone || undefined,
        description: newDescription || undefined,
      });
      setShowCreate(false);
      setNewName("");
      setNewWebsite("");
      setNewEmail("");
      setNewPhone("");
      setNewDescription("");
      router.push(`/clients/${client.id}`);
    } catch (e) {
      console.error("Failed to create client:", e);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto p-8">
      {/* User header */}
      {user && (
        <div className="flex justify-end items-center gap-3 mb-4">
          <span className="text-xs text-zinc-500">{user.email}</span>
          <button
            onClick={signOut}
            className="text-xs text-zinc-400 hover:text-zinc-600 underline"
          >
            Sign out
          </button>
        </div>
      )}

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Clients</h1>
          <p className="text-zinc-500 text-sm">Manage your marketing clients</p>
        </div>
        <Dialog open={showCreate} onOpenChange={setShowCreate}>
          <Button onClick={() => setShowCreate(true)}>Add Client</Button>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New Client</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 pt-2">
              <div>
                <label className="text-xs text-zinc-500">Name *</label>
                <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Company name" />
              </div>
              <div>
                <label className="text-xs text-zinc-500">Website</label>
                <Input value={newWebsite} onChange={(e) => setNewWebsite(e.target.value)} placeholder="https://..." />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-zinc-500">Email</label>
                  <Input value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="contact@..." />
                </div>
                <div>
                  <label className="text-xs text-zinc-500">Phone</label>
                  <Input value={newPhone} onChange={(e) => setNewPhone(e.target.value)} placeholder="+1..." />
                </div>
              </div>
              <div>
                <label className="text-xs text-zinc-500">Notes</label>
                <Input value={newDescription} onChange={(e) => setNewDescription(e.target.value)} placeholder="Internal notes..." />
              </div>
              <Button onClick={handleCreate} disabled={!newName.trim() || creating} className="w-full">
                {creating ? "Creating..." : "Create Client"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-4">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name..."
          className="max-w-xs"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="border rounded px-3 py-2 text-sm bg-white"
        >
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="paused">Paused</option>
          <option value="archived">Archived</option>
        </select>
      </div>

      {/* Client table */}
      <Card>
        <CardContent className="pt-6">
          {loading ? (
            <p className="text-zinc-500 text-sm">Loading...</p>
          ) : clients.length === 0 ? (
            <p className="text-zinc-500 text-sm">No clients found. Add your first client to get started.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-zinc-500">
                  <th className="pb-2 font-medium">Name</th>
                  <th className="pb-2 font-medium">Status</th>
                  <th className="pb-2 font-medium">Website</th>
                  <th className="pb-2 font-medium">Contact</th>
                  <th className="pb-2 font-medium">Created</th>
                  <th className="pb-2 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {clients.map((c) => (
                  <tr
                    key={c.id}
                    className="border-b last:border-0 cursor-pointer hover:bg-zinc-50 transition-colors"
                    onClick={() => router.push(`/clients/${c.id}`)}
                  >
                    <td className="py-3 font-medium">{c.name}</td>
                    <td className="py-3">
                      <Badge className={STATUS_COLORS[c.status] || "bg-zinc-100"}>
                        {c.status}
                      </Badge>
                    </td>
                    <td className="py-3 text-zinc-500">{c.website_url || "—"}</td>
                    <td className="py-3 text-zinc-500">{c.contact_email || "—"}</td>
                    <td className="py-3 text-zinc-500">
                      {new Date(c.created_at).toLocaleDateString()}
                    </td>
                    <td className="py-3 text-right">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (confirm(`Delete "${c.name}" and all its data?`)) {
                            deleteClient(c.id).then(() => fetchClients());
                          }
                        }}
                        className="text-xs text-zinc-400 hover:text-red-600"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

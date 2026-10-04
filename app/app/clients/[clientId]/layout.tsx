"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { getClient, listCampaigns, listSlots } from "@/lib/api";
import { NumericoLockup } from "@/components/brand/numerico-mark";
import { AppShell } from "@/components/layout/app-shell";
import { backLink, banner } from "@/lib/ui";
import { ChevronLeft } from "lucide-react";
import type { Client } from "@/lib/types";

export default function ClientLayout({ children }: { children: React.ReactNode }) {
  const params = useParams();
  const router = useRouter();
  const clientId = params.clientId as string;
  const [client, setClient] = useState<Client | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Badge counts. Null means "not known yet" and renders nothing — the nav must
  // paint immediately, so these fill in afterwards rather than being awaited.
  const [activeCampaigns, setActiveCampaigns] = useState<number | null>(null);
  const [scheduled, setScheduled] = useState<number | null>(null);

  useEffect(() => {
    getClient(clientId)
      .then(setClient)
      .catch((e) => setError(e.message));
  }, [clientId]);

  useEffect(() => {
    listCampaigns(clientId, "active")
      .then((c) => setActiveCampaigns(c.length))
      .catch(() => {});
    listSlots(clientId, { dated: "scheduled" })
      .then((s) => setScheduled(s.length))
      .catch(() => {});
  }, [clientId]);

  // The error branch replaces the whole page rather than rendering inside the
  // shell: a rail full of links into a client that could not be loaded is
  // worse than no rail. It keeps its own way back.
  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen px-4">
        <div className="text-center space-y-4 max-w-sm">
          <NumericoLockup className="justify-center" />
          <p className={banner.error}>{error}</p>
          <button onClick={() => router.push("/")} className={backLink}>
            <ChevronLeft className="w-4 h-4" aria-hidden="true" />
            Back to clients
          </button>
        </div>
      </div>
    );
  }

  return (
    <AppShell
      clientId={clientId}
      client={{
        name: client?.name ?? "Loading…",
        logoUrl: client?.logo_url,
        activeCampaigns,
        scheduled,
      }}
    >
      {children}
    </AppShell>
  );
}

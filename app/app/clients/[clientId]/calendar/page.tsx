"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { getCalendarUrls } from "@/lib/api";

export default function CalendarPage() {
  const { clientId } = useParams() as { clientId: string };
  const [urls, setUrls] = useState<{ embed_url: string | null; open_url: string | null } | null>(null);

  useEffect(() => {
    getCalendarUrls(clientId).then(setUrls).catch(() => {});
  }, [clientId]);

  const hasCalendar = !!urls?.embed_url;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Calendar</h1>
          <p className="text-zinc-500 text-sm">Scheduled posts across all campaigns</p>
        </div>
        {urls?.open_url && (
          <a href={urls.open_url} target="_blank" rel="noreferrer">
            <Button variant="outline">Open in Google Calendar ↗</Button>
          </a>
        )}
      </div>

      {hasCalendar && urls?.embed_url ? (
        <Card>
          <CardContent className="p-0">
            <iframe
              src={urls.embed_url}
              className="w-full h-[700px] border-0 rounded"
              title="Google Calendar"
            />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="pt-6 text-center">
            <p className="text-sm text-zinc-500">
              No calendar yet. Schedule your first asset from a run to create one.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

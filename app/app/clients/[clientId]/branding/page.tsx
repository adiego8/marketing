"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { getClient, updateClient } from "@/lib/api";
import type { Branding, Client } from "@/lib/types";

const DEFAULT_BRANDING: Branding = {
  colors: { primary: "#1a1a1a", secondary: "#f5f5f5", accent: "#ff6b35" },
  fonts: { headline: "Inter", body: "Inter" },
  visual_style: "",
  mood: "",
  dos: "",
  donts: "",
};

export default function BrandingPage() {
  const { clientId } = useParams() as { clientId: string };
  const [client, setClient] = useState<Client | null>(null);
  const [branding, setBranding] = useState<Branding>(DEFAULT_BRANDING);
  const [logoUrl, setLogoUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getClient(clientId).then((c) => {
      setClient(c);
      setLogoUrl(c.logo_url || "");
      if (c.branding) {
        setBranding({
          colors: { ...DEFAULT_BRANDING.colors, ...c.branding.colors },
          fonts: { ...DEFAULT_BRANDING.fonts, ...c.branding.fonts },
          visual_style: c.branding.visual_style || "",
          mood: c.branding.mood || "",
          dos: c.branding.dos || "",
          donts: c.branding.donts || "",
        });
      }
    });
  }, [clientId]);

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      await updateClient(clientId, { branding, logo_url: logoUrl || null });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const updateColor = (key: "primary" | "secondary" | "accent", value: string) => {
    setBranding({ ...branding, colors: { ...branding.colors, [key]: value } });
  };

  const updateFont = (key: "headline" | "body", value: string) => {
    setBranding({ ...branding, fonts: { ...branding.fonts, [key]: value } });
  };

  return (
    <div className="max-w-3xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Branding</h1>
          <p className="text-zinc-500 text-sm">
            Brand kit used in Canva prompts and calendar event briefs
          </p>
        </div>
        <div className="flex items-center gap-3">
          {saved && <span className="text-xs text-green-600">Saved</span>}
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save"}
          </Button>
        </div>
      </div>

      {error && (
        <Card className="mb-4 border-red-200">
          <CardContent className="pt-4">
            <p className="text-sm text-red-600">{error}</p>
          </CardContent>
        </Card>
      )}

      <div className="space-y-4">
        {/* Logo */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Logo</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <label className="text-xs text-zinc-500">Logo URL</label>
              <Input
                value={logoUrl}
                onChange={(e) => setLogoUrl(e.target.value)}
                placeholder="https://example.com/logo.png"
              />
            </div>
            {logoUrl && (
              <div className="flex items-center gap-3 p-3 bg-zinc-50 rounded">
                <img src={logoUrl} alt="Logo preview" className="w-16 h-16 object-contain" />
                <span className="text-xs text-zinc-500">Preview</span>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Colors */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Color Palette</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-3 gap-4">
            {(["primary", "secondary", "accent"] as const).map((key) => (
              <div key={key}>
                <label className="text-xs text-zinc-500 capitalize">{key}</label>
                <div className="flex gap-2 items-center">
                  <input
                    type="color"
                    value={branding.colors?.[key] || "#000000"}
                    onChange={(e) => updateColor(key, e.target.value)}
                    className="w-10 h-10 rounded border cursor-pointer"
                  />
                  <Input
                    value={branding.colors?.[key] || ""}
                    onChange={(e) => updateColor(key, e.target.value)}
                    placeholder="#000000"
                    className="font-mono text-sm"
                  />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Fonts */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Typography</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-zinc-500">Headline Font</label>
              <Input
                value={branding.fonts?.headline || ""}
                onChange={(e) => updateFont("headline", e.target.value)}
                placeholder="Inter"
              />
            </div>
            <div>
              <label className="text-xs text-zinc-500">Body Font</label>
              <Input
                value={branding.fonts?.body || ""}
                onChange={(e) => updateFont("body", e.target.value)}
                placeholder="Inter"
              />
            </div>
          </CardContent>
        </Card>

        {/* Guidelines */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Brand Guidelines</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-xs text-zinc-500">Visual Style</label>
              <Textarea
                value={branding.visual_style || ""}
                onChange={(e) => setBranding({ ...branding, visual_style: e.target.value })}
                placeholder="Clean, minimal, geometric shapes. Bold typography. Plenty of negative space."
                className="h-20"
              />
            </div>
            <div>
              <label className="text-xs text-zinc-500">Mood</label>
              <Textarea
                value={branding.mood || ""}
                onChange={(e) => setBranding({ ...branding, mood: e.target.value })}
                placeholder="Professional but approachable. Confident, not arrogant."
                className="h-20"
              />
            </div>
            <div>
              <label className="text-xs text-zinc-500">Do's</label>
              <Textarea
                value={branding.dos || ""}
                onChange={(e) => setBranding({ ...branding, dos: e.target.value })}
                placeholder="Use negative space. Bold headlines. Brand colors prominent."
                className="h-20"
              />
            </div>
            <div>
              <label className="text-xs text-zinc-500">Don'ts</label>
              <Textarea
                value={branding.donts || ""}
                onChange={(e) => setBranding({ ...branding, donts: e.target.value })}
                placeholder="No stock photos. No gradients. No cliches."
                className="h-20"
              />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { getClient, updateClient } from "@/lib/api";
import { banner, btn, field, surface, text } from "@/lib/ui";
import type { Branding } from "@/lib/types";

const DEFAULT_BRANDING: Branding = {
  colors: { primary: "#1a1a1a", secondary: "#f5f5f5", accent: "#ff6b35" },
  fonts: { headline: "Inter", body: "Inter" },
  visual_style: "",
  mood: "",
  dos: "",
  donts: "",
};

const GUIDELINES = [
  {
    key: "visual_style" as const,
    label: "Visual style",
    placeholder:
      "Clean, minimal, geometric shapes. Bold typography. Plenty of negative space.",
  },
  {
    key: "mood" as const,
    label: "Mood",
    placeholder: "Professional but approachable. Confident, not arrogant.",
  },
  {
    key: "dos" as const,
    label: "Do's",
    placeholder: "Use negative space. Bold headlines. Brand colours prominent.",
  },
  {
    key: "donts" as const,
    label: "Don'ts",
    placeholder: "No stock photos. No gradients. No clichés.",
  },
];

export default function BrandingPage() {
  const { clientId } = useParams() as { clientId: string };
  const [branding, setBranding] = useState<Branding>(DEFAULT_BRANDING);
  const [logoUrl, setLogoUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getClient(clientId)
      .then((c) => {
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
      })
      .catch((e) =>
        setError(e instanceof Error ? e.message : "Could not load branding")
      );
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
      <div className="flex flex-wrap items-end justify-between gap-4 mb-8">
        <div>
          <p className={text.eyebrow}>Client</p>
          <h1 className={`${text.h1} mt-1`}>Branding</h1>
          <p className="text-sm text-slate-500 mt-1">
            The brand kit used in Canva prompts and calendar event briefs.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {saved && (
            <span className="text-xs font-semibold text-green-700">Saved</span>
          )}
          <button onClick={handleSave} disabled={saving} className={btn.primarySm}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>

      {error && <p className={`${banner.error} mb-4`}>{error}</p>}

      <div className="space-y-4">
        <section className={`${surface.card} ${surface.pad}`}>
          <h2 className={`${text.cardTitle} mb-4`}>Logo</h2>
          <label className={field.micro}>Logo URL</label>
          <input
            value={logoUrl}
            onChange={(e) => setLogoUrl(e.target.value)}
            placeholder="https://example.com/logo.png"
            className={field.inputSm}
          />
          {logoUrl && (
            <div className={`${surface.inset} mt-3 flex items-center gap-3`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={logoUrl}
                alt="Logo preview"
                className="w-16 h-16 object-contain"
              />
              <span className="text-xs text-slate-500">Preview</span>
            </div>
          )}
        </section>

        <section className={`${surface.card} ${surface.pad}`}>
          <h2 className={`${text.cardTitle} mb-4`}>Colour palette</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {(["primary", "secondary", "accent"] as const).map((key) => (
              <div key={key}>
                <label className={`${field.micro} capitalize`}>{key}</label>
                <div className="flex gap-2 items-center">
                  <input
                    type="color"
                    value={branding.colors?.[key] || "#000000"}
                    onChange={(e) => updateColor(key, e.target.value)}
                    className="w-10 h-10 rounded-lg border border-slate-200 cursor-pointer shrink-0"
                    aria-label={`${key} colour`}
                  />
                  <input
                    value={branding.colors?.[key] || ""}
                    onChange={(e) => updateColor(key, e.target.value)}
                    placeholder="#000000"
                    className={`${field.inputSm} font-mono`}
                  />
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className={`${surface.card} ${surface.pad}`}>
          <h2 className={`${text.cardTitle} mb-4`}>Typography</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={field.micro}>Headline font</label>
              <input
                value={branding.fonts?.headline || ""}
                onChange={(e) => updateFont("headline", e.target.value)}
                placeholder="Inter"
                className={field.inputSm}
              />
            </div>
            <div>
              <label className={field.micro}>Body font</label>
              <input
                value={branding.fonts?.body || ""}
                onChange={(e) => updateFont("body", e.target.value)}
                placeholder="Inter"
                className={field.inputSm}
              />
            </div>
          </div>
        </section>

        <section className={`${surface.card} ${surface.pad}`}>
          <h2 className={`${text.cardTitle} mb-4`}>Brand guidelines</h2>
          <div className="space-y-4">
            {GUIDELINES.map(({ key, label, placeholder }) => (
              <div key={key}>
                <label className={field.micro}>{label}</label>
                <textarea
                  value={branding[key] || ""}
                  onChange={(e) =>
                    setBranding({ ...branding, [key]: e.target.value })
                  }
                  placeholder={placeholder}
                  className={`${field.textarea} h-20`}
                />
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

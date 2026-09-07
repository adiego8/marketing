// Server-only: the content plan as a branded PDF. Imported from route handlers
// only, never from a client component.
//
// Markdown is for pasting; this is for sending. Same content, same grouping as
// plan-markdown.ts, laid out for a reader who is not going to open the app.
//
// Follows numerico-website/lib/quote-pdf.tsx: @react-pdf/renderer with
// renderToBuffer, declared in next.config's serverExternalPackages.

import {
  Document,
  Page,
  View,
  Text,
  StyleSheet,
  renderToBuffer,
} from "@react-pdf/renderer";
import { contentTypeLabel } from "../content-types";
import { readCopy, isCopyStale, copySections } from "../copy";
import type { Slot } from "../../types";
import type { PlanDocMeta } from "./plan-markdown";

// The app's palette. Teal accent, slate ink — a Numerico document.
const INK = "#0f172a";
const BODY = "#334155";
const MUTED = "#64748b";
const FAINT = "#94a3b8";
const LINE = "#e2e8f0";
const TEAL = "#0d9488";
const TEAL_SOFT = "#f0fdfa";
const GROUND = "#fafaf9";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Same fixed tables as the Markdown export: a document must not shift with ICU data. */
function dayLabel(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return date;
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

const s = StyleSheet.create({
  page: {
    paddingTop: 48,
    paddingBottom: 56,
    paddingHorizontal: 48,
    fontSize: 10,
    color: BODY,
    fontFamily: "Helvetica",
    backgroundColor: "#ffffff",
  },
  eyebrow: {
    fontSize: 7.5,
    letterSpacing: 2,
    color: TEAL,
    fontFamily: "Helvetica-Bold",
    marginBottom: 6,
  },
  h1: { fontSize: 22, color: INK, fontFamily: "Helvetica-Bold", marginBottom: 6 },
  sub: { fontSize: 9.5, color: MUTED },
  rule: { borderBottomWidth: 1.5, borderBottomColor: INK, marginTop: 16, marginBottom: 22 },

  weekHead: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 18,
    marginBottom: 8,
  },
  weekKey: { fontSize: 11, color: INK, fontFamily: "Helvetica-Bold" },
  weekCount: {
    fontSize: 7.5,
    color: MUTED,
    backgroundColor: GROUND,
    borderWidth: 1,
    borderColor: LINE,
    borderRadius: 8,
    paddingVertical: 2,
    paddingHorizontal: 6,
    marginLeft: 8,
  },

  slot: {
    borderWidth: 1,
    borderColor: LINE,
    borderRadius: 6,
    padding: 12,
    marginBottom: 8,
  },
  slotTop: { flexDirection: "row", alignItems: "center", marginBottom: 6 },
  when: { fontSize: 10, color: INK, fontFamily: "Helvetica-Bold", width: 108 },
  chip: {
    fontSize: 7.5,
    color: TEAL,
    backgroundColor: TEAL_SOFT,
    borderRadius: 8,
    paddingVertical: 2,
    paddingHorizontal: 6,
    marginRight: 6,
  },
  status: { fontSize: 7.5, color: MUTED, marginLeft: "auto" },
  theme: { fontSize: 11, color: INK, marginBottom: 4, lineHeight: 1.35 },
  brief: { fontSize: 9.5, color: BODY, lineHeight: 1.45, marginBottom: 6 },
  partLabel: {
    fontSize: 7,
    letterSpacing: 1.2,
    color: TEAL,
    fontFamily: "Helvetica-Bold",
    marginBottom: 2,
  },
  hook: { fontSize: 10, color: INK, lineHeight: 1.4, marginBottom: 6 },
  beat: { fontSize: 9.5, color: BODY, lineHeight: 1.45, marginBottom: 2 },
  beatBlock: { marginBottom: 6 },
  meta: { fontSize: 8.5, color: FAINT, lineHeight: 1.4 },

  empty: { fontSize: 10, color: MUTED, fontStyle: "italic", marginTop: 24 },
  note: { fontSize: 8.5, color: FAINT, marginTop: 14 },

  footer: {
    position: "absolute",
    bottom: 28,
    left: 48,
    right: 48,
    flexDirection: "row",
    borderTopWidth: 1,
    borderTopColor: LINE,
    paddingTop: 8,
    fontSize: 7.5,
    color: FAINT,
  },
});

function PlanDoc({ slots, meta }: { slots: Slot[]; meta: PlanDocMeta }) {
  const generated = meta.generatedAt ?? new Date();
  const live = slots.filter((x) => x.status !== "cancelled" && x.status !== "skipped");
  const dropped = slots.length - live.length;

  const byWeek = new Map<string, Slot[]>();
  for (const slot of live) {
    const key = slot.week_key || "Unscheduled";
    const bucket = byWeek.get(key);
    if (bucket) bucket.push(slot);
    else byWeek.set(key, [slot]);
  }

  return (
    <Document
      title={`Content plan — ${meta.clientName}`}
      author="Numerico"
      subject={`${meta.start} to ${meta.end}`}
    >
      <Page size="A4" style={s.page}>
        <Text style={s.eyebrow}>NUMERICO MARKETING</Text>
        <Text style={s.h1}>Content plan — {meta.clientName}</Text>
        <Text style={s.sub}>
          {meta.start} to {meta.end} · {live.length} piece
          {live.length === 1 ? "" : "s"} · times shown in {meta.timezone}
        </Text>
        <View style={s.rule} />

        {live.length === 0 ? (
          <Text style={s.empty}>No content scheduled in this range.</Text>
        ) : (
          Array.from(byWeek.entries()).map(([weekKey, weekSlots]) => (
            // No wrap={false} here: a week can hold more slots than fit on a
            // page, and forcing the group onto one page makes react-pdf
            // collapse the content over itself. Individual slots are small
            // enough to keep whole, and that is where the flag belongs.
            <View key={weekKey}>
              <View style={s.weekHead} wrap={false} minPresenceAhead={80}>
                <Text style={s.weekKey}>{weekKey}</Text>
                <Text style={s.weekCount}>
                  {weekSlots.length} piece{weekSlots.length === 1 ? "" : "s"}
                </Text>
              </View>

              {weekSlots.map((slot) => (
                // Wrapping is deliberate. A slot with finished copy — a dozen
                // blocks plus a caption — is taller than a page, and
                // wrap={false} on something taller than a page renders it over
                // itself. That bug has shipped here once already.
                <View key={slot.id} style={s.slot} minPresenceAhead={60}>
                  <View style={s.slotTop}>
                    <Text style={s.when}>
                      {dayLabel(slot.date)} · {slot.time_local}
                    </Text>
                    <Text style={s.chip}>{slot.channel}</Text>
                    <Text style={s.chip}>{contentTypeLabel(slot.type)}</Text>
                    {slot.status !== "planned" && (
                      <Text style={s.status}>{slot.status}</Text>
                    )}
                  </View>

                  <Text style={s.theme}>
                    {slot.needs_theme || !slot.theme ? "Theme not set" : slot.theme}
                  </Text>
                  {!!slot.brief && <Text style={s.brief}>{slot.brief}</Text>}

                  {!!slot.hook && (
                    <View>
                      <Text style={s.partLabel}>HOOK</Text>
                      <Text style={s.hook}>{slot.hook}</Text>
                    </View>
                  )}
                  {slot.body?.length > 0 && (
                    <View style={s.beatBlock}>
                      <Text style={s.partLabel}>BODY</Text>
                      {slot.body.map((beat, i) => (
                        <Text key={i} style={s.beat}>
                          {i + 1}. {beat}
                        </Text>
                      ))}
                    </View>
                  )}
                  {!!slot.cta && (
                    <View>
                      <Text style={s.partLabel}>CTA</Text>
                      <Text style={s.hook}>{slot.cta}</Text>
                    </View>
                  )}
                  {(() => {
                    const copy = readCopy(slot);
                    if (!copy) return null;
                    return (
                      <View style={s.beatBlock}>
                        {isCopyStale(slot) && (
                          <Text style={s.meta}>
                            The brief above changed after this copy was written.
                          </Text>
                        )}
                        {copySections(copy).map((section, i) => (
                          <View key={i}>
                            <Text style={s.partLabel}>
                              {section.label.toUpperCase()}
                            </Text>
                            <Text style={s.beat}>{section.text}</Text>
                            {!!section.note && (
                              <Text style={s.meta}>{section.note}</Text>
                            )}
                          </View>
                        ))}
                      </View>
                    );
                  })()}
                  {(slot.campaign_title || slot.rationale) && (
                    <Text style={s.meta}>
                      {[
                        slot.campaign_title ? `Campaign: ${slot.campaign_title}` : null,
                        slot.rationale,
                      ]
                        .filter(Boolean)
                        .join("  ·  ")}
                    </Text>
                  )}
                </View>
              ))}
            </View>
          ))
        )}

        {dropped > 0 && (
          <Text style={s.note}>
            {dropped} cancelled or skipped slot{dropped === 1 ? "" : "s"} omitted.
          </Text>
        )}

        <View style={s.footer} fixed>
          <Text>
            {meta.clientName} · generated{" "}
            {generated.toISOString().slice(0, 16).replace("T", " ")} UTC
          </Text>
          <Text
            style={{ marginLeft: "auto" }}
            render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`}
          />
        </View>
      </Page>
    </Document>
  );
}

export function renderPlanPdf(slots: Slot[], meta: PlanDocMeta): Promise<Buffer> {
  return renderToBuffer(<PlanDoc slots={slots} meta={meta} />);
}

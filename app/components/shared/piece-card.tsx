"use client";

import { piece as tokens, text } from "@/lib/ui";
import { channelPill, PILL } from "@/lib/ui-status";
import { contentTypeLabel } from "@/lib/marketing/content-types";
import type { ProposedSlot, DroppedSlot, Slot } from "@/lib/types";

/**
 * One written piece, rendered so it can be read.
 *
 * A piece is five fields of prose of wildly different lengths — a theme, an
 * opening, N beats, an ask, and why it exists. Both the planner and the
 * calendar used to render all five inside a single `<td>`, which pushed rows
 * past 200px, broke every column alignment around them, and made the writing —
 * the entire point of the screen — the hardest thing on it to read.
 *
 * The card gives each field its own line and lets the beats be a real list.
 *
 * `ProposedSlot` is camelCase and `Slot` is snake_case, so callers normalise
 * through `fromProposed` / `fromSlot` below rather than reaching into this
 * shape by hand.
 */

export interface Piece {
  id: string;
  type: string;
  channel: string;
  theme: string;
  hook: string;
  body: string[];
  cta: string;
  rationale: string;
  brief: string;
  needsTheme: boolean;
  campaignTitle?: string | null;
}

export function fromProposed(slot: ProposedSlot | DroppedSlot): Piece {
  return {
    id: slot.slotId,
    type: slot.type,
    channel: slot.channel,
    theme: slot.theme,
    // Runs predating the piece structure carry none of these, so each falls
    // back rather than rendering "undefined".
    hook: slot.hook ?? "",
    body: slot.body ?? [],
    cta: slot.cta ?? "",
    rationale: slot.rationale ?? "",
    brief: slot.brief ?? "",
    needsTheme: slot.needsTheme,
    campaignTitle: slot.campaignTitle,
  };
}

export function fromSlot(slot: Slot): Piece {
  return {
    id: slot.id,
    type: slot.type,
    channel: slot.channel,
    theme: slot.theme,
    hook: slot.hook ?? "",
    body: slot.body ?? [],
    cta: slot.cta ?? "",
    rationale: slot.rationale ?? "",
    brief: slot.brief ?? "",
    needsTheme: slot.needs_theme,
    campaignTitle: slot.campaign_title,
  };
}

export function PieceCard({
  piece,
  /** Shown left of the channel pill: a date, a time, a week — whatever the
      surrounding screen orders by. */
  lead,
  /** Top-right: the one action for this piece in this context. */
  action,
  /** A state line along the bottom: status, sync, copy readiness. */
  footer,
  /**
   * An expanded region below the footer — the finished copy, and the controls
   * for writing it.
   *
   * Rendered only when the surrounding screen decides this piece is open, so
   * the card itself holds no open/closed state: a list of them needs exactly
   * one id open at a time, which is the page's business, not the card's.
   */
  children,
  muted = false,
  showCampaign = false,
}: {
  piece: Piece;
  lead?: React.ReactNode;
  action?: React.ReactNode;
  footer?: React.ReactNode;
  children?: React.ReactNode;
  muted?: boolean;
  showCampaign?: boolean;
}) {
  return (
    <article className={muted ? tokens.cardMuted : tokens.card}>
      <div className="flex items-start justify-between gap-3">
        <div className={tokens.meta}>
          {lead && (
            <span className="text-sm font-medium text-slate-700 whitespace-nowrap">
              {lead}
            </span>
          )}
          <span className={channelPill(piece.channel)}>{piece.channel}</span>
          <span className="text-xs text-slate-500">
            {contentTypeLabel(piece.type)}
          </span>
          {showCampaign && piece.campaignTitle && (
            <span className="text-xs text-slate-400 truncate">
              {piece.campaignTitle}
            </span>
          )}
        </div>
        {action && <div className="shrink-0 -mt-1">{action}</div>}
      </div>

      {piece.needsTheme || !piece.theme ? (
        <p className={`${PILL} bg-red-100 text-red-600`}>Theme not set</p>
      ) : (
        <>
          <h3 className={tokens.theme}>{piece.theme}</h3>
          {piece.hook && <p className={tokens.hook}>{piece.hook}</p>}
          {piece.body.length > 0 && (
            <ol className={tokens.beats}>
              {piece.body.map((beat, i) => (
                <li key={i}>{beat}</li>
              ))}
            </ol>
          )}
          {piece.cta && <p className={tokens.cta}>{piece.cta}</p>}
          {/* The brief is the fallback for a piece written before hooks and
              beats existed — showing both would just repeat the same idea. */}
          {!piece.hook && piece.brief && (
            <p className={`${text.muted} mt-2`}>{piece.brief}</p>
          )}
          {piece.rationale && <p className={tokens.rationale}>{piece.rationale}</p>}
        </>
      )}

      {footer && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 mt-3 pt-3 border-t border-slate-100">
          {footer}
        </div>
      )}

      {/* Below the footer, not above: the state line says what this piece is,
          and the expansion is the answer to it. */}
      {children && <div className="mt-3 space-y-3">{children}</div>}
    </article>
  );
}

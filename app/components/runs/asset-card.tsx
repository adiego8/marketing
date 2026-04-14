"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { RatingStars } from "@/components/shared/rating-stars";
import { CopyButton } from "@/components/shared/copy-button";
import { submitFeedback } from "@/lib/api";
import { PLATFORM_FORMATS, getAssetText } from "@/lib/platform-formatter";
import type { Asset } from "@/lib/types";

interface AssetCardProps {
  asset: Asset;
  index: number;
  runId: string;
}

export function AssetCard({ asset, index, runId }: AssetCardProps) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [saved, setSaved] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [showFormats, setShowFormats] = useState(false);

  const handleRate = async (value: number) => {
    setRating(value);
    try {
      await submitFeedback({ run_id: runId, asset_index: index, rating: value });
    } catch (e) {
      console.error("Failed to submit rating:", e);
    }
  };

  const handleSave = async () => {
    setSubmitting(true);
    try {
      await submitFeedback({
        run_id: runId,
        asset_index: index,
        rating: rating || 3,
        comment: comment || undefined,
        save_asset: true,
      });
      setSaved(true);
    } catch (e) {
      console.error("Failed to save asset:", e);
    } finally {
      setSubmitting(false);
    }
  };

  const handleFeedback = async () => {
    if (!comment.trim()) return;
    try {
      await submitFeedback({
        run_id: runId,
        asset_index: index,
        rating: rating || 3,
        comment,
      });
    } catch (e) {
      console.error("Failed to submit feedback:", e);
    }
  };

  const typeLabel = asset.type.toUpperCase().replace(/_/g, " ");
  const content = asset.content;
  const rationale = asset.rationale;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CardTitle className="text-sm">{typeLabel}</CardTitle>
            {asset.format && (
              <Badge variant="outline" className="text-xs">
                {asset.format.replace(/_/g, " ")}
              </Badge>
            )}
          </div>
          <CopyButton text={getAssetText(asset)} label="Copy" variant="outline" />
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Content */}
        <div className="text-sm leading-relaxed">
          {typeof content === "string" ? (
            <p className="whitespace-pre-wrap">{content}</p>
          ) : Array.isArray(content) ? (
            <div className="space-y-2">
              {content.map((slide, i) => (
                <div key={i} className="bg-zinc-50 p-2 rounded text-xs">
                  <span className="font-semibold">Slide {typeof slide === "object" && "slide" in slide ? slide.slide : i + 1}:</span>{" "}
                  {typeof slide === "object" && "text" in slide ? slide.text : String(slide)}
                </div>
              ))}
            </div>
          ) : null}
        </div>

        {/* Generated images */}
        {asset.generated_images && asset.generated_images.length > 0 && (
          <div className="flex gap-2 overflow-x-auto">
            {asset.generated_images.map((img, i) => (
              <img
                key={i}
                src={img}
                alt={`${typeLabel} variant ${i + 1}`}
                className="w-48 h-48 object-cover rounded border"
              />
            ))}
          </div>
        )}

        {/* Rationale */}
        {rationale && (
          <div className="bg-zinc-50 p-3 rounded text-xs space-y-1">
            {rationale.why_this_post && (
              <p><span className="font-semibold">WHY:</span> {rationale.why_this_post}</p>
            )}
            {rationale.why_this_format && (
              <p><span className="font-semibold">FORMAT:</span> {rationale.why_this_format}</p>
            )}
            {rationale.expected_outcome && (
              <p><span className="font-semibold">EXPECTED:</span> {rationale.expected_outcome}</p>
            )}
          </div>
        )}

        {/* Platform copy buttons */}
        <div className="border-t pt-2">
          <Button
            size="sm"
            variant="ghost"
            className="text-xs text-zinc-500"
            onClick={() => setShowFormats(!showFormats)}
          >
            {showFormats ? "Hide formats" : "Copy as..."}
          </Button>
          {showFormats && (
            <div className="flex flex-wrap gap-1 mt-2">
              {PLATFORM_FORMATS.map((pf) => (
                <CopyButton
                  key={pf.label}
                  text={pf.format(asset)}
                  label={pf.label}
                  variant="secondary"
                />
              ))}
            </div>
          )}
        </div>

        {/* Rating + Save + Feedback */}
        <div className="flex items-center gap-4 pt-2 border-t">
          <RatingStars value={rating} onChange={handleRate} />
          <Button
            size="sm"
            variant={saved ? "outline" : "default"}
            onClick={handleSave}
            disabled={submitting || saved}
          >
            {saved ? "Saved" : "Save"}
          </Button>
        </div>
        <div className="flex gap-2">
          <Textarea
            placeholder="Add feedback..."
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            className="text-xs h-16"
          />
          <Button size="sm" variant="outline" onClick={handleFeedback} className="self-end">
            Send
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

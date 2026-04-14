import type { Asset } from "./types";

/**
 * Extracts the raw text content from an asset.
 */
export function getAssetText(asset: { content: unknown }): string {
  const content = asset.content;
  if (typeof content === "string") return content;
  if (content && typeof content === "object") {
    const obj = content as Record<string, unknown>;
    if (typeof obj.content === "string") return obj.content;
    if (Array.isArray(obj.content)) {
      return obj.content
        .map((s: Record<string, unknown>) => s.text || "")
        .join("\n\n");
    }
    if (typeof obj.text === "string") return obj.text;
  }
  return String(content);
}

/**
 * Format content for Instagram caption.
 * - Line breaks for readability
 * - Hashtags at the end
 * - Hook as first line
 */
export function formatInstagram(text: string, hashtags?: string[]): string {
  const lines = text.split("\n").filter(Boolean);
  let formatted = lines.join("\n\n");
  if (hashtags?.length) {
    formatted += "\n\n.\n.\n.\n" + hashtags.map((h) => (h.startsWith("#") ? h : `#${h}`)).join(" ");
  }
  return formatted;
}

/**
 * Format content for LinkedIn.
 * - Hook first, then body
 * - Professional spacing
 * - No excessive hashtags
 */
export function formatLinkedIn(text: string): string {
  const lines = text.split("\n").filter(Boolean);
  if (lines.length <= 1) return text;
  // First line as hook (bold effect with caps or as-is)
  const hook = lines[0];
  const body = lines.slice(1).join("\n\n");
  return `${hook}\n\n${body}`;
}

/**
 * Format content for Twitter/X.
 * - Split into tweets if over 280 chars
 * - Thread format with numbering
 */
export function formatTwitter(text: string): string {
  if (text.length <= 280) return text;

  const sentences = text.split(/(?<=[.!?])\s+/);
  const tweets: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    if ((current + " " + sentence).trim().length <= 270) {
      current = (current + " " + sentence).trim();
    } else {
      if (current) tweets.push(current);
      current = sentence;
    }
  }
  if (current) tweets.push(current);

  if (tweets.length === 1) return tweets[0];
  return tweets.map((t, i) => `${i + 1}/${tweets.length} ${t}`).join("\n\n---\n\n");
}

/**
 * Generate an image generation prompt from asset content + rationale.
 * Ready to paste into Midjourney, DALL-E, Canva AI, etc.
 */
export function formatImagePrompt(asset: Asset): string {
  // If the asset already has an image_prompt, use it
  if (asset.image_prompt) return asset.image_prompt;

  const text = getAssetText(asset);
  const format = asset.format || "static_graphic";
  const rationale = asset.rationale;

  let prompt = `Create a professional marketing image for the following content:\n\n`;
  prompt += `"${text.slice(0, 300)}"\n\n`;
  prompt += `Format: ${format.replace(/_/g, " ")}\n`;

  if (rationale?.why_this_post) {
    prompt += `Context: ${rationale.why_this_post}\n`;
  }
  if (rationale?.expected_outcome) {
    prompt += `Goal: ${rationale.expected_outcome}\n`;
  }

  prompt += `\nStyle: Clean, professional, modern. No stock photo cliches. `;
  prompt += `Leave space for text overlay if needed. `;
  prompt += `Use brand-appropriate colors.`;

  return prompt;
}

/**
 * Format as a creative brief — all the context someone needs
 * to produce the final visual in an external tool.
 */
export function formatCreativeBrief(asset: Asset): string {
  const text = getAssetText(asset);
  const rationale = asset.rationale;

  let brief = "=== CREATIVE BRIEF ===\n\n";
  brief += `TYPE: ${asset.type.replace(/_/g, " ").toUpperCase()}\n`;
  if (asset.format) brief += `FORMAT: ${asset.format.replace(/_/g, " ")}\n`;
  brief += `\n--- COPY ---\n${text}\n`;

  if (rationale) {
    brief += `\n--- STRATEGY ---\n`;
    if (rationale.why_this_post) brief += `Why: ${rationale.why_this_post}\n`;
    if (rationale.why_this_format) brief += `Format rationale: ${rationale.why_this_format}\n`;
    if (rationale.target_moment) brief += `Target moment: ${rationale.target_moment}\n`;
    if (rationale.expected_outcome) brief += `Expected outcome: ${rationale.expected_outcome}\n`;
  }

  if (asset.image_prompt) {
    brief += `\n--- IMAGE PROMPT ---\n${asset.image_prompt}\n`;
  }

  return brief;
}

export type PlatformFormat = {
  label: string;
  format: (asset: Asset) => string;
};

export const PLATFORM_FORMATS: PlatformFormat[] = [
  { label: "Raw Text", format: (a) => getAssetText(a) },
  { label: "Instagram", format: (a) => formatInstagram(getAssetText(a)) },
  { label: "LinkedIn", format: (a) => formatLinkedIn(getAssetText(a)) },
  { label: "Twitter/X", format: (a) => formatTwitter(getAssetText(a)) },
  { label: "Image Prompt", format: (a) => formatImagePrompt(a) },
  { label: "Creative Brief", format: (a) => formatCreativeBrief(a) },
];

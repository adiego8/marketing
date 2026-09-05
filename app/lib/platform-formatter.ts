import type { Asset, Branding } from "./types";

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

/**
 * Generate a Canva AI design prompt from asset content.
 * Includes design type, copy, visual direction, layout, and brand kit —
 * ready to paste into Canva's Magic Design or text-to-design.
 */
export function formatCanvaPrompt(asset: Asset, branding?: Branding, logoUrl?: string): string {
  const text = getAssetText(asset);
  const rationale = asset.rationale;
  const format = asset.format || "static_graphic";

  // Map asset format to Canva design type + dimensions
  const designMap: Record<string, { type: string; size: string }> = {
    static_graphic: { type: "Instagram Post", size: "1080x1080" },
    carousel: { type: "Instagram Carousel", size: "1080x1080 per slide" },
    story: { type: "Instagram Story", size: "1080x1920" },
    reel_script: { type: "Instagram Reel Cover", size: "1080x1920" },
    linkedin_post: { type: "LinkedIn Post", size: "1200x627" },
    twitter_post: { type: "Twitter/X Post", size: "1600x900" },
    infographic: { type: "Infographic", size: "800x2000" },
  };

  const design = designMap[format] || { type: "Social Media Post", size: "1080x1080" };

  let prompt = `=== CANVA AI DESIGN PROMPT ===\n\n`;
  prompt += `DESIGN TYPE: ${design.type}\n`;
  prompt += `DIMENSIONS: ${design.size}\n\n`;

  prompt += `--- TEXT TO INCLUDE ---\n`;
  if (typeof asset.content === "string") {
    // For short-form: split into headline vs body
    const lines = text.split("\n").filter(Boolean);
    if (lines.length > 1) {
      prompt += `Headline: ${lines[0]}\n`;
      prompt += `Body: ${lines.slice(1).join(" ")}\n`;
    } else {
      prompt += `Main text: ${text}\n`;
    }
  } else if (Array.isArray(asset.content)) {
    asset.content.forEach((slide, i) => {
      const slideText = typeof slide === "object" && "text" in slide ? slide.text : String(slide);
      prompt += `Slide ${i + 1}: ${slideText}\n`;
    });
  }

  // Brand kit section
  const hasBrandKit =
    logoUrl ||
    branding?.colors?.primary ||
    branding?.fonts?.headline ||
    branding?.visual_style ||
    branding?.mood ||
    branding?.dos ||
    branding?.donts;

  if (hasBrandKit) {
    prompt += `\n--- BRAND KIT ---\n`;
    if (logoUrl) prompt += `Logo: ${logoUrl}\n`;
    if (branding?.colors) {
      const c = branding.colors;
      const parts = [];
      if (c.primary) parts.push(`Primary ${c.primary}`);
      if (c.secondary) parts.push(`Secondary ${c.secondary}`);
      if (c.accent) parts.push(`Accent ${c.accent}`);
      if (parts.length) prompt += `Colors: ${parts.join(" · ")}\n`;
    }
    if (branding?.fonts) {
      const parts = [];
      if (branding.fonts.headline) parts.push(`${branding.fonts.headline} (headline)`);
      if (branding.fonts.body) parts.push(`${branding.fonts.body} (body)`);
      if (parts.length) prompt += `Fonts: ${parts.join(", ")}\n`;
    }
  }

  prompt += `\n--- VISUAL DIRECTION ---\n`;
  if (branding?.visual_style) {
    prompt += `Style: ${branding.visual_style}\n`;
  } else {
    prompt += `Style: Clean, modern, professional. Minimal and bold.\n`;
  }
  if (branding?.mood) {
    prompt += `Mood: ${branding.mood}\n`;
  }
  if (branding?.fonts?.headline || branding?.fonts?.body) {
    prompt += `Typography: Use brand fonts specified above.\n`;
  } else {
    prompt += `Typography: Strong headline font, clean sans-serif body text.\n`;
  }
  if (branding?.colors?.primary) {
    prompt += `Colors: Use the brand palette above (primary for dominant elements, accent for emphasis).\n`;
  } else {
    prompt += `Colors: Use brand colors if available, otherwise modern muted palette.\n`;
  }
  prompt += `Imagery: Subtle background graphics or abstract shapes. No stock photo cliches.\n`;

  if (branding?.dos || branding?.donts) {
    prompt += `\n--- BRAND GUIDELINES ---\n`;
    if (branding.dos) prompt += `DO: ${branding.dos}\n`;
    if (branding.donts) prompt += `DON'T: ${branding.donts}\n`;
  }

  if (rationale?.why_this_post) {
    prompt += `\n--- CONTEXT ---\n`;
    prompt += `Purpose: ${rationale.why_this_post}\n`;
  }
  if (rationale?.expected_outcome) {
    prompt += `Goal: ${rationale.expected_outcome}\n`;
  }

  if (asset.image_prompt) {
    prompt += `\n--- BACKGROUND IMAGE IDEA ---\n${asset.image_prompt}\n`;
  }

  prompt += `\n--- LAYOUT NOTES ---\n`;
  prompt += `- Text should be readable and prominent\n`;
  prompt += `- Leave breathing room around text elements\n`;
  prompt += `- Include a clear visual hierarchy (headline > body > CTA)\n`;
  if (logoUrl) {
    prompt += `- Place the logo in a corner or as a subtle watermark\n`;
  }
  if (format === "carousel") {
    prompt += `- First slide should hook attention, last slide should have a CTA\n`;
  }

  return prompt;
}

export type PlatformFormat = {
  label: string;
  format: (asset: Asset, branding?: Branding, logoUrl?: string) => string;
};

export const PLATFORM_FORMATS: PlatformFormat[] = [
  { label: "Raw Text", format: (a) => getAssetText(a) },
  { label: "Instagram", format: (a) => formatInstagram(getAssetText(a)) },
  { label: "LinkedIn", format: (a) => formatLinkedIn(getAssetText(a)) },
  { label: "Twitter/X", format: (a) => formatTwitter(getAssetText(a)) },
  { label: "Image Prompt", format: (a) => formatImagePrompt(a) },
  { label: "Canva AI", format: (a, b, l) => formatCanvaPrompt(a, b, l) },
  { label: "Creative Brief", format: (a) => formatCreativeBrief(a) },
];

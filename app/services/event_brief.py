"""Builds a full production brief for a Google Calendar event description.

Includes copy, brand kit, Canva prompt, image prompt, rationale, and a link
back to the app. Mirrors the frontend's formatCanvaPrompt but expanded
to a single description text suitable for Calendar events.
"""
from app.config.settings import settings


def _get_asset_text(asset: dict) -> str:
    content = asset.get("content")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for slide in content:
            if isinstance(slide, dict) and "text" in slide:
                parts.append(slide["text"])
            else:
                parts.append(str(slide))
        return "\n\n".join(parts)
    if isinstance(content, dict) and "text" in content:
        return content["text"]
    return str(content) if content else ""


def _design_spec(fmt: str | None) -> tuple[str, str]:
    mapping = {
        "static_graphic": ("Instagram Post", "1080x1080"),
        "carousel": ("Instagram Carousel", "1080x1080 per slide"),
        "story": ("Instagram Story", "1080x1920"),
        "reel_script": ("Instagram Reel Cover", "1080x1920"),
        "linkedin_post": ("LinkedIn Post", "1200x627"),
        "twitter_post": ("Twitter/X Post", "1600x900"),
        "infographic": ("Infographic", "800x2000"),
    }
    return mapping.get(fmt or "static_graphic", ("Social Media Post", "1080x1080"))


def build_event_title(asset: dict, campaign_title: str | None) -> str:
    asset_type = asset.get("type", "post").replace("_", " ").title()
    if campaign_title:
        return f"[{asset_type}] {campaign_title}"
    return f"[{asset_type}] Marketing"


def build_event_description(
    asset: dict,
    client: dict,
    campaign_title: str | None,
    run_id: str | None = None,
) -> str:
    """Return a plain-text production brief.

    Args:
        asset: asset dict with content, type, format, rationale, image_prompt
        client: dict with name, logo_url, branding
        campaign_title: optional campaign name
        run_id: optional run id for back-link
    """
    branding = client.get("branding") or {}
    logo_url = client.get("logo_url")
    fmt = asset.get("format") or "static_graphic"
    design_type, dimensions = _design_spec(fmt)
    text = _get_asset_text(asset)
    rationale = asset.get("rationale") or {}

    lines: list[str] = []
    lines.append(f"📋 POST: {campaign_title or 'Marketing Post'}")
    lines.append(f"Type: {asset.get('type', 'post')}  ·  Format: {fmt}")
    lines.append(f"Design: {design_type}  ·  Dimensions: {dimensions}")
    lines.append("")

    # Copy
    lines.append("━━━ COPY ━━━")
    if isinstance(asset.get("content"), list):
        for i, slide in enumerate(asset["content"]):
            if isinstance(slide, dict) and "text" in slide:
                lines.append(f"Slide {i+1}: {slide['text']}")
            else:
                lines.append(f"Slide {i+1}: {slide}")
    else:
        lines.append(text or "")
    lines.append("")

    # Brand kit
    colors = branding.get("colors") or {}
    fonts = branding.get("fonts") or {}
    has_brand = any([
        logo_url, colors.get("primary"), colors.get("secondary"), colors.get("accent"),
        fonts.get("headline"), fonts.get("body"),
        branding.get("visual_style"), branding.get("mood"),
        branding.get("dos"), branding.get("donts"),
    ])
    if has_brand:
        lines.append("━━━ BRAND KIT ━━━")
        if logo_url:
            lines.append(f"Logo: {logo_url}")
        color_parts = []
        if colors.get("primary"): color_parts.append(f"Primary {colors['primary']}")
        if colors.get("secondary"): color_parts.append(f"Secondary {colors['secondary']}")
        if colors.get("accent"): color_parts.append(f"Accent {colors['accent']}")
        if color_parts:
            lines.append(f"Colors: {' · '.join(color_parts)}")
        font_parts = []
        if fonts.get("headline"): font_parts.append(f"{fonts['headline']} (headline)")
        if fonts.get("body"): font_parts.append(f"{fonts['body']} (body)")
        if font_parts:
            lines.append(f"Fonts: {', '.join(font_parts)}")
        if branding.get("visual_style"):
            lines.append(f"Visual Style: {branding['visual_style']}")
        if branding.get("mood"):
            lines.append(f"Mood: {branding['mood']}")
        if branding.get("dos"):
            lines.append(f"DO: {branding['dos']}")
        if branding.get("donts"):
            lines.append(f"DON'T: {branding['donts']}")
        lines.append("")

    # Canva AI prompt (condensed inline form)
    lines.append("━━━ CANVA AI PROMPT ━━━")
    lines.append(f"Create a {design_type} ({dimensions}) with the following copy:")
    if text:
        snippet = text if len(text) < 500 else text[:497] + "..."
        lines.append(f'"{snippet}"')
    if colors.get("primary"):
        lines.append(
            f"Use brand colors — primary {colors.get('primary', '')}, "
            f"secondary {colors.get('secondary', '')}, accent {colors.get('accent', '')}."
        )
    if fonts.get("headline") or fonts.get("body"):
        lines.append(
            f"Typography — headline in {fonts.get('headline', 'sans-serif')}, "
            f"body in {fonts.get('body', 'sans-serif')}."
        )
    if branding.get("visual_style"):
        lines.append(f"Style: {branding['visual_style']}.")
    if logo_url:
        lines.append(f"Include the logo subtly: {logo_url}")
    lines.append("")

    # Image prompt (for Midjourney/DALL-E)
    image_prompt = asset.get("image_prompt")
    if image_prompt:
        lines.append("━━━ IMAGE PROMPT (Midjourney / DALL-E) ━━━")
        lines.append(image_prompt)
        lines.append("")

    # Rationale
    if rationale:
        lines.append("━━━ RATIONALE ━━━")
        if rationale.get("why_this_post"):
            lines.append(f"Why: {rationale['why_this_post']}")
        if rationale.get("why_this_format"):
            lines.append(f"Format: {rationale['why_this_format']}")
        if rationale.get("expected_outcome"):
            lines.append(f"Goal: {rationale['expected_outcome']}")
        lines.append("")

    # Back-link
    client_id = client.get("id")
    if client_id and run_id:
        lines.append(f"🔗 View in app: {settings.app_url}/clients/{client_id}/runs/{run_id}")

    return "\n".join(lines)

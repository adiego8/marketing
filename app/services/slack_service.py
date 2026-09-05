import logging

from slack_sdk.web.async_client import AsyncWebClient

from app.config.settings import settings

logger = logging.getLogger(__name__)

_client: AsyncWebClient | None = None


def get_slack_client() -> AsyncWebClient:
    global _client
    if _client is None:
        _client = AsyncWebClient(token=settings.slack_bot_token)
    return _client


def _build_asset_block(asset: dict, index: int, run_id: str) -> list[dict]:
    """Build Block Kit blocks for a single asset."""
    asset_type = asset.get("type", "unknown").upper().replace("_", " ")
    content = asset.get("content", "")
    fmt = asset.get("format", "")
    rationale = asset.get("rationale", {})

    blocks = []

    # Header
    header_text = f"*{asset_type}*"
    if fmt:
        header_text += f" — {fmt.replace('_', ' ').title()}"
    blocks.append({
        "type": "section",
        "text": {"type": "mrkdwn", "text": header_text},
    })

    # Content preview — handle both string and carousel (list of slides)
    if isinstance(content, list):
        # Carousel slides — render as numbered list
        slide_lines = []
        for slide in content:
            if isinstance(slide, dict):
                slide_num = slide.get("slide", "")
                slide_text = slide.get("text", "")
                slide_lines.append(f"*Slide {slide_num}:* {slide_text}")
            else:
                slide_lines.append(str(slide))
        preview = "\n".join(slide_lines)[:2000]
    elif isinstance(content, str):
        preview = content[:2000]
    else:
        preview = str(content)[:2000]

    blocks.append({
        "type": "section",
        "text": {"type": "mrkdwn", "text": preview},
    })

    # Rationale
    if rationale:
        why_post = rationale.get("why_this_post", "")
        why_format = rationale.get("why_this_format", "")
        expected = rationale.get("expected_outcome", "")
        rationale_text = ""
        if why_post:
            rationale_text += f"*WHY THIS POST:* {why_post}\n"
        if why_format:
            rationale_text += f"*WHY THIS FORMAT:* {why_format}\n"
        if expected:
            rationale_text += f"*EXPECTED OUTCOME:* {expected}"
        if rationale_text:
            blocks.append({
                "type": "section",
                "text": {"type": "mrkdwn", "text": rationale_text.strip()},
            })

    # Rating buttons + Save
    action_id_prefix = f"asset_{run_id}_{index}"
    blocks.append({
        "type": "actions",
        "elements": [
            *[
                {
                    "type": "button",
                    "text": {"type": "plain_text", "text": f"{'*' * i}", "emoji": True},
                    "action_id": f"rate_{action_id_prefix}_{i}",
                    "value": f'{{"run_id":"{run_id}","asset_index":{index},"rating":{i}}}',
                }
                for i in range(1, 6)
            ],
            {
                "type": "button",
                "text": {"type": "plain_text", "text": "Save"},
                "style": "primary",
                "action_id": f"save_{action_id_prefix}",
                "value": f'{{"run_id":"{run_id}","asset_index":{index}}}',
            },
        ],
    })

    # Feedback input
    blocks.append({
        "type": "input",
        "optional": True,
        "dispatch_action": True,
        "element": {
            "type": "plain_text_input",
            "action_id": f"feedback_{action_id_prefix}",
            "placeholder": {"type": "plain_text", "text": "Add feedback..."},
        },
        "label": {"type": "plain_text", "text": "Feedback"},
    })

    blocks.append({"type": "divider"})

    return blocks


def build_daily_brief_blocks(run_id: str, run_output: dict) -> list[dict]:
    """Build the full Block Kit message for a daily brief."""
    plan = run_output.get("planning", {})
    post_prod = run_output.get("post_production", {})
    assets = post_prod.get("produced_assets", [])

    # If no post production, fall back to review or generation output
    if not assets:
        review = run_output.get("review", {})
        assets = review.get("approved_assets", run_output.get("generation", {}).get("assets", []))

    topic = plan.get("topic", "Marketing content")
    angle = plan.get("angle", "")

    blocks = [
        {
            "type": "header",
            "text": {"type": "plain_text", "text": "Daily Marketing Run"},
        },
        {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": f"*Focus:* {topic}\n*Angle:* {angle}",
            },
        },
        {"type": "divider"},
    ]

    for i, asset in enumerate(assets):
        blocks.extend(_build_asset_block(asset, i, run_id))

    # Close & Debrief button
    blocks.append({
        "type": "actions",
        "elements": [
            {
                "type": "button",
                "text": {"type": "plain_text", "text": "Close & Debrief"},
                "style": "danger",
                "action_id": f"debrief_{run_id}",
                "value": f'{{"run_id":"{run_id}"}}',
                "confirm": {
                    "title": {"type": "plain_text", "text": "Close & Debrief?"},
                    "text": {
                        "type": "mrkdwn",
                        "text": "This will generate a debrief summary based on your feedback. Make sure you've rated all assets first.",
                    },
                    "confirm": {"type": "plain_text", "text": "Yes, debrief"},
                    "deny": {"type": "plain_text", "text": "Not yet"},
                },
            },
        ],
    })

    return blocks


async def post_daily_brief(channel: str, run_id: str, run_output: dict) -> str | None:
    """Post the daily brief to Slack. Returns the message timestamp."""
    client = get_slack_client()
    blocks = build_daily_brief_blocks(run_id, run_output)

    try:
        response = await client.chat_postMessage(
            channel=channel,
            text=f"Daily Marketing Run — {run_output.get('planning', {}).get('topic', 'New content')}",
            blocks=blocks,
        )
        message_ts = response.get("ts")
        logger.info("Daily brief posted to %s (ts=%s)", channel, message_ts)
        return message_ts
    except Exception as e:
        logger.exception("Failed to post daily brief: %s", e)
        return None


async def post_debrief(channel: str, thread_ts: str, debrief: dict) -> None:
    """Post the debrief summary as a thread reply."""
    client = get_slack_client()

    what_i_did = debrief.get("what_i_did", "")
    what_i_learned = debrief.get("what_i_learned", "")
    things_to_improve = debrief.get("things_to_improve", "")
    what_id_do_differently = debrief.get("what_id_do_differently", "")

    text = (
        "*DAILY DEBRIEF*\n\n"
        f"*WHAT I DID:*\n{what_i_did}\n\n"
        f"*WHAT I LEARNED:*\n{what_i_learned}\n\n"
        f"*THINGS TO IMPROVE:*\n{things_to_improve}\n\n"
        f"*WHAT I'D DO DIFFERENTLY:*\n{what_id_do_differently}"
    )

    try:
        await client.chat_postMessage(
            channel=channel,
            thread_ts=thread_ts,
            text=text,
        )
        logger.info("Debrief posted as thread reply (ts=%s)", thread_ts)
    except Exception as e:
        logger.exception("Failed to post debrief: %s", e)


async def upload_image(channel: str, image_data: bytes, filename: str, thread_ts: str | None = None) -> None:
    """Upload an image to a Slack channel."""
    client = get_slack_client()
    try:
        kwargs = {
            "channels": channel,
            "content": image_data,
            "filename": filename,
            "title": filename,
        }
        if thread_ts:
            kwargs["thread_ts"] = thread_ts
        await client.files_upload_v2(**kwargs)
    except Exception as e:
        logger.exception("Failed to upload image: %s", e)

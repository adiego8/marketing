import base64
import logging
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config.settings import settings
from app.db.models import Run
from app.services.pipeline.base import PipelineStep, RunContext, StepResult
from app.services.pipeline.registry import register_step
from app.services.slack_service import post_daily_brief, upload_image

logger = logging.getLogger(__name__)


def _decode_data_uri(data_uri: str) -> tuple[bytes, str]:
    """Decode a data URI (data:image/png;base64,...) into bytes and extension."""
    header, b64_data = data_uri.split(",", 1)
    mime = header.split(":")[1].split(";")[0]
    ext = mime.split("/")[1]
    return base64.b64decode(b64_data), ext


@register_step("deliver_slack")
class DeliverSlackStep(PipelineStep):
    """Posts the daily brief to Slack with images as an interactive Block Kit message."""

    async def execute(self, context: RunContext, config: dict) -> StepResult:
        channel = config.get("channel") or settings.slack_channel_id
        db: AsyncSession = context["db"]
        run_id = context["run_id"]

        # Build output from all prior steps
        run_output = {
            k: v for k, v in context.items() if k not in ("db", "run_id", "task_type")
        }

        message_ts = await post_daily_brief(channel, run_id, run_output)

        if message_ts:
            # Store message_ts on the run record for threading debrief later
            result = await db.execute(
                select(Run).where(Run.id == uuid.UUID(run_id))
            )
            run = result.scalar_one()
            run.slack_message_ts = message_ts
            await db.commit()

            # Upload generated images as thread replies
            await self._upload_images(channel, message_ts, run_output)

            logger.info("Slack delivery complete (ts=%s)", message_ts)
            return StepResult(output={"slack_message_ts": message_ts, "channel": channel})

        # Slack delivery is non-fatal — content is already generated and logged
        logger.warning("Slack delivery failed — run continues without it")
        return StepResult(
            output={"slack_message_ts": None, "channel": channel, "warning": "Slack delivery failed"},
        )

    async def _upload_images(self, channel: str, thread_ts: str, run_output: dict):
        """Upload all generated images as threaded replies in Slack."""
        pp = run_output.get("post_production", {})
        assets = pp.get("produced_assets", [])

        for i, asset in enumerate(assets):
            asset_type = asset.get("type", "unknown")
            images = asset.get("generated_images", [])

            for j, img_data in enumerate(images):
                if not img_data or not img_data.startswith("data:"):
                    continue

                try:
                    image_bytes, ext = _decode_data_uri(img_data)
                    filename = f"{asset_type}_{i+1}_v{j+1}.{ext}"
                    await upload_image(
                        channel=channel,
                        image_data=image_bytes,
                        filename=filename,
                        thread_ts=thread_ts,
                    )
                    logger.info("Uploaded image: %s (%d bytes)", filename, len(image_bytes))
                except Exception as e:
                    logger.warning("Failed to upload image for %s: %s", asset_type, e)

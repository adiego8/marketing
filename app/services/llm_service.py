import json
import logging
from pathlib import Path

import litellm

from app.config.settings import settings

logger = logging.getLogger(__name__)

PROMPTS_DIR = Path(__file__).parent.parent / "prompts"


def load_prompt(name: str) -> str:
    path = PROMPTS_DIR / f"{name}.md"
    if not path.exists():
        raise FileNotFoundError(f"Prompt template not found: {path}")
    return path.read_text()


async def llm_completion(
    system_prompt: str,
    user_prompt: str,
    json_mode: bool = False,
    model: str | None = None,
    temperature: float = 0.7,
) -> dict | str:
    """Call LLM via LiteLLM. Returns parsed dict if json_mode, else raw string."""
    model = model or settings.llm_model
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt},
    ]

    kwargs = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
        "api_key": settings.openai_api_key,
    }
    if json_mode:
        kwargs["response_format"] = {"type": "json_object"}

    logger.info("LLM call: model=%s, json_mode=%s", model, json_mode)
    response = await litellm.acompletion(**kwargs)
    content = response.choices[0].message.content

    if json_mode:
        return json.loads(content)
    return content


async def llm_image_generation(
    prompt: str,
    n: int = 1,
) -> list[str]:
    """Generate images via Google Gemini (Nano Banana).

    Uses the Gemini API to generate images. Returns list of base64 image data.
    Falls back to OpenAI if no Google AI key is configured.
    """
    import base64
    import httpx

    if settings.google_ai_api_key:
        return await _gemini_image_generation(prompt, n)
    else:
        return await _openai_image_generation(prompt, n)


async def _gemini_image_generation(prompt: str, n: int = 1) -> list[str]:
    """Generate images via Gemini API (Nano Banana model)."""
    import httpx

    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key={settings.google_ai_api_key}"

    payload = {
        "contents": [
            {
                "parts": [
                    {"text": prompt}
                ]
            }
        ],
        "generationConfig": {
            "responseModalities": ["TEXT", "IMAGE"],
        },
    }

    results = []
    async with httpx.AsyncClient(timeout=120) as client:
        for _ in range(n):
            response = await client.post(url, json=payload)
            response.raise_for_status()
            data = response.json()

            # Extract image data from Gemini response
            for candidate in data.get("candidates", []):
                for part in candidate.get("content", {}).get("parts", []):
                    if "inlineData" in part:
                        b64_data = part["inlineData"]["data"]
                        mime = part["inlineData"].get("mimeType", "image/png")
                        results.append(f"data:{mime};base64,{b64_data}")

    logger.info("Gemini image generation: %d images produced", len(results))
    return results


async def _openai_image_generation(prompt: str, n: int = 1) -> list[str]:
    """Fallback: generate images via OpenAI API."""
    import httpx

    async with httpx.AsyncClient(timeout=120) as client:
        response = await client.post(
            "https://api.openai.com/v1/images/generations",
            headers={
                "Authorization": f"Bearer {settings.openai_api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": "gpt-image-1.5",
                "prompt": prompt,
                "n": n,
                "size": "1024x1024",
            },
        )
        response.raise_for_status()
        data = response.json()

    return [item.get("url") or item.get("b64_json", "") for item in data.get("data", [])]

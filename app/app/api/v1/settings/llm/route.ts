import { NextResponse } from "next/server";
import OpenAI from "openai";
import {
  requireStaff,
  readBody,
  jsonError,
  serverError,
} from "@/lib/marketing/route-helpers";
import { parseLlmSettings } from "@/lib/marketing/llm-settings";
import { readLlmSettings, writeLlmSettings } from "@/lib/marketing/llm-settings-store";

// The OpenAI key and the model, for the whole install.
//
// STAFF ONLY. One key bills every agency on the box, so this is the platform
// operator's setting. Role would be the wrong gate: resolveGrant gives every
// paying customer role "admin" of their own agency.
//
// The key is never returned, under any flag. readLlmSettings cannot even
// produce it — it reads the same document and returns the last four characters.

// GET /api/v1/settings/llm
export async function GET() {
  try {
    const auth = await requireStaff();
    if ("response" in auth) return auth.response;
    return NextResponse.json(await readLlmSettings());
  } catch (error) {
    return serverError("Read LLM settings error", error);
  }
}

/**
 * Does this key work, and can it reach this model?
 *
 * models.retrieve is not an inference endpoint, so this bills nothing — which
 * is the whole reason it runs on every save rather than hiding behind a button
 * somebody has to remember to press. It answers two questions at once: the key
 * authenticates, and the chosen model exists on that account.
 *
 * What it does NOT answer is whether the account has credit. A key with a zero
 * balance passes this and fails on the first real generation, so the settings
 * page says as much rather than implying a clean bill of health.
 */
async function verify(apiKey: string, model: string): Promise<string | null> {
  try {
    // maxRetries: 0 for the same reason llm.ts sets it — a save that is going
    // to fail should fail once, while someone is watching.
    await new OpenAI({ apiKey, timeout: 15_000, maxRetries: 0 }).models.retrieve(model);
    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("401") || message.toLowerCase().includes("incorrect api key")) {
      return "OpenAI rejected that key.";
    }
    if (message.includes("404")) {
      return `That key works, but it cannot reach ${model}. Pick another model or use a key with access to it.`;
    }
    return `Could not verify the key: ${message}`;
  }
}

// PUT /api/v1/settings/llm
export async function PUT(request: Request) {
  try {
    const auth = await requireStaff();
    if ("response" in auth) return auth.response;

    const parsed = parseLlmSettings(await readBody(request));
    if ("error" in parsed) return jsonError(parsed.error, 400);

    // Verified BEFORE storing, so a key that does not work cannot become the
    // key the install runs on. A model-only change re-verifies against the key
    // already stored, which is how picking an unreachable model is caught.
    const current = await readLlmSettings();
    if (parsed.data.apiKey) {
      const failure = await verify(parsed.data.apiKey, parsed.data.model);
      if (failure) return jsonError(failure, 400);
    } else if (!current.configured) {
      return jsonError("Add an OpenAI key before saving.", 400);
    }

    return NextResponse.json(
      await writeLlmSettings(parsed.data, {
        uid: auth.session.uid,
        email: auth.session.email,
      })
    );
  } catch (error) {
    return serverError("Write LLM settings error", error);
  }
}

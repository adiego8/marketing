// Reading and writing the install's OpenAI key and model choice.
//
// Split from llm-settings.ts the way api-keys-store.ts is split from
// api-keys.ts: the shape rules are pure and tested, and this half touches
// Firestore and therefore is not. Here the split also decides what ends up in
// the browser bundle — the settings page imports LLM_MODELS from the pure half
// and must not import firebase-admin along with it.

import { db, COLLECTIONS, FieldValue } from "../firestore";
import { encrypt, decrypt, keyHint } from "./secrets";
import { modelFor, type LlmSettingsInput } from "./llm-settings";

/** One document, because there is one install. */
const DOC_ID = "llm";

/** What the app runs on. The key is decrypted here and nowhere else. */
export interface LlmConfig {
  /** null when nothing is configured; every caller must refuse rather than guess. */
  apiKey: string | null;
  model: string;
  researchModel: string;
}

/** What the settings page is allowed to see. Never the key. */
export interface LlmSettingsView {
  configured: boolean;
  key_hint: string;
  model: string;
  research_model: string;
  updated_at: string | null;
  updated_by: string | null;
}

async function readDoc(): Promise<Record<string, unknown> | null> {
  const snap = await db().collection(COLLECTIONS.settings).doc(DOC_ID).get();
  return snap.exists ? (snap.data() ?? {}) : null;
}

/**
 * The key and models the next call should use.
 *
 * Read per call rather than cached. One Firestore get costs milliseconds
 * against a model call that takes tens of seconds, and a cache would buy that
 * nothing while introducing a staleness window someone has to be told about —
 * the entire point of moving this out of env was that a change takes effect.
 */
export async function readLlmConfig(): Promise<LlmConfig> {
  const d = await readDoc();
  const enc = d?.apiKeyEnc;
  return {
    apiKey: typeof enc === "string" && enc ? decrypt(enc) : null,
    model: modelFor(d?.model),
    researchModel: modelFor(d?.researchModel),
  };
}

export async function readLlmSettings(): Promise<LlmSettingsView> {
  const d = await readDoc();
  const updatedAt = d?.updatedAt;
  return {
    configured: typeof d?.apiKeyEnc === "string" && d.apiKeyEnc.length > 0,
    key_hint: typeof d?.keyHint === "string" ? d.keyHint : "",
    model: modelFor(d?.model),
    research_model: modelFor(d?.researchModel),
    updated_at:
      updatedAt && typeof updatedAt === "object" && "toDate" in updatedAt
        ? (updatedAt as { toDate(): Date }).toDate().toISOString()
        : null,
    updated_by: typeof d?.updatedByEmail === "string" ? d.updatedByEmail : null,
  };
}

export async function writeLlmSettings(
  input: LlmSettingsInput,
  by: { uid: string; email: string | null }
): Promise<LlmSettingsView> {
  await db()
    .collection(COLLECTIONS.settings)
    .doc(DOC_ID)
    .set(
      {
        model: input.model,
        researchModel: input.researchModel,
        // Spread, so saving a model change leaves the stored key untouched.
        ...(input.apiKey
          ? { apiKeyEnc: encrypt(input.apiKey), keyHint: keyHint(input.apiKey) }
          : {}),
        updatedAt: FieldValue.serverTimestamp(),
        updatedByUid: by.uid,
        updatedByEmail: by.email,
      },
      { merge: true }
    );
  return readLlmSettings();
}

import { describe, it, expect } from "vitest";
import { CAMPAIGN_GENERATOR_PROMPT, CAMPAIGN_IMPROVER_PROMPT } from "./prompts";
import {
  PLANNER_DECIDE_PROMPT,
  REPLACE_DROPPED_PROMPT,
  REGENERATE_SLOT_PROMPT,
  WRITE_COPY_PROMPT,
} from "./planner/prompt";

/**
 * The feedback loop's silent failure mode.
 *
 * Every generation payload carries a `lessons` array. If a prompt stops telling
 * the model what that key is, nothing breaks: the payload is still well formed,
 * the call still succeeds, and the model quietly ignores a field it was never
 * introduced to. The rules a client spent weeks teaching stop applying and
 * nothing anywhere says so.
 *
 * These assert the pairing — payload key against prompt instruction — because
 * it is the only half of the contract a test can reach. Whether the model then
 * obeys the rule is not knowable from here.
 */

const GENERATION_PROMPTS: [string, string][] = [
  ["PLANNER_DECIDE_PROMPT", PLANNER_DECIDE_PROMPT],
  ["REPLACE_DROPPED_PROMPT", REPLACE_DROPPED_PROMPT],
  ["REGENERATE_SLOT_PROMPT", REGENERATE_SLOT_PROMPT],
  ["WRITE_COPY_PROMPT", WRITE_COPY_PROMPT],
  ["CAMPAIGN_GENERATOR_PROMPT", CAMPAIGN_GENERATOR_PROMPT],
  ["CAMPAIGN_IMPROVER_PROMPT", CAMPAIGN_IMPROVER_PROMPT],
];

describe("every generation prompt knows about lessons", () => {
  it.each(GENERATION_PROMPTS)("%s names the key", (_name, prompt) => {
    expect(prompt).toContain("lessons");
  });

  // Naming it is not enough — it has to be binding, or it reads as one more
  // piece of context to weigh rather than a rule to follow.
  it.each(GENERATION_PROMPTS)("%s says to follow them", (_name, prompt) => {
    expect(prompt.toLowerCase()).toMatch(/follow every rule in .?lessons/);
  });

  // An empty list is the normal state for a new client, and "no rules yet" must
  // not read as "no rules apply".
  it.each(GENERATION_PROMPTS)("%s says what an empty list means", (_name, prompt) => {
    expect(prompt.toLowerCase()).toContain("empty list");
  });
});

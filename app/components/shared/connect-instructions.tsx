"use client";

import { useSyncExternalStore } from "react";
import { CopyButton } from "@/components/shared/copy-button";
import { surface, text } from "@/lib/ui";

/**
 * Setup instructions written to be PASTED INTO AN ASSISTANT, not followed by
 * hand.
 *
 * The audience is an operator who does not want to know what a JSON config file
 * is. A snippet to paste into claude_desktop_config.json assumes they can find
 * that file, understand JSON, and merge rather than overwrite — three chances
 * to fail before anything works. A paragraph pasted into Claude moves all three
 * to something good at them.
 *
 * THE KEY IS NOT IN THIS TEXT, and that is the whole design.
 *
 * An earlier version inlined it, which was wrong: a secret pasted into a prompt
 * is in that conversation's history permanently, syncs wherever the history
 * syncs, and cannot be unsaid. So the operator saves the key to a file, and
 * these instructions carry only the PATH. Every command below reads the key
 * through the shell or a script, so it never appears in anything the assistant
 * prints either — which is the second half of the same problem, since a tool
 * call echoing `--header "Bearer sk-..."` puts it right back in the transcript.
 *
 * One honest limit, stated in the text itself: Claude Desktop cannot edit its
 * own config, so pasting this there gets guidance rather than installation.
 * Claude Code can do it, and can configure Desktop too.
 */

/** Suggested, not enforced — the operator tells the assistant where it really is. */
export const DEFAULT_KEY_PATH = "~/.numerico/marketing-key";

/** The origin never changes within a page's life, so there is nothing to watch. */
const subscribeNever = () => () => {};
const readOrigin = () => window.location.origin;
const readNothing = () => "";

export function connectionInstructions(
  url: string,
  keyPath: string = DEFAULT_KEY_PATH
): string {
  return `Please connect me to my Numerico Marketing workspace.

It is an MCP server that knows what my marketing clients are scheduled to
publish, the finished copy for each piece, and how each client's brand sounds.
Which clients the key reaches is a property of the key, so ask the server —
do not assume.

  Server URL:  ${url}
  API key:     in a file on my machine, at ${keyPath}

IMPORTANT — how to handle the key:
Do not ask me to paste it into this conversation, and never print it back to
me. Read it from the file, and pass it through the shell so it does not appear
in any command you show me either. If the file is not where I said, ask me for
the right path.

Steps:

1. If you are Claude Code, connect with this — the $(cat ...) is deliberate,
   it keeps the key out of your output:

   claude mcp add --transport http numerico-marketing ${url} --header "Authorization: Bearer $(cat ${keyPath})"

2. If you can edit files on my computer, set up Claude Desktop too. Its config
   lives at:
     macOS    ~/Library/Application Support/Claude/claude_desktop_config.json
     Windows  %APPDATA%\\Claude\\claude_desktop_config.json

   Run a short script rather than writing the key by hand, so it is read from
   the file and never printed. This MERGES into whatever is already there —
   do not replace the file. Run it exactly as written, starting at column one:

python3 - <<'PY'
import json, os, pathlib
key = pathlib.Path(os.path.expanduser("${keyPath}")).read_text().strip()
cfg = pathlib.Path(os.path.expanduser(
    "~/Library/Application Support/Claude/claude_desktop_config.json"))
data = json.loads(cfg.read_text()) if cfg.exists() else {}
data.setdefault("mcpServers", {})["numerico-marketing"] = {
    "command": "npx",
    "args": ["-y", "mcp-remote", "${url}",
             "--header", f"Authorization: Bearer {key}"],
}
cfg.parent.mkdir(parents=True, exist_ok=True)
cfg.write_text(json.dumps(data, indent=2))
print("Claude Desktop configured.")
PY

   Then tell me to quit and reopen Claude Desktop — it only reads that file at
   startup.

3. If you can do neither, say so plainly and walk me through step 2 one step at
   a time.

Once connected, confirm it works by listing my clients, and tell me which ones
you can see and what each is scheduled to publish this week.`;
}

export function ConnectInstructions({
  keyPath,
  title = "Connect an assistant",
  hint,
}: {
  keyPath?: string;
  title?: string;
  hint?: string;
}) {
  // The deployed origin, which the operator needs and we cannot know at build
  // time. useSyncExternalStore rather than an effect: it takes an explicit
  // server snapshot, so the server pass renders the placeholder and the client
  // renders the real origin with no hydration mismatch and no second render.
  const origin = useSyncExternalStore(subscribeNever, readOrigin, readNothing);

  const url = `${origin || "https://your-marketing-domain"}/api/mcp`;
  const instructions = connectionInstructions(url, keyPath);

  return (
    <div className={`${surface.inset} mt-4`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className={text.cardTitle}>{title}</p>
          <p className={`${text.micro} mt-0.5`}>
            {hint ??
              "Save your key to a file first, then paste this into Claude. It contains no secret — only the path."}
          </p>
        </div>
        <CopyButton
          text={instructions}
          label="Copy instructions"
          variant="outline"
          className="shrink-0"
        />
      </div>
      <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-slate-200 bg-white p-3 font-mono text-[11px] leading-relaxed text-slate-700">
        {instructions}
      </pre>
    </div>
  );
}

/**
 * Where to put the key, shown beside it at the one moment it is visible.
 *
 * Deliberately not a copyable `echo "$KEY" > file` command: that would put the
 * secret into shell history, which is the same mistake as putting it into a
 * prompt, one file further along.
 */
export function SaveKeyFirst({ keyPath = DEFAULT_KEY_PATH }: { keyPath?: string }) {
  return (
    <div className="mt-3 rounded-lg border border-teal-200 bg-white px-3 py-2">
      <p className="text-xs font-semibold text-slate-800">Save it to a file</p>
      <p className={`${text.micro} mt-0.5`}>
        Create <code className="font-mono">{keyPath}</code>, paste the key in as the
        only line, and make it readable by you alone
        (<code className="font-mono">chmod 600 {keyPath}</code>). The instructions
        below point an assistant at that file, so the key itself never goes into a
        chat.
      </p>
    </div>
  );
}

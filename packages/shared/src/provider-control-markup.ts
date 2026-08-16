/**
 * Provider protocol markup, recognised precisely and removed.
 *
 * Some models emit their tool-call protocol as ordinary content instead of in
 * the structured `tool_calls` field. DeepSeek does it with a fullwidth-pipe
 * dialect that reached a real user's transcript:
 *
 *     <｜｜DSML｜｜tool_calls>
 *     <｜｜DSML｜｜invoke name="list_library_files">
 *     <｜｜DSML｜｜parameter name="folder_id" string="true">cmss…</｜｜DSML｜｜parameter>
 *     </｜｜DSML｜｜invoke>
 *     </｜｜DSML｜｜tool_calls>
 *
 * The existing stripper missed it for a precise reason worth recording: its
 * patterns start `<\s*tool_calls?`, and this tag starts `<` followed by U+FF5C
 * FULLWIDTH VERTICAL LINE, not whitespace. Same concept, different codepoint.
 *
 * **Why not just strip everything between `<` and `>`.** Assistants legitimately
 * write HTML, XML, JSX, generics like `Array<string>`, and comparisons like
 * `a < b`. A blunt rule would quietly corrupt every one of those. So each
 * pattern here matches a *named* protocol construct: the DSML dialect, or a
 * special token whose contents cannot occur in prose — fullwidth pipes, or the
 * sentencepiece marker U+2581 (▁) that tokenisers use and writers never do.
 */

/** U+FF5C, the fullwidth vertical line DeepSeek builds its tags from. */
const FW = "｜"
/** U+2581, the sentencepiece word-boundary marker inside control tokens. */
const SP = "▁"

/**
 * Special tokens written with ASCII pipes.
 *
 * Only these names, because `<|…|>` is *nearly* impossible in prose but not
 * quite — and an allowlist costs nothing next to mangling someone's document.
 */
const ASCII_SPECIAL_TOKEN =
  /<\|(?:\/?(?:tool|function)[a-z_▁]*(?:call|calls|output|outputs|sep|begin|end)[a-z_▁]*|im_start|im_end|eot_id|eom_id|bos|eos|start_header_id|end_header_id|python_tag|channel|begin_of_text|end_of_text|DSML[^|]*)\|>/gi

/** Any special token containing the sentencepiece marker, whatever its name. */
const SENTENCEPIECE_TOKEN = new RegExp(`<[|${FW}][^<>]*${SP}[^<>]*[|${FW}]>`, "g")

/** `<｜…｜>` — fullwidth pipes never appear in ordinary writing. */
const FULLWIDTH_SPECIAL_TOKEN = new RegExp(`<${FW}[^<>${FW}]*${FW}>`, "g")

/** A complete DSML block, contents included — those are arguments, not prose. */
const DSML_BLOCK = new RegExp(
  `<${FW}{1,2}DSML${FW}{1,2}(tool_calls|invoke|parameter|antml)\\b[^>]*>[\\s\\S]*?</${FW}{1,2}DSML${FW}{1,2}\\1\\s*>`,
  "gi",
)

/** Any lone DSML tag left over — a stray close, or a self-contained marker. */
const DSML_TAG = new RegExp(`</?${FW}{1,2}DSML${FW}{1,2}[^>]*>`, "gi")

/**
 * A DSML block that has not finished arriving.
 *
 * Everything from the opening tag onward is withheld while it streams;
 * once the closing tag lands, `DSML_BLOCK` removes the pair instead.
 */
const DSML_UNCLOSED = new RegExp(`<${FW}{1,2}DSML${FW}{1,2}[\\s\\S]*$`, "i")

/** Recognised protocol markup, gone. Everything else is left exactly as written. */
export function stripProviderControlMarkup(text: string): string {
  if (!text) return text
  // Cheap bail-out: the overwhelming majority of replies contain none of this.
  if (!text.includes("<")) return text

  return text
    .replace(DSML_BLOCK, "")
    .replace(DSML_UNCLOSED, "")
    .replace(DSML_TAG, "")
    .replace(SENTENCEPIECE_TOKEN, "")
    .replace(FULLWIDTH_SPECIAL_TOKEN, "")
    .replace(ASCII_SPECIAL_TOKEN, "")
}

/** True when the text carries protocol markup that must never reach a reader. */
export function hasProviderControlMarkup(text: string): boolean {
  return Boolean(text) && stripProviderControlMarkup(text) !== text
}

/**
 * The tail that might be a half-arrived control token.
 *
 * Streaming splits tags across chunks, so `<｜｜DSM` can be emitted before the
 * rest of it exists — visible for a moment, and impossible to take back. This
 * withholds a suspicious trailing fragment until the next chunk decides what it
 * is. The held part is at most a few characters, so nothing perceptible is lost.
 */
export function splitStreamableText(text: string): { safe: string; held: string } {
  if (!text) return { safe: text, held: "" }
  const lastOpen = text.lastIndexOf("<")
  if (lastOpen === -1) return { safe: text, held: "" }

  const tail = text.slice(lastOpen)
  // A completed tag is not a fragment — let the strippers judge it instead.
  if (tail.includes(">")) return { safe: text, held: "" }
  // Only hold what could still become a control token. `<div class="a` is
  // ordinary markup mid-write and must keep flowing.
  const looksLikeControlStart = new RegExp(
    `^<(?:[|${FW}]|$)|^<[|${FW}][^<>]*$`,
  ).test(tail)
  if (!looksLikeControlStart) return { safe: text, held: "" }

  return { safe: text.slice(0, lastOpen), held: tail }
}

export type ParsedProviderToolCall = {
  name: string
  arguments: Record<string, unknown>
}

/**
 * Read tool calls out of DSML that arrived as content.
 *
 * When a model writes its invocation into the reply instead of the structured
 * field, the call is simply lost — the user sees markup and nothing happens.
 * Recovering it means the request the model actually made still runs, which is
 * the difference between "the assistant said it would list the folder" and it
 * having listed the folder.
 *
 * Values are taken verbatim. Ids in particular are opaque and must never be
 * normalised on the way through.
 */
export function parseDsmlToolCalls(text: string): ParsedProviderToolCall[] {
  if (!text || !text.includes("DSML")) return []

  const out: ParsedProviderToolCall[] = []
  const invokeRe = new RegExp(
    `<${FW}{1,2}DSML${FW}{1,2}invoke\\s+name=["']([^"']+)["'][^>]*>([\\s\\S]*?)</${FW}{1,2}DSML${FW}{1,2}invoke\\s*>`,
    "gi",
  )
  const paramRe = new RegExp(
    `<${FW}{1,2}DSML${FW}{1,2}parameter\\s+name=["']([^"']+)["'][^>]*>([\\s\\S]*?)</${FW}{1,2}DSML${FW}{1,2}parameter\\s*>`,
    "gi",
  )

  let invoke: RegExpExecArray | null
  while ((invoke = invokeRe.exec(text)) !== null) {
    const name = invoke[1]!.trim()
    const body = invoke[2] ?? ""
    const args: Record<string, unknown> = {}

    paramRe.lastIndex = 0
    let param: RegExpExecArray | null
    while ((param = paramRe.exec(body)) !== null) {
      const key = param[1]!.trim()
      const raw = (param[2] ?? "").trim()
      // JSON where it is JSON (numbers, arrays of moves), string otherwise.
      if (raw.startsWith("[") || raw.startsWith("{")) {
        try {
          args[key] = JSON.parse(raw)
          continue
        } catch {
          /* not JSON after all — keep the text */
        }
      }
      if (/^-?\d+(?:\.\d+)?$/.test(raw)) {
        args[key] = Number(raw)
        continue
      }
      if (raw === "true" || raw === "false") {
        args[key] = raw === "true"
        continue
      }
      args[key] = raw
    }

    if (name) out.push({ name, arguments: args })
  }

  return out
}

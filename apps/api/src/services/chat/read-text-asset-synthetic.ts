const CODE_FILE_RE = /\b([a-zA-Z0-9][a-zA-Z0-9_.-]*\.(?:py|pyw|js|ts|tsx|jsx|sh|json|md|txt|yaml|yml))\b/i

/** Text-ish docs we can open via read_text_asset (incl. simple OOXML as utf8 extract). */
const DOC_FILE_RE =
  /\b([a-zA-Z0-9][a-zA-Z0-9_.\s-]*\.(?:docx?|xlsx?|pptx?|odt|csv|rtf|txt|md|json))\b/i

const SHORT_FOLLOWUP_RE =
  /^(?:tell me|explain(?:\s+it)?|what does it do|go on|continue|yes|ok|okay|please)\s*[.!?]*$/i

/** User wants to open/read/explain a source file from chat. */
export function isExplicitReadTextAssetMessage(
  userText: string,
  priorUserContext = "",
): boolean {
  const t = userText.toLowerCase()
  const combined = `${userText}\n${priorUserContext}`

  if (
    SHORT_FOLLOWUP_RE.test(userText.trim()) &&
    (CODE_FILE_RE.test(priorUserContext) || DOC_FILE_RE.test(priorUserContext))
  ) {
    return true
  }

  // Slash-command expansions — never steal PDF turns from read_pdf_asset.
  if (/\.pdf\b/i.test(userText) && /\bread_pdf_asset\b|Summarize ONLY\b|summarize\b/i.test(userText)) {
    return false
  }
  if (/\bread_text_asset\b|Read ONLY the file\b/i.test(userText)) {
    return CODE_FILE_RE.test(combined) || DOC_FILE_RE.test(combined) || /\bfile named\b/i.test(t)
  }

  if (/\b(open|read|show|view|inspect|explain|describe|what does|tell me about|summarize)\b/.test(t)) {
    return (
      CODE_FILE_RE.test(combined) ||
      DOC_FILE_RE.test(combined) ||
      /\b(script|code file|python file|\.py)\b/.test(combined)
    )
  }
  if (/\bprime_finder|main\.py\b/i.test(combined)) return true
  return false
}

export function extractFilenameForReadRequest(userText: string): string | null {
  const explicit = userText.match(CODE_FILE_RE)?.[1] ?? userText.match(DOC_FILE_RE)?.[1]
  if (explicit) return explicit.trim()

  const quoted = userText.match(/Read ONLY the file\s+"([^"]+)"/i)?.[1]
  if (quoted) return quoted.trim()

  if (/\bprime_finder\b/i.test(userText)) return "prime_finder.py"

  return null
}

export function buildSyntheticReadTextAssetArgsFromUser(
  userText: string,
  priorUserTexts: string[] = [],
): { filename?: string; asset_id?: string } | null {
  const priorContext = priorUserTexts.join("\n")
  if (!isExplicitReadTextAssetMessage(userText, priorContext)) return null

  let filename = extractFilenameForReadRequest(userText)
  if (!filename) {
    for (let i = priorUserTexts.length - 1; i >= 0; i--) {
      filename = extractFilenameForReadRequest(priorUserTexts[i] ?? "")
      if (filename) break
    }
  }
  if (!filename) return null
  return { filename }
}

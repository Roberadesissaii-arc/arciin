/** Normalize chat phrasing to a short visual subject (e.g. "graduation"). */
export function normalizeVisionSearchQuery(raw: string): string {
  let t = raw.trim().replace(/[?!.,]+/g, " ").replace(/\s+/g, " ")
  if (!t) return t

  t = t.replace(/^(hey|hi|hello|okay|ok)\s*,?\s*/i, "")

  const ofEarly = t.match(
    /\b(?:image|picture|photo|pic)s?\s+of\s+(?:a|an|the)?\s*(.+?)(?:\s+in\s+(?:my\s+)?library)?$/i,
  )
  if (ofEarly?.[1]) {
    const subject = cleanSubjectToken(ofEarly[1])
    if (subject.length >= 2) return subject.slice(0, 500)
  }

  const trailingSubject = t.match(
    /\b([a-z][\w\s-]{0,48}?)\s+(?:image|picture|photo|pic)s?\s*$/i,
  )
  if (trailingSubject?.[1]) {
    const subject = cleanSubjectToken(trailingSubject[1])
    if (subject.length >= 2 && subject.split(/\s+/).length <= 5) {
      return subject.slice(0, 500)
    }
  }

  let q = t
    .replace(/\b(hey|hi|hello)\b/gi, " ")
    .replace(/\b(can you|could you|can|please|help me)\b/gi, " ")
    .replace(
      /\b(find|search for|search|look for|locate|show me|get me|where is|do you have)\s+(me\s+)?(a|an|any|the|some)?\s*/gi,
      " ",
    )
    .replace(/\b(?:an?\s+)?(?:image|picture|photo|pic)s?\s+of\s+(?:a|an|the)?\s*/gi, " ")
    .replace(/\b(?:image|picture|photo|pic)s?\b/gi, " ")
    .replace(/\b(in\s+my\s+library|from\s+my\s+library)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim()

  q = cleanSubjectToken(q)
  if (q.length >= 2) return q.slice(0, 500)
  return cleanSubjectToken(t).slice(0, 500)
}

function cleanSubjectToken(value: string): string {
  return value
    .replace(/\b(hey|hi|can you|could you|can|please|find me|get me|show me|a|an|the|some|my|me|you)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
}

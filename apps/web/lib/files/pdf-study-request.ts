/**
 * Making a study request actually produce marks and notes.
 *
 * The control tags are documented in the focused-PDF system prompt, and models
 * ignore them there. Measured against the real endpoint: "Explain this page to
 * me" with the full 10.6 KB system block returned 1,999 characters of good prose
 * and **zero** tags. The same request with the same instruction restated in the
 * user turn returned three marks and four notes, every target verbatim.
 *
 * The difference is position, not wording. Buried in a long system message that
 * also carries page text, settings and security rules, an output-format demand
 * loses to the model's instinct to answer conversationally. Adjacent to the
 * user's own words it wins.
 *
 * So this is a mechanism rather than a stronger request: when a turn asks for
 * teaching, the requirement travels with the turn. The same trick the codebase
 * already uses for attached files.
 */

/** Requests that should leave marks on the page rather than only prose. */
const STUDY_REQUEST =
  /\b(?:explain|teach|walk\s+me\s+through|break\s+(?:this|it)\s+down|study\s+notes?|make\s+notes?|take\s+notes?|annotate|mark\s+up|summari[sz]e\s+this\s+page|important\s+parts?|key\s+points?|what\s+(?:should|do)\s+i\s+(?:remember|know|revise)|tested\s+on|exam|revise|revision)\b/i

/** Asking about a word or a fact is not asking to be taught the page. */
const NOT_A_STUDY_REQUEST =
  /^(?:what\s+page|which\s+page|how\s+many\s+pages|what\s+is\s+the\s+(?:title|author|filename)|who\s+wrote)\b/i

export function isStudyAnnotationRequest(userText: string): boolean {
  const t = (userText || "").trim()
  if (!t) return false
  if (NOT_A_STUDY_REQUEST.test(t)) return false
  return STUDY_REQUEST.test(t)
}

export type StudyPassShape = {
  /** Mostly marks, few notes — "show me the important parts". */
  emphasis: "marks" | "notes" | "balanced"
  /** Plainer language for a beginner, exam framing for revision. */
  voice: "plain" | "exam" | "normal"
}

export function studyPassShape(userText: string): StudyPassShape {
  const t = (userText || "").toLowerCase()
  const emphasis: StudyPassShape["emphasis"] = /\b(important\s+parts?|key\s+points?|show\s+me|highlight)\b/.test(t)
    ? "marks"
    : /\b(explain|teach|walk\s+me\s+through|break\s+.*down|beginner|simply|simple)\b/.test(t)
      ? "notes"
      : "balanced"
  const voice: StudyPassShape["voice"] = /\b(exam|tested|revise|revision|remember)\b/.test(t)
    ? "exam"
    : /\b(beginner|simply|simple|like\s+i'?m\s+(?:a\s+)?(?:five|new|beginner))\b/.test(t)
      ? "plain"
      : "normal"
  return { emphasis, voice }
}

/**
 * The block appended to the outgoing user message.
 *
 * Short on purpose. It restates only what the model has to *do*; the full
 * vocabulary is already in the system prompt, and repeating all of it here would
 * recreate the wall of text that failed.
 */
export function buildStudyPassInstruction(
  userText: string,
  options: { page?: number; scope?: string | null } = {},
): string {
  const { emphasis, voice } = studyPassShape(userText)
  const marks = emphasis === "marks" ? "3 to 5" : emphasis === "notes" ? "1 to 2" : "2 to 4"
  const notes = emphasis === "notes" ? "3 to 4" : emphasis === "marks" ? "1" : "2 to 3"

  const voiceLine =
    voice === "exam"
      ? "Favour definitions, relationships and the things most likely to be examined."
      : voice === "plain"
        ? "Use plain words a beginner would follow. Short sentences."
        : "Explain what the page leaves unsaid; do not restate headings."

  const scopeLine = options.scope
    ? `Annotate ONLY the part of the page about: "${options.scope}". Ignore the rest of the page.`
    : options.page
      ? `Work on PDF page ${options.page}, which is the page in view.`
      : ""

  return [
    "",
    "",
    "[STUDY PASS — REQUIRED OUTPUT]",
    "Do not answer only in prose. You MUST mark up the page with control tags, or the student sees nothing.",
    scopeLine,
    `Emit, each on its own line, before your reply:`,
    `- ${marks} marks: [highlight-current:"exact text"] / [circle-heading:"exact heading"] / [underline-current:"exact text"]`,
    `- ${notes} notes: [note:important:"exact text it points at":"short handwritten note"]`,
    `  (kinds: note · important · warning · definition · connection)`,
    `- optionally one [note:summary:"":"one-line recap"]`,
    "Targets MUST be copied verbatim from the page text you were given.",
    'NEVER target words from this request. "the key terms", "each one" describe the job —',
    "work out which real terms on the page they mean, and target those.",
    "Asked to explain what you mark, pair each mark with a note on the SAME target.",
    voiceLine,
    "Then two or three sentences of reply. The tags are stripped before the student reads it.",
  ]
    .filter((line) => line !== null && line !== undefined)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
}

/** Instruction for redoing one note the student did not understand. */
export function buildRegenerateNoteInstruction(input: {
  text: string
  target: string
  ask: string
}): string {
  return [
    "",
    "",
    "[REWRITE ONE NOTE — REQUIRED OUTPUT]",
    `The student is looking at your handwritten note "${input.text}" on "${input.target}" and says: ${input.ask}`,
    "Write ONE replacement note for that same target. Emit exactly one tag:",
    `[note:<kind>:"${input.target}":"your new note"]`,
    "Keep it short enough to read in a margin — under about twenty words.",
    "Do not re-annotate the rest of the page, and do not emit any other tag.",
  ].join("\n")
}

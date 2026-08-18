/**
 * Turn provider / API failures into short toast copy.
 *
 * Gemini often returns a huge JSON blob (quota, RESOURCE_EXHAUSTED). Readers
 * should see one calm sentence, not billing docs and metric names.
 */

function extractRawMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === "string") return error
  return ""
}

function looksLikeQuota(raw: string): boolean {
  return /RESOURCE_EXHAUSTED|exceeded your current quota|quota exceeded|rate[- ]?limit|GenerateRequestsPerDay|free_tier|429/i.test(
    raw,
  )
}

function looksLikeBilling(raw: string): boolean {
  return /billing|plan and billing|payment/i.test(raw)
}

function looksLikeNotConfigured(raw: string): boolean {
  return /not configured|GEMINI_NOT_CONFIGURED|add a gemini/i.test(raw)
}

function looksLikeNoTranscript(raw: string): boolean {
  return /NO_TRANSCRIPT|transcript first/i.test(raw)
}

/**
 * Short title + optional description for Sonner / Assist toasts.
 */
export function friendlyAiError(
  error: unknown,
  fallback = { title: "Something went wrong", description: "Try again in a moment." },
): { title: string; description?: string } {
  const raw = extractRawMessage(error)

  if (looksLikeNotConfigured(raw)) {
    return {
      title: "Gemini isn’t set up",
      description: "Add a Gemini key under Models, then try again.",
    }
  }

  if (looksLikeQuota(raw) || looksLikeBilling(raw)) {
    // Prefer a gentle retry hint when the provider includes one.
    const retryMatch = raw.match(/retry in\s+(\d+(?:\.\d+)?)\s*s/i)
    const seconds = retryMatch ? Math.ceil(Number(retryMatch[1])) : null
    return {
      title: "AI limit reached",
      description: seconds
        ? `Your Gemini quota is used up for now. Try again in about ${seconds}s.`
        : "Your Gemini quota is used up for now. Try again later, or check your plan under Models.",
    }
  }

  if (looksLikeNoTranscript(raw)) {
    return {
      title: "Transcript needed",
      description: "Generate a transcript first, then try again.",
    }
  }

  // If the message is already short and human, keep it.
  if (raw && raw.length <= 160 && !raw.trimStart().startsWith("{")) {
    return { title: fallback.title, description: raw }
  }

  // Huge JSON / stack dumps — never show them.
  if (raw.trimStart().startsWith("{") || raw.length > 200) {
    return fallback
  }

  return raw ? { title: fallback.title, description: raw } : fallback
}

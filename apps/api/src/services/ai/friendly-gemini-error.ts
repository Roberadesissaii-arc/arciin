/**
 * Map Gemini / Google GenAI failures to short API error messages.
 *
 * The free tier often returns a multi-kilobyte JSON quota payload. Forwarding
 * that to the browser made Assist toasts unreadable.
 */

export function friendlyGeminiErrorMessage(
  error: unknown,
  fallback: string,
): { code: string; message: string } {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : ""

  if (/RESOURCE_EXHAUSTED|exceeded your current quota|quota exceeded|free_tier|GenerateRequestsPerDay/i.test(raw)) {
    const retryMatch = raw.match(/retry in\s+(\d+(?:\.\d+)?)\s*s/i)
    const seconds = retryMatch ? Math.ceil(Number(retryMatch[1])) : null
    return {
      code: "AI_QUOTA_EXCEEDED",
      message: seconds
        ? `AI limit reached. Try again in about ${seconds}s.`
        : "AI limit reached. Your Gemini quota is used up for now — try again later.",
    }
  }

  if (/429|rate[- ]?limit/i.test(raw)) {
    return {
      code: "AI_RATE_LIMITED",
      message: "AI is busy right now. Wait a moment and try again.",
    }
  }

  if (/billing|plan and billing/i.test(raw)) {
    return {
      code: "AI_BILLING",
      message: "Gemini billing needs attention. Check your plan, then try again.",
    }
  }

  // Already a short human message from our own code.
  if (raw && raw.length <= 180 && !raw.trimStart().startsWith("{")) {
    return { code: "AI_FAILED", message: raw }
  }

  return { code: "AI_FAILED", message: fallback }
}

/** Strip terminal ANSI color codes so log text matches the UI palette. */
export function stripAnsi(text: string) {
  return text.replace(/\u001b\[[0-9;]*m/g, "")
}

/** Text-only emphasis for common log shapes — no colored row backgrounds. */
export function logLineClassName(line: string) {
  const normalized = stripAnsi(line).toLowerCase()

  if (
    /"level":50/.test(line) ||
    /\berror\b/.test(normalized) ||
    /"statuscode":5/.test(line)
  ) {
    return "text-red-400/90"
  }

  if (/"level":40/.test(line) || /\bwarn/.test(normalized)) {
    return "text-amber-400/90"
  }

  if (
    /server listening/.test(normalized) ||
    /arciin api/.test(normalized) ||
    /\bready\b/.test(normalized)
  ) {
    return "text-zinc-100"
  }

  return "text-zinc-400"
}

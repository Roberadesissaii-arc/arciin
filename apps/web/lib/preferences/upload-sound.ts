let audioContext: AudioContext | null = null
let unlockInstalled = false

function getContext(): AudioContext | null {
  if (typeof window === "undefined") return null
  try {
    if (!audioContext || audioContext.state === "closed") {
      audioContext = new AudioContext()
    }
    return audioContext
  } catch {
    return null
  }
}

/**
 * Browsers create AudioContexts in a "suspended" state until a user gesture,
 * and playing on a suspended context is silent (no error). Socket-triggered
 * sounds (e.g. uploads from the mobile app) have no gesture of their own, so
 * we resume the shared context on the first click/keypress/touch anywhere.
 */
export function installUploadSoundUnlock() {
  if (typeof window === "undefined" || unlockInstalled) return
  unlockInstalled = true

  const unlock = () => {
    const ctx = getContext()
    if (ctx && ctx.state === "suspended") {
      void ctx.resume().catch(() => {})
    }
    window.removeEventListener("pointerdown", unlock)
    window.removeEventListener("keydown", unlock)
    window.removeEventListener("touchstart", unlock)
  }

  window.addEventListener("pointerdown", unlock, { passive: true })
  window.addEventListener("keydown", unlock, { passive: true })
  window.addEventListener("touchstart", unlock, { passive: true })
}

function playChime(ctx: AudioContext) {
  const now = ctx.currentTime

  // Two-note ascending chime
  for (const [freq, start, dur] of [
    [880, 0, 0.18],
    [1108, 0.12, 0.22],
  ] as [number, number, number][]) {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = "sine"
    osc.frequency.setValueAtTime(freq, now + start)
    gain.gain.setValueAtTime(0, now + start)
    gain.gain.linearRampToValueAtTime(0.11, now + start + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.001, now + start + dur)
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start(now + start)
    osc.stop(now + start + dur)
  }
}

/** Short completion chime when upload sound is enabled. */
export function playUploadCompleteSound() {
  const ctx = getContext()
  if (!ctx) return

  try {
    if (ctx.state === "suspended") {
      // Try to resume (works once any gesture has happened); play after.
      void ctx
        .resume()
        .then(() => playChime(ctx))
        .catch(() => {})
      return
    }
    playChime(ctx)
  } catch {
    // Ignore if audio is blocked
  }
}

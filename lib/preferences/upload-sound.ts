let audioContext: AudioContext | null = null

/** Short completion tone when upload sound is enabled. */
export function playUploadCompleteSound() {
  if (typeof window === "undefined") return

  try {
    audioContext ??= new AudioContext()
    const ctx = audioContext
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = "sine"
    osc.frequency.value = 880
    gain.gain.value = 0.04
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + 0.12)
  } catch {
    // Ignore if audio is blocked
  }
}

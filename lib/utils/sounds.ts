export function playUploadCompleteSound() {
  try {
    const ctx = new AudioContext()
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
      gain.gain.setValueAtTime(0.0, now + start)
      gain.gain.linearRampToValueAtTime(0.13, now + start + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.001, now + start + dur)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(now + start)
      osc.stop(now + start + dur)
    }

    setTimeout(() => ctx.close(), 1000)
  } catch {
    // audio not available — silently ignore
  }
}

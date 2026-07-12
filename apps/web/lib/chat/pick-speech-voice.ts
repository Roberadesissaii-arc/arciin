/** Prefer the most natural-sounding English voice the browser exposes. */
export function pickNaturalSpeechVoice(
  voices: SpeechSynthesisVoice[],
  lang = "en",
): SpeechSynthesisVoice | null {
  if (!voices.length) return null

  const langPrefix = lang.toLowerCase().split("-")[0]
  const english = voices.filter((v) => v.lang.toLowerCase().startsWith(langPrefix))
  const pool = english.length > 0 ? english : voices

  const score = (v: SpeechSynthesisVoice): number => {
    const name = v.name.toLowerCase()
    const uri = (v.voiceURI ?? "").toLowerCase()
    let s = 0

    if (/natural|neural|premium|enhanced|wavenet|studio/i.test(name)) s += 80
    if (/natural|neural|premium|enhanced/i.test(uri)) s += 40

    if (/google.*english|google us english/i.test(name)) s += 60
    if (/microsoft.*natural|aria|jenny|guy|sonia|ryan|libby/i.test(name)) s += 55
    if (/samantha|alex|karen|daniel|moira|tessa|fiona|aaron|nicky|nora|ava|allison|nathan|zoe/i.test(name)) {
      s += 50
    }
    if (/enhanced|premium/i.test(name) && /samantha|karen|aaron|nicky|ava|allison/i.test(name)) {
      s += 45
    }
    if (/google/i.test(name)) s += 35
    if (/microsoft/i.test(name) && !/desktop|mobile/i.test(name)) s += 25

    if (v.localService) s += 5
    else s += 12

    if (/en-us/i.test(v.lang)) s += 15
    else if (/en-gb/i.test(v.lang)) s += 10
    else if (/en/i.test(v.lang)) s += 5

    if (/compact|super-compact|espeak|festival|android|robot|whisper|eloquence/i.test(name)) {
      s -= 80
    }
    if (/eloquence/i.test(uri)) s -= 80
    if (
      /com\.apple\.tts\.sandbox|com\.apple\.speech\.synthesis/i.test(uri) &&
      !/premium|enhanced/i.test(name)
    ) {
      s -= 30
    }

    return s
  }

  let best: SpeechSynthesisVoice | null = null
  let bestScore = Number.NEGATIVE_INFINITY
  for (const v of pool) {
    const s = score(v)
    if (s > bestScore) {
      bestScore = s
      best = v
    }
  }

  return best
}

export function loadSpeechVoices(): Promise<SpeechSynthesisVoice[]> {
  if (typeof window === "undefined" || !window.speechSynthesis) {
    return Promise.resolve([])
  }

  const synth = window.speechSynthesis
  const existing = synth.getVoices()
  if (existing.length > 0) return Promise.resolve(existing)

  return new Promise((resolve) => {
    const finish = () => resolve(synth.getVoices())
    const timeout = window.setTimeout(finish, 1500)
    synth.addEventListener(
      "voiceschanged",
      () => {
        window.clearTimeout(timeout)
        finish()
      },
      { once: true },
    )
    synth.getVoices()
  })
}

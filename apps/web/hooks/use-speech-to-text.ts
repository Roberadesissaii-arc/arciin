"use client"

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react"

type SpeechRecognitionCtor = new () => SpeechRecognition

function getSpeechRecognition(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null
  const w = window as Window & {
    SpeechRecognition?: SpeechRecognitionCtor
    webkitSpeechRecognition?: SpeechRecognitionCtor
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export function useSpeechToText(lang = "en-US") {
  const [listening, setListening] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const recRef = useRef<SpeechRecognition | null>(null)

  const supported = useSyncExternalStore(
    () => () => {},
    () => getSpeechRecognition() !== null,
    () => false,
  )

  const stop = useCallback(() => {
    recRef.current?.stop()
    recRef.current = null
    setListening(false)
  }, [])

  useEffect(() => () => stop(), [stop])

  const toggleListening = useCallback(
    (onTranscript: (text: string, isFinal: boolean) => void) => {
      if (!supported) {
        setError("Speech recognition is not supported in this browser.")
        return
      }

      if (listening) {
        stop()
        return
      }

      const Ctor = getSpeechRecognition()
      if (!Ctor) return

      setError(null)
      const rec = new Ctor()
      rec.lang = lang
      rec.continuous = true
      rec.interimResults = true

      rec.onresult = (event: SpeechRecognitionEvent) => {
        let interim = ""
        let final = ""
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const chunk = event.results[i]?.[0]?.transcript ?? ""
          if (event.results[i]?.isFinal) final += chunk
          else interim += chunk
        }
        if (final) onTranscript(final, true)
        else if (interim) onTranscript(interim, false)
      }

      rec.onerror = (event: SpeechRecognitionErrorEvent) => {
        if (event.error === "aborted" || event.error === "no-speech") return
        setError(
          event.error === "not-allowed"
            ? "Microphone access was denied."
            : "Could not capture speech.",
        )
        stop()
      }

      rec.onend = () => {
        setListening(false)
        recRef.current = null
      }

      try {
        rec.start()
        recRef.current = rec
        setListening(true)
      } catch {
        setError("Could not start microphone.")
        stop()
      }
    },
    [lang, listening, stop, supported],
  )

  return { listening, supported, error, toggleListening, stop }
}

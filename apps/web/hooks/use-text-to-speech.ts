"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import { loadSpeechVoices, pickNaturalSpeechVoice } from "@/lib/chat/pick-speech-voice"

export function useTextToSpeech() {
  const [speaking, setSpeaking] = useState(false)
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null)
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null)

  const supported =
    typeof window !== "undefined" && typeof window.speechSynthesis !== "undefined"

  useEffect(() => {
    if (!supported) return
    let cancelled = false

    void loadSpeechVoices().then((voices) => {
      if (cancelled) return
      voiceRef.current = pickNaturalSpeechVoice(voices)
    })

    const onVoicesChanged = () => {
      const voices = window.speechSynthesis.getVoices()
      if (voices.length > 0) {
        voiceRef.current = pickNaturalSpeechVoice(voices)
      }
    }
    window.speechSynthesis.addEventListener("voiceschanged", onVoicesChanged)
    return () => {
      cancelled = true
      window.speechSynthesis.removeEventListener("voiceschanged", onVoicesChanged)
    }
  }, [supported])

  const stop = useCallback(() => {
    if (!supported) return
    window.speechSynthesis.cancel()
    utteranceRef.current = null
    setSpeaking(false)
  }, [supported])

  const speak = useCallback(
    async (text: string) => {
      if (!supported) return false
      const trimmed = text.trim()
      if (!trimmed) return false

      stop()

      let voice = voiceRef.current
      if (!voice) {
        const voices = await loadSpeechVoices()
        voice = pickNaturalSpeechVoice(voices)
        voiceRef.current = voice
      }

      const utterance = new SpeechSynthesisUtterance(trimmed)
      if (voice) {
        utterance.voice = voice
        utterance.lang = voice.lang
      } else {
        utterance.lang = "en-US"
      }
      utterance.rate = 0.96
      utterance.pitch = 1
      utterance.onend = () => {
        utteranceRef.current = null
        setSpeaking(false)
      }
      utterance.onerror = () => {
        utteranceRef.current = null
        setSpeaking(false)
      }
      utteranceRef.current = utterance
      setSpeaking(true)
      window.speechSynthesis.speak(utterance)
      return true
    },
    [stop, supported],
  )

  const toggle = useCallback(
    (text: string) => {
      if (speaking) {
        stop()
        return
      }
      void speak(text)
    },
    [speak, speaking, stop],
  )

  useEffect(() => () => stop(), [stop])

  return { supported, speaking, speak, stop, toggle }
}

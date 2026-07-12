"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import { synthesizeChatTts } from "@/lib/api/chat-tts"
import { loadSpeechVoices, pickNaturalSpeechVoice } from "@/lib/chat/pick-speech-voice"

function base64ToBlob(base64: string, mimeType: string): Blob {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return new Blob([bytes], { type: mimeType })
}

export function useChatTextToSpeech(profileId?: string | null) {
  const [speaking, setSpeaking] = useState(false)
  const [loading, setLoading] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const objectUrlRef = useRef<string | null>(null)
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null)
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const browserSupported =
    typeof window !== "undefined" && typeof window.speechSynthesis !== "undefined"

  useEffect(() => {
    if (!browserSupported) return
    let cancelled = false
    void loadSpeechVoices().then((voices) => {
      if (!cancelled) voiceRef.current = pickNaturalSpeechVoice(voices)
    })
    return () => {
      cancelled = true
    }
  }, [browserSupported])

  const cleanupAudio = useCallback(() => {
    audioRef.current?.pause()
    audioRef.current = null
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current)
      objectUrlRef.current = null
    }
  }, [])

  const stop = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    cleanupAudio()
    if (browserSupported) {
      window.speechSynthesis.cancel()
    }
    utteranceRef.current = null
    setSpeaking(false)
    setLoading(false)
  }, [browserSupported, cleanupAudio])

  const speakWithBrowser = useCallback(
    async (text: string) => {
      if (!browserSupported) return false
      let voice = voiceRef.current
      if (!voice) {
        const voices = await loadSpeechVoices()
        voice = pickNaturalSpeechVoice(voices)
        voiceRef.current = voice
      }
      const utterance = new SpeechSynthesisUtterance(text)
      if (voice) {
        utterance.voice = voice
        utterance.lang = voice.lang
      } else {
        utterance.lang = "en-US"
      }
      utterance.rate = 0.96
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
    [browserSupported],
  )

  const speak = useCallback(
    async (text: string) => {
      const trimmed = text.trim()
      if (!trimmed) return false

      stop()
      setLoading(true)
      const controller = new AbortController()
      abortRef.current = controller

      try {
        const result = await synthesizeChatTts({
          text: trimmed,
          profileId: profileId ?? undefined,
          signal: controller.signal,
        })
        if (controller.signal.aborted) return false

        const blob = base64ToBlob(result.audioBase64, result.mimeType || "audio/wav")
        const url = URL.createObjectURL(blob)
        objectUrlRef.current = url
        const audio = new Audio(url)
        audioRef.current = audio
        audio.onended = () => {
          setSpeaking(false)
          cleanupAudio()
        }
        audio.onerror = () => {
          setSpeaking(false)
          cleanupAudio()
        }
        setSpeaking(true)
        await audio.play()
        return true
      } catch {
        if (controller.signal.aborted) return false
        return speakWithBrowser(trimmed)
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null
        }
        setLoading(false)
      }
    },
    [cleanupAudio, profileId, speakWithBrowser, stop],
  )

  useEffect(() => () => stop(), [stop])

  return {
    supported: true,
    speaking,
    loading,
    speak,
    stop,
  }
}

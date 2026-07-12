import { fetchApi } from "@/lib/api/client"

export type ChatTtsResult = {
  audioBase64: string
  mimeType: string
}

export function synthesizeChatTts(input: {
  text: string
  profileId?: string
  voice?: string
  signal?: AbortSignal
}) {
  return fetchApi<ChatTtsResult>("/chat/tts", {
    method: "POST",
    body: {
      text: input.text,
      ...(input.profileId ? { profileId: input.profileId } : {}),
      ...(input.voice ? { voice: input.voice } : {}),
    },
    signal: input.signal,
  })
}

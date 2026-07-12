export type LibrarySeedDefinition = {
  name: string
  slug: string
  kind: "VIDEO" | "IMAGE" | "AUDIO" | "DOCUMENT" | "INBOX" | "CUSTOM"
  icon: string
}

export type RemoteAccessMode = "local" | "reverse-proxy" | "cloudflare-tunnel"

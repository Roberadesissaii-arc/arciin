/**
 * The model the background writer uses.
 *
 * A plain module-level value rather than component state, because a chapter may
 * be written while nothing is mounted. Chat publishes the reader's current
 * choice here; the transport reads it at call time, so switching model mid-book
 * takes effect on the next chapter without re-registering anything.
 */

export type BookTransportConfig = {
  profileId: string
  model?: string | null
  systemPrompt?: string
}

let config: BookTransportConfig | null = null

export function setBookTransportConfig(next: BookTransportConfig | null) {
  config = next
}

export function getBookTransportConfig(): BookTransportConfig | null {
  return config
}

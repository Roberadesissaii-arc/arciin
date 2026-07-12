const STORAGE_KEY = "arciin.userAvatar.v1"

type CachedAvatar = {
  userId: string
  url: string
}

export function readCachedUserAvatar(userId: string | undefined): string | null {
  if (!userId || typeof window === "undefined") return null
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as CachedAvatar
    return parsed.userId === userId ? parsed.url : null
  } catch {
    return null
  }
}

export function writeCachedUserAvatar(userId: string, url: string) {
  if (typeof window === "undefined") return
  try {
    const payload: CachedAvatar = { userId, url }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
  } catch {
    // ignore quota / private mode
  }
}

export function clearCachedUserAvatar(userId?: string) {
  if (typeof window === "undefined") return
  try {
    if (!userId) {
      window.localStorage.removeItem(STORAGE_KEY)
      return
    }
    const current = readCachedUserAvatar(userId)
    if (current) window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    // ignore
  }
}

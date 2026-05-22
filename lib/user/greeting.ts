/** First token of display name, if any. */
export function userFirstName(fullName: string | null | undefined): string | null {
  const first = fullName?.trim().split(/\s+/)[0]?.trim()
  return first || null
}

export type UserGreetingState =
  | { status: "loading" }
  | { status: "offline" }
  | { status: "named"; firstName: string }

/**
 * @param isOffline Server/API unreachable or identity unavailable while not loading.
 */
export function resolveUserGreeting(input: {
  isLoading: boolean
  isOffline: boolean
  fullName?: string | null
}): UserGreetingState {
  if (input.isLoading) return { status: "loading" }
  if (input.isOffline) return { status: "offline" }
  const first = userFirstName(input.fullName)
  if (first) return { status: "named", firstName: first }
  return { status: "offline" }
}

/** "there" when offline; first name when connected. */
export function heyTherePhrase(state: UserGreetingState): string | null {
  if (state.status === "loading") return null
  if (state.status === "offline") return "there"
  return state.firstName
}

export function welcomeBackPhrase(state: UserGreetingState): string | null {
  if (state.status === "loading") return null
  if (state.status === "offline") return "there"
  return state.firstName
}

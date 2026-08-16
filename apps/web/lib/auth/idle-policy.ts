/**
 * Whether an idle session should be signed out yet.
 *
 * Pulled out of the watcher component so the rule can be argued about and
 * tested on its own. The rule is a security control, and the change that made
 * it necessary is the one that lets a book keep writing after the reader leaves
 * the Chat page.
 *
 * The conflict, found by a real acceptance run rather than by reading the code:
 * the watcher counts mouse and keyboard events as activity, and background
 * generation produces neither. A three-chapter book takes longer than the
 * default thirty-minute timeout, so the tab signed itself out mid-book, the
 * session was deleted server-side, and the run died — while Arciin was visibly
 * working. Both acceptance runs ended on `/login`.
 *
 * The fix is deliberately *not* "treat generation as activity". Doing that
 * would keep resetting the idle clock and hand the reader a fresh full window
 * every fifteen seconds, so a book left running overnight would leave an
 * unlocked session open until morning — which is the exact thing the control
 * exists to prevent.
 *
 * Instead the idle clock keeps running untouched, and an active task is only a
 * reason to *defer* acting on it. The moment the task stops, the already-expired
 * threshold is honoured on the next tick — no grace, no reset.
 */

export type IdleDecision =
  /** The idle threshold has not been reached. */
  | "wait"
  /** Threshold reached, but work the reader is waiting on is still running. */
  | "defer"
  /** Threshold reached and nothing is holding it back. Sign out. */
  | "logout"

export function decideIdleLogout(input: {
  idleEnabled: boolean
  idleMs: number
  /** Time since the last real mouse/keyboard/scroll event. Never reset by work. */
  msSinceActivity: number
  /** From the AI-tasks view: is something actively generating right now? */
  backgroundTaskRunning: boolean
}): IdleDecision {
  const { idleEnabled, idleMs, msSinceActivity, backgroundTaskRunning } = input

  // Disabled, or configured to nothing: the watcher does not act at all.
  if (!idleEnabled || idleMs <= 0) return "wait"

  if (msSinceActivity < idleMs) return "wait"

  // Threshold passed. The only thing that holds it is work in flight — and
  // holding is all it does; `msSinceActivity` keeps climbing underneath.
  if (backgroundTaskRunning) return "defer"

  return "logout"
}

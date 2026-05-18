/** Activity types that already show a dedicated UI toast — avoid duplicate Sonner stacks. */
const SELF_TOAST_ACTIVITY_TYPES = new Set([
  "asset.deleted",
  "asset.moved",
])

export function shouldToastForActivityEvent(eventType: string) {
  return !SELF_TOAST_ACTIVITY_TYPES.has(eventType)
}

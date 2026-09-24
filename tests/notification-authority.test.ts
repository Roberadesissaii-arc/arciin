import { readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

/**
 * The server is the only notification inbox.
 *
 * Before v1.1.0 each browser kept its own copy in localStorage, so two devices
 * — or two tabs after "mark all read" — disagreed about what was unread. A
 * second, local inbox creeping back would reintroduce exactly that, so this
 * fails if client code starts writing one again.
 */

const WEB = path.resolve(__dirname, "../apps/web")
const SKIP = new Set(["node_modules", ".next", ".next-dev", ".next-build", ".next-e2e", "public"])

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) sources(full, out)
    else if (/\.(ts|tsx)$/.test(name)) out.push(full)
  }
  return out
}

const files = sources(WEB).map((file) => ({ file: path.relative(WEB, file), text: readFileSync(file, "utf8") }))

describe("notification authority", () => {
  it("only the retirement shim mentions the old localStorage inbox key", () => {
    const offenders = files
      .filter(({ text }) => text.includes("arciin_notification_inbox"))
      .map(({ file }) => file)
    expect(offenders).toEqual(["components/notifications/retire-local-notification-inbox.tsx"])
  })

  it("the retirement shim only ever removes, never writes", () => {
    const shim = files.find(({ file }) => file.endsWith("retire-local-notification-inbox.tsx"))!
    expect(shim.text).toContain("localStorage.removeItem")
    expect(shim.text).not.toContain("localStorage.setItem")
  })

  it("the badge and inbox read from the server hooks", () => {
    const badge = files.find(({ file }) => file.endsWith("notification-unread-badge.tsx"))!
    const inbox = files.find(({ file }) => file.endsWith("notification-inbox.tsx"))!
    expect(badge.text).toContain("useNotificationUnreadCount")
    expect(inbox.text).toContain("useNotificationsPage")
    expect(inbox.text).toContain("useMarkNotificationRead")
    expect(inbox.text).toContain("useMarkAllNotificationsRead")
  })

  it("realtime invalidates the inbox, including read state changed elsewhere", () => {
    const socket = files.find(({ file }) => file === "hooks/use-socket-events.ts")!
    expect(socket.text).toContain('type === "notifications.read"')
    expect(socket.text).toContain("queryKeys.notificationsRoot")
  })
})

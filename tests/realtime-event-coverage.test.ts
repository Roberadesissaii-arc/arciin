import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import { SOCKET_EVENT_TYPES } from "../packages/types/src/events"
import { socketEventTypes } from "../apps/web/lib/types/events"

/**
 * An event nobody subscribes to is not realtime.
 *
 * The browser only reacts to event names it registered a handler for, so a name
 * the server publishes but the client never listed is silently dropped. That is
 * how a finished transcript kept a card spinning: the worker published
 * `asset.transcript.ready` into a room where nothing was listening, and the
 * asset list was never invalidated until someone reloaded the page.
 */

const WORKER = readFileSync(
  join(process.cwd(), "apps/worker/src/processors/worker-handlers.ts"),
  "utf8",
)

describe("realtime event coverage", () => {
  it("the browser subscribes to exactly the shared list", () => {
    // Not a copy that can fall behind — the same array.
    expect(socketEventTypes).toBe(SOCKET_EVENT_TYPES)
  })

  it("every event the worker publishes is one a client can hear", () => {
    const published = [
      ...WORKER.matchAll(/createRealtimeEvent\(\s*"([a-z0-9.]+)"/gi),
    ].map((m) => m[1])

    expect(published.length).toBeGreaterThan(0)
    for (const name of new Set(published)) {
      // Checked against the browser's own list, not the shared one: what the
      // client registers is what decides whether the event arrives.
      expect(
        socketEventTypes as readonly string[],
        `worker publishes "${name}" but the browser never subscribes to it`,
      ).toContain(name)
    }
  })

  it("both ways out of a running transcript are announced", () => {
    // The card spinner is driven by transcript status. Whichever way the job
    // ends, the client has to be told, or the spinner outlives the work.
    expect(WORKER).toContain('createRealtimeEvent("asset.transcript.updated"')
    expect(WORKER).toContain('createRealtimeEvent("asset.transcript.ready"')
    expect(WORKER).toContain('createRealtimeEvent("asset.transcript.failed"')
  })

  it("the failure announcement sits with the failure itself", () => {
    // Inside failTranscript, so no early return can skip it.
    const fail = WORKER.slice(
      WORKER.indexOf("const failTranscript ="),
      WORKER.indexOf("const failTranscript =") + 1400,
    )
    expect(fail).toContain('createRealtimeEvent("asset.transcript.failed"')
  })

  it("transcript events invalidate the asset list", () => {
    // use-socket-events keys off the `asset.` prefix to refresh the listing the
    // cards read from; a rename that broke that prefix would break the fix.
    for (const name of [
      "asset.transcript.updated",
      "asset.transcript.ready",
      "asset.transcript.failed",
    ]) {
      expect(name.startsWith("asset.")).toBe(true)
    }
    const hook = readFileSync(
      join(process.cwd(), "apps/web/hooks/use-socket-events.ts"),
      "utf8",
    )
    expect(hook).toContain('type.startsWith("asset.")')
    expect(hook).toContain("queryKeys.assetsRoot")
  })
})

import { describe, expect, it } from "vitest"

import {
  activityFromTranscriptEvent,
  transcriptEventIsNewer,
} from "../apps/web/lib/realtime/apply-transcript-activity"

describe("transcript realtime ordering", () => {
  it("maps updated to running and ready to no indicator", () => {
    expect(activityFromTranscriptEvent("asset.transcript.updated", "2026-09-11T12:00:00.000Z")).toMatchObject({
      status: "running",
      active: true,
    })
    expect(activityFromTranscriptEvent("asset.transcript.ready", "2026-09-11T12:00:01.000Z")).toBeNull()
    expect(activityFromTranscriptEvent("asset.transcript.failed", "2026-09-11T12:00:02.000Z")).toMatchObject({
      status: "failed",
      active: false,
    })
  })

  it("does not let an older failed event override a newer running state", () => {
    expect(
      transcriptEventIsNewer("2026-09-11T12:00:00.000Z", "2026-09-11T12:00:05.000Z"),
    ).toBe(false)
    expect(
      transcriptEventIsNewer("2026-09-11T12:00:06.000Z", "2026-09-11T12:00:05.000Z"),
    ).toBe(true)
  })

  it("treats a missing current timestamp as stale", () => {
    expect(transcriptEventIsNewer("2026-09-11T12:00:00.000Z", null)).toBe(true)
  })
})

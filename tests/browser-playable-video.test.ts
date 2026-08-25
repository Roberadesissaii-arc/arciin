import { describe, expect, it } from "vitest"

import { planBrowserPlayableVideo } from "../apps/api/src/services/media/browser-playable-video"

describe("planBrowserPlayableVideo", () => {
  it("remuxes VP9-in-MP4 to WebM (Instagram / Chrome audio-only case)", () => {
    const plan = planBrowserPlayableVideo({ codec: "vp9", mimeType: "video/mp4" })
    expect(plan?.ext).toBe("webm")
    expect(plan?.contentType).toBe("video/webm")
    expect(plan?.ffmpegArgs).toContain("libopus")
  })

  it("leaves ordinary H.264 MP4 alone", () => {
    expect(planBrowserPlayableVideo({ codec: "h264", mimeType: "video/mp4" })).toBeNull()
    expect(planBrowserPlayableVideo({ codec: "avc1", mimeType: "video/mp4" })).toBeNull()
  })

  it("transcodes HEVC to H.264 MP4 for browsers that cannot play it", () => {
    const plan = planBrowserPlayableVideo({ codec: "hevc", mimeType: "video/mp4" })
    expect(plan?.ext).toBe("mp4")
    expect(plan?.ffmpegArgs).toContain("libx264")
  })
})

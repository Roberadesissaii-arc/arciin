import { describe, expect, it } from "vitest"

import { computeConnectorHealth } from "../apps/api/src/services/integrations/connector-health"

const folder = (libraryName: string, ready = true, onDisk = true) => ({ libraryName, ready, onDisk })
const three = () => [folder("Videos"), folder("Images"), folder("Music")]

describe("computeConnectorHealth", () => {
  it("off is disconnected, whatever the folders say", () => {
    expect(
      computeConnectorHealth({ enabled: false, displayName: "Plex", mirrorRootWritable: false, folders: [] }).state,
    ).toBe("disconnected")
  })

  it("on with everything present is healthy", () => {
    expect(
      computeConnectorHealth({ enabled: true, displayName: "Plex", mirrorRootWritable: true, folders: three() }).state,
    ).toBe("healthy")
  })

  it("a missing folder is degraded and names the library", () => {
    const h = computeConnectorHealth({
      enabled: true,
      displayName: "Jellyfin",
      mirrorRootWritable: true,
      folders: [folder("Videos", false, false), folder("Images"), folder("Music")],
    })
    expect(h.state).toBe("degraded")
    expect(h.reason).toContain("Videos")
  })

  it("a folder missing only on disk is degraded", () => {
    const h = computeConnectorHealth({
      enabled: true,
      displayName: "Plex",
      mirrorRootWritable: true,
      folders: [folder("Videos"), folder("Images", true, false), folder("Music")],
    })
    expect(h.state).toBe("degraded")
    expect(h.reason).toContain("Images")
  })

  it("an unwritable mirror root is an error, which outranks missing folders", () => {
    expect(
      computeConnectorHealth({
        enabled: true,
        displayName: "Plex",
        mirrorRootWritable: false,
        folders: [folder("Videos", false, false)],
      }).state,
    ).toBe("error")
  })

  it("no media libraries at all is degraded, not healthy", () => {
    expect(
      computeConnectorHealth({ enabled: true, displayName: "Plex", mirrorRootWritable: true, folders: [] }).state,
    ).toBe("degraded")
  })
})

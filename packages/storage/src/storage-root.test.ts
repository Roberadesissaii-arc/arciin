import path from "node:path"
import { describe, expect, it } from "vitest"

import { candidateStorageObjectPaths } from "./storage-root"

describe("candidateStorageObjectPaths", () => {
  const objectKey = "objects/55/5a/555acb15deadbeef.png"
  const storageRoot = "/srv/arciin-storage/arciin"
  const physicalPath = path.join(storageRoot, objectKey)

  it("resolves the canonical original under the configured server root", () => {
    const paths = candidateStorageObjectPaths(storageRoot, physicalPath, objectKey, [
      storageRoot,
    ])
    expect(paths).toContain(physicalPath)
    expect(paths.every((p) => p.startsWith("/") && !p.includes("C:"))).toBe(true)
  })

  it("prefers the server objectKey even if physicalPath leaked a Windows source path", () => {
    const leaked = "C:\\Users\\SomeUser\\Desktop\\folder\\image.jpg"
    const paths = candidateStorageObjectPaths(storageRoot, leaked, objectKey)
    expect(paths[0]).toBe(path.join(storageRoot, "objects", "55", "5a", "555acb15deadbeef.png"))
    expect(paths[0]).not.toContain("image.jpg")
  })
})

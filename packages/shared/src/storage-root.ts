import path from "node:path"

/**
 * Derive ARCIIN_DATA_DIR-equivalent root from a storage object physical path like
 * `.../objects/ab/cd/checksum.ext`. Two `dirname` calls stop at `.../objects/ab`, which is wrong.
 */
export function deriveStorageRootFromObjectPhysicalPath(physicalPath: string): string {
  const resolved = path.resolve(physicalPath)
  let dir = path.dirname(resolved)
  for (let depth = 0; depth < 16; depth++) {
    if (path.basename(dir) === "objects") {
      return path.dirname(dir)
    }
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return path.dirname(path.dirname(resolved))
}

export function resolveArciinStorageRoot(
  configuredRoot: string | null | undefined,
  physicalPathFallback: string,
): string {
  const trimmed = configuredRoot?.trim()
  if (trimmed) return path.resolve(trimmed)
  return deriveStorageRootFromObjectPhysicalPath(physicalPathFallback)
}

/**
 * Possible absolute paths where the object's bytes may live.
 * Tries `objectKey` under each candidate root, then the stored `physicalPath`.
 */
export function candidateStorageObjectPaths(
  configuredStorageRoot: string | null | undefined,
  storedPhysicalPath: string,
  objectKey: string,
  extraRoots?: readonly (string | null | undefined)[],
): string[] {
  const segments = objectKey.replace(/^[/\\]+/, "").split(/[/\\]+/).filter(Boolean)

  const roots = new Set<string>()
  roots.add(path.resolve(resolveArciinStorageRoot(configuredStorageRoot, storedPhysicalPath)))
  for (const raw of extraRoots ?? []) {
    const t = raw?.trim()
    if (t) roots.add(path.resolve(t))
  }

  const out: string[] = []
  for (const root of roots) {
    if (segments.length > 0) out.push(path.normalize(path.join(root, ...segments)))
  }
  out.push(path.resolve(storedPhysicalPath))
  return [...new Set(out)]
}

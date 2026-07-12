import path from "node:path"

/** Relative paths shown in setup UI that must map to ARCIIN_DATA_DIR inside containers. */
const LEGACY_RELATIVE_STORAGE_ROOTS = new Set(["./data/arciin", "data/arciin"])

/** Absolute paths from Docker WORKDIR (/app) + default setup value. */
const LEGACY_ABSOLUTE_STORAGE_ROOTS = new Set(["/app/data/arciin"])

/**
 * Map configured instance storage roots to the process runtime data directory.
 * Docker mounts host storage at ARCIIN_DATA_DIR (/data/arciin) but setup often
 * saves ./data/arciin which resolves to /app/data/arciin inside the container.
 */
export function normalizeConfiguredStorageRoot(
  configured: string | null | undefined,
  runtimeDataDir: string,
  hostDataDir?: string | null,
): string {
  const runtime = path.resolve(runtimeDataDir)
  const raw = configured?.trim()
  if (!raw) return runtime

  const resolved = path.resolve(raw)
  if (resolved === runtime) return resolved

  const host = hostDataDir?.trim() ? path.resolve(hostDataDir.trim()) : null
  if (host && resolved === host) {
    return runtime
  }

  const slash = raw.replace(/\\/g, "/")
  if (LEGACY_RELATIVE_STORAGE_ROOTS.has(slash) || LEGACY_RELATIVE_STORAGE_ROOTS.has(raw)) {
    return runtime
  }

  if (LEGACY_ABSOLUTE_STORAGE_ROOTS.has(resolved)) {
    return runtime
  }

  if (runtime === "/data/arciin" && resolved.includes("/data/arciin") && resolved !== runtime) {
    return runtime
  }

  return resolved
}

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

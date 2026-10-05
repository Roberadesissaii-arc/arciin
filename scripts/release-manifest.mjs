#!/usr/bin/env node
/**
 * Writes the release manifest (stable.json) that the Docker installer and the
 * one-liner read. Published as a GitHub Release asset by
 * .github/workflows/release.yml, only after all three images are verified.
 *
 * The format is deliberately flat — one "key": "value" per line — so the
 * installers parse it with sed on hosts that have neither python nor jq.
 * Images are pinned by tag AND digest; every installer asset carries its
 * SHA-256.
 *
 *   node scripts/release-manifest.mjs --version 1.1.4 --release-sha <sha> \
 *     --registry ghcr.io/roberadesissaii-arc \
 *     --digest-web sha256:… --digest-api sha256:… --digest-worker sha256:… \
 *     --assets-dir dist/release --assets-base https://github.com/…/releases/download/v1.1.4/ \
 *     --out dist/release/stable.json
 */
import { createHash } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"
import path from "node:path"

export const MANIFEST_ASSETS = [
  "install.sh",
  "docker-install.sh",
  "install-state.sh",
  "arciin-doctor.sh",
  "docker-compose.yml",
  "Caddyfile",
  "avahi-discovery.sh",
]

export function assetKey(name) {
  return `sha256_${name.replace(/[.-]/g, "_")}`
}

export function buildManifest({ version, releaseSha, registry, digests, assetHashes, assetsBase, publishedAt, notes }) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`version must be X.Y.Z, got ${version}`)
  if (!/^[0-9a-f]{40}$/.test(releaseSha)) throw new Error("releaseSha must be a full 40-character commit SHA")
  const images = {}
  for (const service of ["web", "api", "worker"]) {
    const digest = digests[service]
    if (!/^sha256:[0-9a-f]{64}$/.test(digest ?? "")) throw new Error(`missing or malformed digest for ${service}`)
    images[`image_${service}`] = `${registry}/arciin-${service}:${version}@${digest}`
  }
  const manifest = {
    schema: 2,
    version,
    channel: "stable",
    releaseSha,
    published_at: publishedAt,
    // Read by one-liners older than v1.1.4.
    image_tag: version,
    registry,
    ...images,
    assets_base: assetsBase.endsWith("/") ? assetsBase : `${assetsBase}/`,
  }
  for (const name of MANIFEST_ASSETS) {
    const hash = assetHashes[name]
    if (!/^[0-9a-f]{64}$/.test(hash ?? "")) throw new Error(`missing checksum for ${name}`)
    manifest[assetKey(name)] = hash
  }
  if (notes) manifest.notes = notes
  return manifest
}

// One key per line, no nesting: the installers' sed parser depends on it.
export function serializeManifest(manifest) {
  const lines = Object.entries(manifest).map(([key, value]) => `  ${JSON.stringify(key)}: ${JSON.stringify(value)}`)
  return `{\n${lines.join(",\n")}\n}\n`
}

function arg(name) {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? undefined : process.argv[i + 1]
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const assetsDir = arg("assets-dir")
  const assetHashes = Object.fromEntries(
    MANIFEST_ASSETS.map((name) => [name, createHash("sha256").update(readFileSync(path.join(assetsDir, name))).digest("hex")]),
  )
  const manifest = buildManifest({
    version: arg("version")?.replace(/^v/, ""),
    releaseSha: arg("release-sha"),
    registry: arg("registry") ?? "ghcr.io/roberadesissaii-arc",
    digests: { web: arg("digest-web"), api: arg("digest-api"), worker: arg("digest-worker") },
    assetHashes,
    assetsBase: arg("assets-base"),
    publishedAt: arg("published-at") ?? new Date().toISOString().replace(/\.\d+Z$/, "Z"),
    notes: arg("notes"),
  })
  writeFileSync(arg("out"), serializeManifest(manifest))
  console.log(`wrote ${arg("out")} for ${manifest.version}`)
}

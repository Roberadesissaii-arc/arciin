#!/usr/bin/env node
/**
 * Can this Arciin reach its licensing authority? Non-destructive: it activates
 * nothing and sends no key. Used by both installers and by `arciin doctor`;
 * in Docker it runs inside the API container, because the host reaching the
 * authority proves nothing about the container.
 *
 * Checks, in order: DNS, TLS + /health, the clock (entitlements are signed and
 * time-bound; a clock hours off makes valid tokens look expired), and that this
 * build ships a verification key.
 *
 * Prints one line per check. Exit 0 when the service is reachable, 1 otherwise.
 * `--json` prints a machine-readable summary instead.
 */
import { lookup } from "node:dns/promises"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const json = process.argv.includes("--json")
const base = (process.env.ARCIIN_LICENSE_SERVER_URL || "https://license.arciin.com").replace(/\/$/, "")
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const result = { url: base, dns: null, health: null, clockSkewSeconds: null, verificationKeys: [], ok: false }
const lines = []

try {
  const host = new URL(base).hostname
  const addrs = await lookup(host, { all: true })
  result.dns = addrs.map((a) => a.address)
  lines.push(`✔ DNS ${host} → ${addrs.map((a) => a.address).slice(0, 2).join(", ")}`)
} catch (error) {
  result.dns = false
  lines.push(`✖ DNS failed for ${base}: ${error.code || error.message}`)
}

if (result.dns) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8_000)
  try {
    const started = Date.now()
    const res = await fetch(`${base}/health`, { signal: controller.signal })
    const ms = Date.now() - started
    result.health = res.status
    const dateHeader = res.headers.get("date")
    if (dateHeader) {
      const skew = Math.round((Date.now() - Date.parse(dateHeader)) / 1000)
      result.clockSkewSeconds = skew
      lines.push(
        Math.abs(skew) > 300
          ? `✖ Clock is ${skew}s off from the license service — fix NTP (timedatectl set-ntp true)`
          : `✔ Clock within ${Math.abs(skew)}s of the license service`,
      )
    }
    lines.splice(1, 0, res.ok ? `✔ License service reachable (${res.status}, ${ms} ms${base.startsWith("https:") ? ", TLS ok" : ", plain HTTP"})` : `✖ License service answered ${res.status}`)
  } catch (error) {
    result.health = false
    const cause = error.cause?.code || (error.name === "AbortError" ? "timeout" : error.message)
    lines.push(`✖ Could not reach ${base}/health (${cause}) — check DNS, firewall/proxy egress to port 443, and CA certificates`)
  } finally {
    clearTimeout(timer)
  }
}

// The build verifies entitlements with public keys compiled into it; report
// their ids so a "token could not be verified" has an answer at hand.
for (const candidate of ["apps/api/dist/index.js", "packages/config/src/license-signing.ts"]) {
  const file = path.join(root, candidate)
  if (!existsSync(file)) continue
  const kids = [...new Set(readFileSync(file, "utf8").match(/arciin-lic-\d{4}-\d{2}/g) ?? [])]
  if (kids.length) {
    result.verificationKeys = kids
    lines.push(`✔ Verification keys in this build: ${kids.join(", ")}`)
    break
  }
}
if (result.verificationKeys.length === 0) lines.push("⚠ Could not find the verification key ids in this build")

result.ok = result.health !== false && result.health !== null && result.health < 400 &&
  (result.clockSkewSeconds === null || Math.abs(result.clockSkewSeconds) <= 300)

if (json) {
  console.log(JSON.stringify(result))
} else {
  for (const line of lines) console.log(`  ${line}`)
}
process.exit(result.ok ? 0 : 1)

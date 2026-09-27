import { readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

/**
 * One way onto the public internet.
 *
 * `/start-mobile` shipped without the owner-MFA check `/start` had, and the
 * Remote Access settings save started a tunnel with no check at all — two
 * bypasses of one policy, because each caller was trusted to remember it.
 * Now only services/remote-access/public-tunnel.ts may call the cloudflared
 * spawner, and it checks the policy first. A new route that starts a tunnel
 * any other way fails here.
 */

const ROOT = path.resolve(__dirname, "..")
const SRC = [path.join(ROOT, "apps/api/src"), path.join(ROOT, "apps/worker/src")]
const SPAWNER = "apps/api/src/services/remote-access/cloudflare-tunnel.ts"
const CHOKE_POINT = "apps/api/src/services/remote-access/public-tunnel.ts"

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) sources(full, out)
    else if (name.endsWith(".ts") && !name.endsWith(".test.ts")) out.push(full)
  }
  return out
}

const files = SRC.flatMap((d) => sources(d)).map((f) => ({
  rel: path.relative(ROOT, f),
  text: readFileSync(f, "utf8"),
}))

// Config isolation from the licensing tunnel (~/.cloudflared/config.yml) is
// pinned by tests/quick-tunnel-config-isolation.test.ts.
describe("public tunnel choke point", () => {
  it("only public-tunnel.ts calls startCloudflareQuickTunnel", () => {
    const callers = files
      .filter(({ rel }) => rel !== SPAWNER)
      .filter(({ text }) => /\bstartCloudflareQuickTunnel\b/.test(text))
      .map(({ rel }) => rel)
    expect(callers).toEqual([CHOKE_POINT])
  })

  it("nothing else spawns cloudflared", () => {
    const spawners = files
      .filter(({ text }) => /spawn\(\s*["']cloudflared["']/.test(text))
      .map(({ rel }) => rel)
    expect(spawners).toEqual([SPAWNER])
  })

  it("the choke point checks the plan and the owner-MFA policy before spawning", () => {
    const text = files.find(({ rel }) => rel === CHOKE_POINT)!.text
    const body = text.slice(text.indexOf("export async function startPublicTunnel"))
    expect(body.indexOf("assertPublicRemoteAccessAllowed")).toBeGreaterThan(-1)
    expect(body.indexOf("assertPublicRemoteAccessAllowed")).toBeLessThan(body.indexOf("startCloudflareQuickTunnel"))
    // The policy itself: the plan's feature first, then the owner's second factor.
    const policy = text.slice(text.indexOf("export async function evaluatePublicRemoteAccess"))
    expect(policy.indexOf("readRemoteAccessEntitlement")).toBeGreaterThan(-1)
    expect(policy.indexOf("readRemoteAccessEntitlement")).toBeLessThan(policy.indexOf("canEnablePublicRemoteAccess"))
    expect(text).toContain('"ops.remote_access_helper"')
  })

  it("every tunnel start route carries the shared preHandler", () => {
    const routes = files.find(({ rel }) => rel === "apps/api/src/modules/settings/routes.ts")!.text
    for (const route of ["/settings/cloudflare-tunnel/start\"", "/settings/cloudflare-tunnel/start-mobile\""]) {
      const at = routes.indexOf(route)
      expect(at, route).toBeGreaterThan(-1)
      const block = routes.slice(at, routes.indexOf("async (request, reply)", at))
      expect(block, route).toContain("requirePublicRemoteAccessPolicy")
    }
  })

  it("a plan change reconciles the tunnel: license routes, the check-in, boot and the status reads", () => {
    const license = files.find(({ rel }) => rel === "apps/api/src/modules/license/routes.ts")!.text
    for (const reason of ["license-status", "license-activate", "license-refresh", "license-deactivate"]) {
      expect(license).toContain(`settleRemoteAccess("${reason}")`)
    }
    const checkIn = files.find(({ rel }) => rel === "apps/api/src/services/license/license-checkin.ts")!.text
    expect(checkIn).toContain("reconcilePublicRemoteAccess(fastify")
    const boot = files.find(({ rel }) => rel === "apps/api/src/services/remote-access/tunnel-boot.ts")!.text
    expect(boot).toContain('reconcilePublicRemoteAccess(fastify, "boot")')
    const settings = files.find(({ rel }) => rel === "apps/api/src/modules/settings/routes.ts")!.text
    expect(settings).toContain('reconcilePublicRemoteAccess(fastify, "settings-read")')
    expect(settings).toContain('reconcilePublicRemoteAccess(fastify, "status-read")')
  })

  it("boot auto-start and restart-after-exit use the choke point", () => {
    const boot = files.find(({ rel }) => rel === "apps/api/src/services/remote-access/tunnel-boot.ts")!.text
    expect(boot).toContain("startPublicTunnel(fastify.prisma")
    expect(boot).toContain("PublicRemoteAccessDeniedError")
  })
})

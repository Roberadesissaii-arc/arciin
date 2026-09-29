import { spawn, spawnSync, type ChildProcess } from "node:child_process"
import { existsSync, readFileSync, rmSync } from "node:fs"
import http from "node:http"
import net from "node:net"
import path from "node:path"

import { afterAll, beforeAll, describe, expect, it } from "vitest"

/**
 * The account portal, built and served exactly as production does.
 *
 * The portal answered 500 on every page in production for weeks with its
 * process "online", because nothing ever requested a page after a deploy.
 * This builds it for production, starts `next start`, and asks for every page
 * against a license server that is up, down, slow and broken. It also checks
 * the portal runs with only its least-privilege environment.
 *
 * Opt-in (ARCIIN_ACCOUNT_SMOKE=1): a production build takes ~20 s.
 */

const RUN = process.env.ARCIIN_ACCOUNT_SMOKE === "1"
const APP = path.resolve(__dirname, "../apps/account")
// The same staging directory the deploy builds into (tsconfig already lists
// its types, so a build does not rewrite a tracked file).
const DIST = ".next-build"
const PAGES = ["/account", "/account/licenses", "/account/servers", "/account/downloads"]

type Mode = "online" | "offline" | "slow" | "bad"
let mode: Mode = "online"
let licensePort = 0
let portalPort = 0
let license: http.Server
let portal: ChildProcess
let portalLog = ""

const overview = {
  demoMode: true,
  customer: { id: "c1", name: "Demo Customer", email: "you@yourserver.com", createdAt: "2026-09-01T00:00:00.000Z" },
  summary: { licenseCount: 1, activeLicenses: 1, activatedServers: 1, primaryPlan: "pro", nextRenewalAt: null, backupStatus: "not_connected" },
  licenses: [
    {
      id: "l1", plan: "pro", status: "active", keyPrefix: "ARC-PRO", licenseKey: null, serverLimit: 3, activatedServers: 1,
      expiresAt: null, graceDays: 14, createdAt: "2026-09-01T00:00:00.000Z", lastCheckInAt: "2026-09-28T00:00:00.000Z",
      activations: [{ id: "a1", instanceId: "i1", instanceName: "Home server", instanceVersion: "1.1.1", hostname: "node-01", lastCheckInAt: "2026-09-28T00:00:00.000Z", activatedAt: "2026-09-02T00:00:00.000Z", deactivatedAt: null, active: true }],
    },
  ],
  activations: [{ id: "a1", licenseId: "l1", plan: "pro", instanceId: "i1", instanceName: "Home server", instanceVersion: "1.1.1", hostname: "node-01", lastCheckInAt: "2026-09-28T00:00:00.000Z", activatedAt: "2026-09-02T00:00:00.000Z", deactivatedAt: null, active: true, licenseKeyPrefix: "ARC-PRO" }],
}

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = net.createServer().listen(0, "127.0.0.1", () => {
      const port = (s.address() as net.AddressInfo).port
      s.close(() => resolve(port))
    })
  })
}

async function get(page: string) {
  const started = Date.now()
  const res = await fetch(`http://127.0.0.1:${portalPort}${page}`, { redirect: "manual", signal: AbortSignal.timeout(30_000) })
  return { status: res.status, body: await res.text(), ms: Date.now() - started }
}

describe.skipIf(!RUN)("account portal in production mode", () => {
  beforeAll(async () => {
    licensePort = await freePort()
    portalPort = await freePort()
    license = http.createServer((req, res) => {
      if (mode === "slow") {
        setTimeout(() => res.end("{}"), 20_000).unref()
        return
      }
      if (mode === "bad") {
        res.writeHead(200, { "content-type": "text/html" })
        res.end("<html>proxy error</html>")
        return
      }
      if (req.url?.startsWith("/health")) {
        res.writeHead(200, { "content-type": "application/json" })
        res.end(JSON.stringify({ data: { status: "ok" } }))
        return
      }
      if (req.url?.startsWith("/account/overview")) {
        res.writeHead(200, { "content-type": "application/json" })
        res.end(JSON.stringify({ data: overview }))
        return
      }
      res.writeHead(404, { "content-type": "application/json" })
      res.end(JSON.stringify({ error: { message: "not found" } }))
    })
    await new Promise<void>((r) => license.listen(licensePort, "127.0.0.1", r))

    rmSync(path.join(APP, DIST), { recursive: true, force: true })
    const build = spawnSync("pnpm", ["build"], {
      cwd: APP,
      env: { PATH: process.env.PATH!, HOME: process.env.HOME!, NODE_ENV: "production", NEXT_DIST_DIR: DIST },
      encoding: "utf8",
    })
    expect(build.status, build.stderr + build.stdout).toBe(0)
    expect(existsSync(path.join(APP, DIST, "arciin-build.json"))).toBe(true)

    // Only what the vendor env allowlist hands the portal — no DATABASE_URL,
    // no session secret — exactly as PM2 runs it.
    portal = spawn("pnpm", ["exec", "next", "start", "-p", String(portalPort), "-H", "127.0.0.1"], {
      cwd: APP,
      env: {
        PATH: process.env.PATH!,
        HOME: process.env.HOME!,
        NODE_ENV: "production",
        NEXT_DIST_DIR: DIST,
        LICENSE_SERVER_URL: `http://127.0.0.1:${licensePort}`,
      },
      stdio: ["ignore", "pipe", "pipe"],
    })
    portal.stdout!.on("data", (d) => (portalLog += String(d)))
    portal.stderr!.on("data", (d) => (portalLog += String(d)))
    for (let i = 0; i < 120; i++) {
      try {
        await fetch(`http://127.0.0.1:${portalPort}/`, { redirect: "manual" })
        break
      } catch {
        await new Promise((r) => setTimeout(r, 250))
      }
    }
  }, 300_000)

  afterAll(async () => {
    portal?.kill("SIGTERM")
    await new Promise<void>((r) => license?.close(() => r()) ?? r())
    rmSync(path.join(APP, DIST), { recursive: true, force: true })
  })

  it("stamps the build with the Next and React it was made with", () => {
    const stamp = JSON.parse(readFileSync(path.join(APP, DIST, "arciin-build.json"), "utf8"))
    const installed = JSON.parse(readFileSync(path.join(APP, "node_modules/next/package.json"), "utf8")).version
    expect(stamp.next).toBe(installed)
  })

  it("serves every page with the license server up", async () => {
    mode = "online"
    expect([307, 308, 200]).toContain((await get("/")).status)
    for (const page of PAGES) {
      const res = await get(page)
      expect(res.status, page).toBe(200)
      expect(res.body).not.toContain("renderToPipeableStream")
    }
    // The data really came from the license server, not an error state.
    expect((await get("/account")).body).toContain("Demo Customer")
    expect((await get("/account/servers")).body).toContain("Home server")
  })

  it.each(["offline", "bad"] as const)("license server %s: every page still renders, with an error instead of a crash", async (m) => {
    mode = m
    if (m === "offline") await new Promise<void>((r) => license.close(() => r()))
    try {
      for (const page of PAGES) expect((await get(page)).status, `${m} ${page}`).toBe(200)
    } finally {
      if (m === "offline") await new Promise<void>((r) => license.listen(licensePort, "127.0.0.1", r))
    }
  })

  it("license server slow: the page gives up in seconds instead of hanging", async () => {
    mode = "slow"
    const res = await get("/account")
    expect(res.status).toBe(200)
    expect(res.body).toContain("did not answer in time")
    expect(res.ms).toBeLessThan(15_000)
    mode = "online"
  }, 60_000)

  it("the server never logged the old failure and is still up", async () => {
    expect(portalLog).not.toContain("renderToPipeableStream")
    expect(portal.exitCode).toBeNull()
  })
})

import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

import { evaluateLicenseState, featuresForPlan, hasFeature } from "@arciin/config"

const repoRoot = path.resolve(__dirname, "..")

function read(relative: string): string {
  return fs.readFileSync(path.join(repoRoot, relative), "utf8")
}

/** Search tracked source only — node_modules and build output are noise. */
function grepTracked(pattern: string, pathspec: string[]): string[] {
  try {
    return execFileSync("git", ["grep", "-l", "-E", pattern, "--", ...pathspec], {
      cwd: repoRoot,
      encoding: "utf8",
    })
      .split("\n")
      .filter(Boolean)
  } catch {
    // git grep exits 1 when nothing matches.
    return []
  }
}

describe("the product cannot mint its own entitlement", () => {
  it("has no license-creation route in the API", () => {
    const routes = read("apps/api/src/modules/license/routes.ts")
    expect(routes).not.toContain('"/license/demo"')
    expect(routes).not.toContain("hostedCreateDemo")
  })

  it("has no client that calls a license-creation endpoint", () => {
    const client = read("apps/web/lib/api/license.ts")
    expect(client).not.toContain("createDemoLicense")
    expect(client).not.toContain("/license/demo")
  })

  it("ships no code path anywhere in the product that asks the authority for a license", () => {
    const offenders = grepTracked("license/demo|hostedCreateDemo", [
      "apps/api/src",
      "apps/web/lib",
      "apps/web/components",
      "apps/web/app",
    ])
    expect(offenders).toEqual([])
  })

  it("keeps the license server client free of an issuance helper", () => {
    const hostedClient = read("apps/api/src/services/license/hosted-client.ts")
    expect(hostedClient).not.toContain("licenses/issue")
    expect(hostedClient).not.toContain("licenses/demo")
  })
})

describe("no signing capability ships to a customer", () => {
  it("does not carry a private signing key in tracked source", () => {
    const offenders = grepTracked("LICENSE_SIGNING_KEY=[A-Za-z0-9_-]{20}", [
      ":!*.test.ts",
      ":!tests/*",
    ])
    expect(offenders).toEqual([])
  })

  it("does not ask the installer to generate a verification secret", () => {
    const installer = read("install.sh")
    // The only permitted mention is the cleanup that strips the stale value.
    expect(installer).not.toContain('_set_env_kv "$env_file" "ARCIIN_LICENSE_VERIFY_SECRET"')
  })

  it("publishes only public key material in the shipped registry", () => {
    const signing = read("packages/config/src/license-signing.ts")
    // A JWK private scalar would appear as a `d` field; the registry holds `publicKey` only.
    expect(signing).not.toMatch(/\bd:\s*"[A-Za-z0-9_-]{43}"/)
    expect(signing).toContain("publicKey:")
  })
})

describe("losing an entitlement never locks a customer out", () => {
  const base = {
    instanceId: "instance-1",
    keyPrefix: "ARC_PRO…ABCD",
    activatedAt: new Date(Date.now() - 60 * 86_400_000),
    signedToken: "arclic.v3.body.sig",
    source: "hosted" as const,
  }

  it("keeps premium alive inside the grace window", () => {
    const state = evaluateLicenseState({
      ...base,
      plan: "pro",
      status: "active",
      expiresAt: new Date(Date.now() - 86_400_000),
      graceUntil: new Date(Date.now() + 6 * 86_400_000),
    })
    expect(state.status).toBe("grace")
    expect(state.premiumActive).toBe(true)
  })

  it("falls back to free core once grace has run out", () => {
    const state = evaluateLicenseState({
      ...base,
      plan: "pro",
      status: "active",
      expiresAt: new Date(Date.now() - 30 * 86_400_000),
      graceUntil: new Date(Date.now() - 20 * 86_400_000),
    })
    expect(state.status).toBe("expired")
    expect(state.premiumActive).toBe(false)
    expect(state.plan).toBe("free")
  })

  it("still allows file access after an entitlement disappears entirely", () => {
    const state = evaluateLicenseState({
      ...base,
      plan: "pro",
      status: "active",
      expiresAt: new Date(Date.now() - 30 * 86_400_000),
      graceUntil: new Date(Date.now() - 20 * 86_400_000),
    })
    // The promise on the pricing page: an expired license never locks you out.
    expect(hasFeature(state, "core.files")).toBe(true)
    expect(hasFeature(state, "core.libraries")).toBe(true)
    expect(hasFeature(state, "core.uploads")).toBe(true)
    expect(hasFeature(state, "core.manual_backup")).toBe(true)
    // ...but the paid capability is gone.
    expect(hasFeature(state, "vault.password")).toBe(false)
    expect(hasFeature(state, "ai.chat")).toBe(false)
  })

  it("free core includes everything needed to get data back out", () => {
    const free = featuresForPlan("free")
    expect(free).toContain("core.files")
    expect(free).toContain("core.manual_backup")
  })
})

describe("in-app upgrade links point at the public website", () => {
  const surfaces = [
    "apps/web/components/settings/license-panel.tsx",
    "apps/web/components/license/soft-lock-banner.tsx",
    "apps/web/components/license/plan-required-message.tsx",
  ]

  for (const surface of surfaces) {
    it(`${path.basename(surface)} does not link to the local prototype portal`, () => {
      expect(read(surface)).not.toContain("localhost:3010")
    })
  }

  it("defaults to the public site rather than a developer machine", () => {
    const helper = read("apps/web/lib/license/upgrade-url.ts")
    // arciin.com is live now. This asserted the Vercel deployment URL while the
    // custom domain was being set up, which meant every "get a license" button
    // in a customer's instance sent them to a deployment hostname — and said so
    // in the button text.
    expect(helper).toContain("https://arciin.com")
    expect(helper, "the deployment URL must not be the default").not.toContain(
      '"https://arciin.vercel.app"',
    )
    expect(helper).not.toContain("localhost:3010")
  })
})

describe("paid capabilities are enforced by the API, not just the UI", () => {
  const gated: Array<[string, string]> = [
    ["apps/api/src/modules/password-vault/routes.ts", "vault.password"],
    ["apps/api/src/modules/api-keys/routes.ts", "developer.api_keys"],
    ["apps/api/src/modules/webhooks/routes.ts", "developer.webhooks"],
    ["apps/api/src/modules/app-databases/routes.ts", "developer.app_databases"],
    ["apps/api/src/modules/chat/routes.ts", "ai.chat"],
    ["apps/api/src/modules/jobs/routes.ts", "ops.job_controls"],
    ["apps/api/src/modules/settings/routes.ts", "ops.remote_access_helper"],
  ]

  for (const [file, feature] of gated) {
    it(`${path.basename(path.dirname(file))} enforces ${feature}`, () => {
      expect(read(file)).toContain(`requireFeature("${feature}")`)
    })
  }

  it("leaves reading jobs available to free instances", () => {
    const jobs = read("apps/api/src/modules/jobs/routes.ts")
    const listRoute = jobs.slice(jobs.indexOf('fastify.get(\n    "/jobs"'))
    expect(listRoute.slice(0, 300)).not.toContain("requireFeature")
  })
})

/**
 * A throwaway licensing authority for the VM install tests: the real license
 * server code, a /tmp SQLite database and the committed TEST signing key
 * (tests/license-server/test-env.ts). It signs nothing real.
 *
 *   pnpm exec tsx tests/install/test-authority.mts <out-dir>
 *
 * Listens on 0.0.0.0:4398 so test VMs can reach it, issues one Pro licence,
 * and writes <out-dir>/license-key and <out-dir>/public-keys
 * (kid:publicKey, for ARCIIN_LICENSE_PUBLIC_KEYS on the instance under test).
 */
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

// test-env.ts is CommonJS to this ESM entry; take its exports either way.
const testEnvModule = await import("../license-server/test-env.ts")
const testEnv = ("default" in testEnvModule ? testEnvModule.default : testEnvModule) as typeof import("../license-server/test-env.ts")
const { LICENSE_TEST_SERVICE_TOKEN, LICENSE_TEST_SIGNING_KEY, LICENSE_TEST_SIGNING_KID, licenseTestEnv } = testEnv

const out = process.argv[2]
if (!out) throw new Error("usage: test-authority.mts <out-dir>")
const db = "/tmp/arciin-vm-license/licenses.db"
const port = 4398

fs.rmSync(path.dirname(db), { recursive: true, force: true })
fs.mkdirSync(path.dirname(db), { recursive: true })
fs.mkdirSync(out, { recursive: true })
Object.assign(process.env, licenseTestEnv, {
  LICENSE_DATABASE_URL: `file:${db}`,
  LICENSE_SERVER_PORT: String(port),
})
execFileSync("npx", ["prisma", "db", "push", "--schema", "apps/license-server/prisma/schema.prisma", "--skip-generate"], {
  env: process.env,
  stdio: "inherit",
})

const { licensePublicKeyFromPrivate } = await import("@arciin/config")
const { buildLicenseServer } = await import("../../apps/license-server/src/server.js")
const app = await buildLicenseServer()
await app.listen({ port, host: process.env.ARCIIN_TEST_AUTHORITY_HOST || "0.0.0.0" })

const res = await fetch(`http://127.0.0.1:${port}/licenses/issue`, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${LICENSE_TEST_SERVICE_TOKEN}` },
  body: JSON.stringify({
    externalOrderId: `vm-test-${Date.now()}`,
    plan: "pro",
    billingInterval: "monthly",
    customerEmail: "vm-test@example.invalid",
    customerName: "VM Test",
  }),
})
const body = (await res.json()) as { data?: { licenseKey?: string } }
if (!body.data?.licenseKey) throw new Error(`could not issue a test licence (${res.status})`)
fs.writeFileSync(path.join(out, "license-key"), body.data.licenseKey, { mode: 0o600 })
fs.writeFileSync(
  path.join(out, "public-keys"),
  `${LICENSE_TEST_SIGNING_KID}:${licensePublicKeyFromPrivate(LICENSE_TEST_SIGNING_KEY)}`,
)
console.log(`test authority on :${port}; Pro licence issued (pro, 1 server)`)

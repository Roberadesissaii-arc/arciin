import { execSync } from "node:child_process"
import path from "node:path"

import { describe, expect, it } from "vitest"

const ROOT = path.resolve(import.meta.dirname, "../..")
const LIB = path.join(ROOT, "scripts/lib/db-credentials.sh")

function run(script: string) {
  return execSync(`source "${LIB}"; ${script}`, {
    cwd: ROOT,
    encoding: "utf8",
    shell: "/bin/bash",
    env: process.env,
  }).trim()
}

describe("generated installer credential authenticates (ARC-009)", () => {
  it("creates a throwaway role on the isolated test Postgres", () => {
    const adminUrl = process.env.DATABASE_URL
    expect(adminUrl).toContain("arciin_test")
    const password = run("arciin_generate_db_password")
    const encoded = run(`arciin_urlencode_db_password "${password}"`)
    const role = `arciin_w4_${Date.now()}`
    const db = `${role}_db`
    const admin = new URL(adminUrl!)
    const adminEnv = {
      ...process.env,
      PGPASSWORD: decodeURIComponent(admin.password),
      PGHOST: admin.hostname,
      PGPORT: admin.port,
      PGUSER: admin.username,
    }
    const roleEnv = { ...process.env, PGPASSWORD: password, PGHOST: admin.hostname, PGPORT: admin.port, PGUSER: role }
    try {
      expect(/^[0-9a-f]+$/.test(password)).toBe(true)
      execSync(`psql -d postgres -v ON_ERROR_STOP=1 -c "CREATE ROLE ${role} WITH LOGIN PASSWORD '${password}'"`, {
        env: adminEnv,
        stdio: "pipe",
      })
      execSync(`psql -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE ${db} OWNER ${role}"`, {
        env: adminEnv,
        stdio: "pipe",
      })
      const who = execSync(`psql -d ${db} -tAc "SELECT current_user"`, {
        encoding: "utf8",
        env: roleEnv,
      }).trim()
      expect(who).toBe(role)
      const url = `postgresql://${role}:${encoded}@${admin.hostname}:${admin.port}/${db}`
      expect(decodeURIComponent(new URL(url).password)).toBe(password)
    } finally {
      try {
        execSync(`psql -d postgres -c "DROP DATABASE IF EXISTS ${db}"`, { env: adminEnv, stdio: "pipe" })
        execSync(`psql -d postgres -c "DROP ROLE IF EXISTS ${role}"`, { env: adminEnv, stdio: "pipe" })
      } catch {
        /* isolated cleanup */
      }
    }
  })
})

import { execFileSync } from "node:child_process"
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it } from "vitest"

/**
 * Which backup directory the nightly job trusts.
 *
 * backup.sh took the newest directory matching 20* as rsync's --link-dest. A
 * DB-only manual dump named 20260927-175405-… (no storage/) sorted last, so the
 * next nightly copied all of storage in full, filled the disk and failed
 * partway. The same had already happened on 2026-09-21. Every case here runs
 * against throwaway fixture directories — never the real backups.
 */

const REPO = path.resolve(__dirname, "..")
const HELPER = path.join(REPO, "scripts/lib/backup-snapshots.sh")
const tmp: string[] = []

afterEach(() => {
  for (const dir of tmp.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function workspace() {
  const dir = mkdtempSync(path.join(tmpdir(), "arciin-backup-snap-"))
  tmp.push(dir)
  return dir
}

type Shape = { storage?: boolean; dump?: boolean; manifest?: "legacy" | "v2" | false; complete?: boolean }

function snapshot(dest: string, name: string, shape: Shape) {
  const dir = path.join(dest, name)
  mkdirSync(dir, { recursive: true })
  if (shape.storage) {
    mkdirSync(path.join(dir, "storage/objects"), { recursive: true })
    writeFileSync(path.join(dir, "storage/objects/a.bin"), "a")
  }
  if (shape.dump) writeFileSync(path.join(dir, "database.dump"), "dump")
  if (shape.manifest === "legacy") writeFileSync(path.join(dir, "MANIFEST.txt"), "arciin backup\ncreated: x\n")
  if (shape.manifest === "v2") writeFileSync(path.join(dir, "MANIFEST.txt"), "arciin backup\nformat: 2\ncreated: x\n")
  if (shape.complete) writeFileSync(path.join(dir, "COMPLETE"), "x")
  return dir
}

function helper(fn: string, ...args: string[]) {
  return execFileSync("bash", ["-c", `source "${HELPER}"; ${fn} "$@"`, "helper", ...args], { encoding: "utf8" }).trim()
}

function isComplete(dir: string) {
  try {
    execFileSync("bash", ["-c", `source "${HELPER}"; backup_is_complete_snapshot "$1"`, "helper", dir])
    return true
  } catch {
    return false
  }
}

const FULL: Shape = { storage: true, dump: true, manifest: "v2", complete: true }

describe("what counts as a complete nightly snapshot", () => {
  it.each<[string, string, Shape, boolean]>([
    ["current format with COMPLETE", "20260927-031501", FULL, true],
    ["older snapshot with a manifest (before the marker existed)", "20260926-031501", { storage: true, dump: true, manifest: "legacy" }, true],
    ["current format missing COMPLETE", "20260927-031501", { storage: true, dump: true, manifest: "v2" }, false],
    ["DB-only dump (no storage/)", "20260927-175405", { dump: true, manifest: "legacy" }, false],
    ["partial run: storage and dump, no manifest", "20260928-031501", { storage: true, dump: true }, false],
    ["no database.dump", "20260925-031501", { storage: true, manifest: "legacy" }, false],
    ["manual-* even when complete", "manual-20260927-175405-post-v1.1.0", FULL, false],
    ["named pre-deploy backup", "20260927-125340-v1.1.0-post-migration-pre-deploy", FULL, false],
    ["other folder", "pre-backup-removal-20260921-023146", FULL, false],
  ])("%s → %s", (_label, name, shape, expected) => {
    const dest = workspace()
    expect(isComplete(snapshot(dest, name, shape))).toBe(expected)
  })
})

describe("the link-dest source", () => {
  it("is the newest complete nightly, skipping newer partial, DB-only and manual directories", () => {
    const dest = workspace()
    snapshot(dest, "20260926-031501", { storage: true, dump: true, manifest: "legacy" })
    snapshot(dest, "20260927-031501", FULL)
    snapshot(dest, "20260927-175405", { dump: true, manifest: "legacy" })
    snapshot(dest, "manual-20260927-175405-post-v1.1.0-pre-postgres-password-rotation", { dump: true, manifest: "legacy" })
    snapshot(dest, "20260928-031501", { storage: true, dump: true })
    expect(path.basename(helper("backup_latest_complete_snapshot", dest))).toBe("20260927-031501")
  })

  it("never picks the run that is being written", () => {
    const dest = workspace()
    snapshot(dest, "20260927-031501", FULL)
    snapshot(dest, "20260928-031501", FULL)
    expect(path.basename(helper("backup_latest_complete_snapshot", dest, "20260928-031501"))).toBe("20260927-031501")
  })

  it("is empty when nothing complete exists, so the run makes a full copy instead of a wrong link", () => {
    const dest = workspace()
    snapshot(dest, "20260928-031501", { storage: true, dump: true })
    snapshot(dest, "manual-20260927-125340", FULL)
    expect(helper("backup_latest_complete_snapshot", dest)).toBe("")
  })
})

describe("retention", () => {
  it("prunes only complete nightlies beyond KEEP — never manual, named, DB-only or partial directories", () => {
    const dest = workspace()
    for (const day of ["21", "22", "23", "24"]) snapshot(dest, `202609${day}-031501`, FULL)
    snapshot(dest, "20260920-031501", { storage: true, dump: true })
    snapshot(dest, "manual-20260919-000000", FULL)
    snapshot(dest, "20260919-120000-v1.1.0-pre-deploy", FULL)
    const prunable = helper("backup_prunable_snapshots", dest, "2").split("\n").map((p) => path.basename(p))
    expect(prunable).toEqual(["20260921-031501", "20260922-031501"])
  })
})

describe("backup.sh end to end (fixture storage, stub pg_dump)", () => {
  function sandbox() {
    const root = workspace()
    // A copy of the scripts in their own root: backup.sh sources <root>/.env,
    // which in the live checkout is production. This root has none.
    mkdirSync(path.join(root, "scripts/lib"), { recursive: true })
    cpSync(path.join(REPO, "scripts/backup.sh"), path.join(root, "scripts/backup.sh"))
    cpSync(HELPER, path.join(root, "scripts/lib/backup-snapshots.sh"))
    const bin = path.join(root, "bin")
    mkdirSync(bin)
    writeFileSync(
      path.join(bin, "pg_dump"),
      '#!/usr/bin/env bash\nfor a in "$@"; do case "$a" in --file=*) echo stub > "${a#--file=}";; esac; done\n',
    )
    chmodSync(path.join(bin, "pg_dump"), 0o755)
    const storage = path.join(root, "storage")
    mkdirSync(path.join(storage, "objects"), { recursive: true })
    writeFileSync(path.join(storage, "objects/original.bin"), "x".repeat(4096))
    const dest = path.join(root, "backups")
    mkdirSync(dest)
    const run = () =>
      execFileSync("bash", [path.join(root, "scripts/backup.sh"), dest], {
        encoding: "utf8",
        env: { PATH: `${bin}:${process.env.PATH}`, HOME: root, DATABASE_URL: "postgresql://stub/stub", ARCIIN_DATA_DIR: storage, ARCIIN_BACKUP_KEEP: "7" },
      })
    return { dest, run }
  }

  it("marks a finished run COMPLETE and hard-links the next run against it despite a newer manual DB-only dump", async () => {
    const { dest, run } = sandbox()
    run()
    const first = helper("backup_latest_complete_snapshot", dest)
    expect(existsSync(path.join(first, "COMPLETE"))).toBe(true)
    expect(readFileSync(path.join(first, "MANIFEST.txt"), "utf8")).toContain("format: 2")

    // The trap that caused the incident: a newer, nightly-looking DB-only dump.
    const stamp = path.basename(first)
    const decoy = `${stamp.slice(0, 9)}235959`
    snapshot(dest, decoy, { dump: true, manifest: "legacy" })

    await new Promise((r) => setTimeout(r, 1100)) // backup.sh names runs by the second
    const out = run()
    expect(out).toContain(`hard-linking unchanged files against ${first}`)
    const second = helper("backup_latest_complete_snapshot", dest)
    expect(second).not.toBe(first)
    const a = statSync(path.join(first, "storage/objects/original.bin"))
    const b = statSync(path.join(second, "storage/objects/original.bin"))
    expect(b.ino).toBe(a.ino) // same inode: linked, not copied
    expect(existsSync(path.join(dest, decoy))).toBe(true) // and never pruned
  })
})

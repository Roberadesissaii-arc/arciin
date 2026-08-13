import { execFile, spawn } from "node:child_process"
import fs from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"

import { resolveMobileLocalAccessUrls } from "@/services/remote-access/local-access-urls"

const execFileAsync = promisify(execFile)

export const ARCIIN_SERVER_REPO_URL = "https://github.com/Roberadesissaii-arc/arciin.git"
export const ARCIIN_MOBILE_REPO_URL = "https://github.com/Roberadesissaii-arc/arciin-app.git"

export type MobileAppInstallStatus = {
  clonePresent: boolean
  pm2Online: boolean
  installed: boolean
  installRunning: boolean
  installState: "idle" | "running" | "done" | "failed"
  serverRoot: string
  mobileDir: string
  mobilePort: string | null
  mobileUrl: string | null
  serverRepoUrl: string
  mobileRepoUrl: string
  installCommands: string
  installLogTail: string | null
}

function resolveServerRoot(): string {
  const fromEnv = process.env.ARCIIN_REPO_ROOT?.trim()
  if (fromEnv) return path.resolve(fromEnv)
  return path.resolve(process.cwd())
}

function resolveMobileDir(serverRoot: string): string {
  const fromEnv = process.env.ARCIIN_MOBILE_DIR?.trim()
  if (fromEnv) return path.resolve(fromEnv)
  return path.resolve(serverRoot, "..", "arciin-app")
}

function buildInstallCommands(serverRoot: string, mobileDir: string): string {
  const parent = path.dirname(serverRoot)
  const mobileName = path.basename(mobileDir)
  const serverName = path.basename(serverRoot)
  return `# On the server (SSH) — needs a real terminal for sudo if apt packages are missing.

# 1. Desktop stack already installed? Skip to step 2.
# cd ${serverRoot} && ./install.sh

# 2. Mobile PWA next to the server repo (reads ../${serverName}/.env for API URL)
cd ${parent}
git clone https://github.com/Roberadesissaii-arc/arciin-app.git ${mobileName} 2>/dev/null || true
cd ${mobileName}
# If Node/pnpm already exist (desktop install did apt), skip system packages:
ARCIIN_MOBILE_SKIP_SYSTEM_PACKAGES=1 ./install.sh`
}

async function readInstallState(serverRoot: string): Promise<MobileAppInstallStatus["installState"]> {
  try {
    const raw = await fs.readFile(path.join(serverRoot, "logs", "mobile-install.status"), "utf8")
    const value = raw.trim()
    if (value === "running" || value === "done" || value === "failed") return value
  } catch {
    /* idle */
  }
  return "idle"
}

/** Strip ANSI / spinner junk so UI logs stay readable. */
function stripAnsi(text: string): string {
  return text
    .replace(/\u001b\[[0-9;]*[a-zA-Z]/g, "")
    .replace(/\r/g, "")
    .replace(/[^\S\n]+$/gm, "")
}

async function readInstallLogTail(serverRoot: string): Promise<string | null> {
  try {
    const raw = await fs.readFile(path.join(serverRoot, "logs", "mobile-install.log"), "utf8")
    const clean = stripAnsi(raw)
    const lines = clean
      .trim()
      .split("\n")
      .map((l) => l.trimEnd())
      .filter((l) => l.length > 0)
    // Prefer the last meaningful lines (skip pure banner art)
    const useful = lines.filter(
      (l) =>
        !/^█/.test(l) &&
        !/^╚/.test(l) &&
        !/^║/.test(l) &&
        !/^═/.test(l) &&
        !/^[─\s]+$/.test(l),
    )
    const slice = (useful.length > 0 ? useful : lines).slice(-24)
    return slice.join("\n") || null
  } catch {
    return null
  }
}

async function isPm2MobileOnline(): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync("pm2", ["jlist"], { timeout: 8000 })
    const list = JSON.parse(stdout) as Array<{ name?: string; pm2_env?: { status?: string } }>
    return list.some((p) => p.name === "arciin-mobile" && p.pm2_env?.status === "online")
  } catch {
    return false
  }
}

async function mobileClonePresent(mobileDir: string): Promise<boolean> {
  try {
    await fs.access(path.join(mobileDir, "install.sh"))
    return true
  } catch {
    return false
  }
}

export async function getMobileAppInstallStatus(): Promise<MobileAppInstallStatus> {
  const serverRoot = resolveServerRoot()
  const mobileDir = resolveMobileDir(serverRoot)
  const clonePresent = await mobileClonePresent(mobileDir)
  const pm2Online = await isPm2MobileOnline()
  const installState = await readInstallState(serverRoot)
  const installRunning = installState === "running"
  const mobileLocal = resolveMobileLocalAccessUrls()

  return {
    clonePresent,
    pm2Online,
    installed: clonePresent && pm2Online,
    installRunning,
    installState,
    serverRoot,
    mobileDir,
    mobilePort: mobileLocal.webPort,
    mobileUrl: mobileLocal.primaryLanUrl ?? mobileLocal.localUrl,
    serverRepoUrl: ARCIIN_SERVER_REPO_URL,
    mobileRepoUrl: ARCIIN_MOBILE_REPO_URL,
    installCommands: buildInstallCommands(serverRoot, mobileDir),
    installLogTail: await readInstallLogTail(serverRoot),
  }
}

export type StartMobileAppInstallInput = {
  /** Optional host sudo password for apt during web install. Never logged or stored. */
  sudoPassword?: string
}

export async function startMobileAppInstall(
  input: StartMobileAppInstallInput = {},
): Promise<MobileAppInstallStatus> {
  const serverRoot = resolveServerRoot()
  const scriptPath = path.join(serverRoot, "scripts", "install-mobile-pwa.sh")

  try {
    await fs.access(scriptPath)
  } catch {
    throw new Error("Mobile install script is missing on this server.")
  }

  const current = await getMobileAppInstallStatus()
  if (current.installRunning) {
    return current
  }
  if (current.installed) {
    throw new Error("Arciin Mobile is already installed and running.")
  }

  const sudoPassword = input.sudoPassword?.trim() ?? ""
  if (sudoPassword.length > 256) {
    throw new Error("Sudo password is too long.")
  }

  const logsDir = path.join(serverRoot, "logs")
  await fs.mkdir(logsDir, { recursive: true })
  await fs.writeFile(path.join(logsDir, "mobile-install.status"), "running\n", "utf8")

  const logPath = path.join(logsDir, "mobile-install.log")
  // Truncate previous run so the UI shows a clean log for this attempt.
  const logFd = await fs.open(logPath, "w")

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ARCIIN_SERVER_DIR: serverRoot,
    ARCIIN_MOBILE_DIR: resolveMobileDir(serverRoot),
    ARCIIN_MOBILE_SKIP_INSTALL_CHOICE: "1",
    DEBIAN_FRONTEND: "noninteractive",
  }

  if (sudoPassword) {
    // Child process only — never write this value to logs or status files.
    env.ARCIIN_SUDO_PASSWORD = sudoPassword
    env.ARCIIN_MOBILE_SKIP_SYSTEM_PACKAGES = "0"
  } else {
    // No password: skip apt (desktop stack usually already has Node/pnpm).
    env.ARCIIN_MOBILE_SKIP_SYSTEM_PACKAGES = "1"
  }

  const proc = spawn("bash", [scriptPath], {
    cwd: serverRoot,
    detached: true,
    stdio: ["ignore", logFd.fd, logFd.fd],
    env,
  })
  proc.unref()
  void logFd.close()

  return getMobileAppInstallStatus()
}

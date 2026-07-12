import { execFile, spawn } from "node:child_process"
import { access, mkdir } from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"

import { apiConfig } from "@/config"
import {
  discoverUnmountedBlockDevices,
  isUsableBlockFilesystem,
  parseLinuxMounts,
} from "@/services/storage/discover-storage"

const execFileAsync = promisify(execFile)

export type MountBlockDeviceInput = {
  deviceId: string
  luksPassphrase?: string
  sudoPassword?: string
  /** Erase the drive and create ext4 before mounting (empty drives only). */
  formatAsExt4?: boolean
  confirmErase?: boolean
}

export type MountBlockDeviceResult = {
  device: string
  mountPoint: string
  arciinPath: string
  mapperName?: string
}

export class MountBlockDeviceError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "DEVICE_NOT_FOUND"
      | "ALREADY_MOUNTED"
      | "DOCKER_UNSUPPORTED"
      | "LUKS_PASSPHRASE_REQUIRED"
      | "SUDO_PASSWORD_REQUIRED"
      | "INVALID_PASSPHRASE"
      | "MOUNT_FAILED"
      | "NO_FILESYSTEM"
      | "ERASE_NOT_CONFIRMED"
      | "FORMAT_FAILED"
      | "VALIDATION_ERROR",
  ) {
    super(message)
    this.name = "MountBlockDeviceError"
  }
}

function isDockerRuntime() {
  return path.resolve(apiConfig.dataDir) === "/data/arciin"
}

function mapperNameFor(deviceName: string) {
  return `arciin-${deviceName.replace(/[^a-zA-Z0-9]/g, "")}`
}

function isLuksType(fstype: string | null) {
  return Boolean(fstype && /^crypto_LUKS/i.test(fstype))
}

async function canSudoWithoutPassword() {
  try {
    await execFileAsync("sudo", ["-n", "true"], { timeout: 5000 })
    return true
  } catch {
    return false
  }
}

export async function detectPasswordlessSudo() {
  if (isDockerRuntime()) return false
  return canSudoWithoutPassword()
}

function runAsRoot(
  args: string[],
  opts: { sudoPassword?: string; stdin?: string; timeout?: number } = {},
): Promise<{ stdout: string; stderr: string }> {
  const sudoArgs = opts.sudoPassword ? ["-S", ...args] : ["-n", ...args]
  const timeoutMs = opts.timeout ?? 120_000

  return new Promise((resolve, reject) => {
    const child = spawn("sudo", sudoArgs, { stdio: ["pipe", "pipe", "pipe"] })
    let stdout = ""
    let stderr = ""
    const timer = setTimeout(() => {
      child.kill("SIGTERM")
      reject(new MountBlockDeviceError("Mount command timed out.", "MOUNT_FAILED"))
    }, timeoutMs)

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk)
    })
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk)
    })
    child.on("error", (err) => {
      clearTimeout(timer)
      reject(new MountBlockDeviceError(err.message, "MOUNT_FAILED"))
    })
    child.on("close", (code) => {
      clearTimeout(timer)
      const msg = (stderr || stdout || "Command failed").trim()
      if (code === 0) {
        resolve({ stdout, stderr })
        return
      }
      if (!opts.sudoPassword && /password is required|a password is required/i.test(msg)) {
        reject(
          new MountBlockDeviceError(
            "Server sudo password is required to mount drives.",
            "SUDO_PASSWORD_REQUIRED",
          ),
        )
        return
      }
      reject(new MountBlockDeviceError(msg || "Mount command failed.", "MOUNT_FAILED"))
    })

    if (opts.sudoPassword) {
      child.stdin.write(`${opts.sudoPassword}\n`)
    }
    if (opts.stdin) {
      child.stdin.write(opts.stdin)
    }
    child.stdin.end()
  })
}

async function blkidType(devicePath: string, sudoPassword?: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("blkid", ["-o", "value", "-s", "TYPE", devicePath], {
      timeout: 8000,
    })
    const direct = stdout.trim()
    if (direct) return direct
  } catch {
    // Non-root API users often cannot read block devices — fall through to sudo.
  }
  try {
    const { stdout } = await runAsRoot(["blkid", "-o", "value", "-s", "TYPE", devicePath], {
      sudoPassword,
    })
    return stdout.trim() || null
  } catch {
    return null
  }
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })
}

async function refreshBlockTable(devicePath: string, sudoPassword?: string) {
  await runAsRoot(["partprobe", devicePath], { sudoPassword }).catch(() => {})
  await runAsRoot(["blockdev", "--rereadpt", devicePath], { sudoPassword }).catch(() => {})
  await execFileAsync("udevadm", ["settle"], { timeout: 15_000 }).catch(() => {})
}

async function listBlockPathsUnder(sourcePath: string): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync("lsblk", ["-rno", "PATH", sourcePath], {
      timeout: 10_000,
    })
    const paths = stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("/dev/"))
    return paths.length > 0 ? paths : [sourcePath]
  } catch {
    return [sourcePath]
  }
}

async function resolveBlockDeviceWithFilesystem(
  mountSource: string,
  sudoPassword?: string,
  knownFstype?: string | null,
): Promise<{ devicePath: string; fsType: string } | null> {
  await runAsRoot(["partprobe", mountSource], { sudoPassword }).catch(() => {})

  const candidates = await listBlockPathsUnder(mountSource)
  for (const devicePath of candidates) {
    const fsType = await blkidType(devicePath, sudoPassword)
    if (fsType && !isLuksType(fsType)) {
      return { devicePath, fsType }
    }
  }

  if (knownFstype && isUsableBlockFilesystem(knownFstype)) {
    const preferred = candidates.includes(mountSource) ? mountSource : candidates[0]
    if (preferred) {
      return { devicePath: preferred, fsType: knownFstype }
    }
  }

  return null
}

async function ensureLvmVolumeActive(devicePath: string, sudoPassword?: string) {
  if (!devicePath.startsWith("/dev/mapper/")) return
  await runAsRoot(["vgchange", "-ay"], { sudoPassword, timeout: 30_000 }).catch(() => {})
}

async function formatDeviceExt4(devicePath: string, sudoPassword?: string) {
  try {
    await runAsRoot(["mkfs.ext4", "-F", "-L", "arciin-data", devicePath], {
      sudoPassword,
      timeout: 600_000,
    })
  } catch (err) {
    if (err instanceof MountBlockDeviceError) {
      throw new MountBlockDeviceError(
        err.message || "Could not format the drive as ext4.",
        "FORMAT_FAILED",
      )
    }
    throw new MountBlockDeviceError("Could not format the drive as ext4.", "FORMAT_FAILED")
  }
}

async function ensureMountPoint(mountPoint: string, sudoPassword?: string) {
  try {
    await access(mountPoint)
  } catch {
    await runAsRoot(["mkdir", "-p", mountPoint], { sudoPassword })
  }
}

async function appendFstabIfMissing(line: string, sudoPassword?: string) {
  const { stdout } = await runAsRoot(["cat", "/etc/fstab"], { sudoPassword })
  const source = line.split(/\s+/)[0]!
  if (stdout.split("\n").some((row) => row.trim().startsWith(source))) return
  const escaped = line.replace(/'/g, "'\\''")
  await runAsRoot(["sh", "-c", `echo '${escaped}' >> /etc/fstab`], { sudoPassword })
}

async function chownMountToServiceUser(mountPoint: string, sudoPassword?: string) {
  const user = process.env.SUDO_USER || process.env.USER || "arciin"
  let uid = ""
  let gid = ""
  try {
    const uidRes = await runAsRoot(["id", "-u", user], { sudoPassword })
    uid = uidRes.stdout.trim()
    const gidRes = await runAsRoot(["id", "-g", user], { sudoPassword })
    gid = gidRes.stdout.trim()
  } catch {
    return
  }
  if (!uid) return
  await runAsRoot(["chown", "-R", `${uid}:${gid || uid}`, mountPoint], {
    sudoPassword,
    timeout: 120_000,
  })
}

export async function mountBlockDevice(
  input: MountBlockDeviceInput,
): Promise<MountBlockDeviceResult> {
  if (isDockerRuntime()) {
    throw new MountBlockDeviceError(
      "Mounting disks from Docker is not supported. Mount the drive on the host, then rescan.",
      "DOCKER_UNSUPPORTED",
    )
  }

  const devices = await discoverUnmountedBlockDevices()
  const device = devices.find((d) => d.id === input.deviceId)
  if (!device) {
    throw new MountBlockDeviceError(
      "Drive not found or already mounted. Tap Rescan.",
      "DEVICE_NOT_FOUND",
    )
  }

  const mounts = await parseLinuxMounts()
  if (mounts.some((m) => m.device === device.device)) {
    throw new MountBlockDeviceError("Drive is already mounted.", "ALREADY_MOUNTED")
  }

  const passwordlessSudo = await canSudoWithoutPassword()
  const sudoPassword = input.sudoPassword?.trim() || undefined
  if (!passwordlessSudo && !sudoPassword) {
    throw new MountBlockDeviceError(
      "Server sudo password is required to mount drives.",
      "SUDO_PASSWORD_REQUIRED",
    )
  }

  let mountSource = device.device
  let mapperName: string | undefined

  await ensureLvmVolumeActive(mountSource, sudoPassword)

  const deviceType = device.filesystem || (await blkidType(device.device, sudoPassword))
  const luks = device.isLuks || isLuksType(deviceType)

  if (luks) {
    if (!input.luksPassphrase) {
      throw new MountBlockDeviceError(
        "This drive is encrypted (LUKS). Enter the disk encryption password.",
        "LUKS_PASSPHRASE_REQUIRED",
      )
    }
    mapperName = mapperNameFor(device.name)
    try {
      await runAsRoot(
        ["cryptsetup", "open", device.device, mapperName, "--key-file=-"],
        { sudoPassword, stdin: input.luksPassphrase },
      )
    } catch (err) {
      if (err instanceof MountBlockDeviceError) {
        if (/wrong|bad|no key|failure|incorrect|denied/i.test(err.message)) {
          throw new MountBlockDeviceError("Incorrect disk encryption password.", "INVALID_PASSPHRASE")
        }
        throw err
      }
      throw new MountBlockDeviceError("Could not unlock encrypted drive.", "INVALID_PASSPHRASE")
    }
    mountSource = `/dev/mapper/${mapperName}`
  }

  let resolved = await resolveBlockDeviceWithFilesystem(
    mountSource,
    sudoPassword,
    device.filesystem,
  )
  let mountTarget = mountSource
  let fsType: string | null = resolved?.fsType ?? null

  if (!resolved) {
    if (input.formatAsExt4) {
      if (!input.confirmErase) {
        if (mapperName) {
          await runAsRoot(["cryptsetup", "close", mapperName], { sudoPassword }).catch(() => {})
        }
        throw new MountBlockDeviceError(
          "Confirm that you want to erase this drive before formatting.",
          "ERASE_NOT_CONFIRMED",
        )
      }
      await formatDeviceExt4(mountSource, sudoPassword)
      let resolvedAfterFormat: { devicePath: string; fsType: string } | null = null
      for (let attempt = 0; attempt < 8; attempt += 1) {
        await refreshBlockTable(mountSource, sudoPassword)
        if (attempt > 0) await sleep(500 * attempt)
        resolvedAfterFormat = await resolveBlockDeviceWithFilesystem(
          mountSource,
          sudoPassword,
          "ext4",
        )
        if (resolvedAfterFormat) break
      }
      resolved = resolvedAfterFormat
      if (!resolved) {
        if (mapperName) {
          await runAsRoot(["cryptsetup", "close", mapperName], { sudoPassword }).catch(() => {})
        }
        throw new MountBlockDeviceError(
          "Format finished but no ext4 filesystem was detected. Try Rescan.",
          "FORMAT_FAILED",
        )
      }
    } else {
      if (mapperName) {
        await runAsRoot(["cryptsetup", "close", mapperName], { sudoPassword }).catch(() => {})
      }
      throw new MountBlockDeviceError(
        "No filesystem found on this drive. You can format it as ext4 from this screen (erases all data) or format on the server first.",
        "NO_FILESYSTEM",
      )
    }
  }

  mountTarget = resolved.devicePath
  fsType = resolved.fsType

  const mountPoint = device.suggestedMountPoint
  await ensureMountPoint(mountPoint, sudoPassword)

  try {
    await runAsRoot(["mount", mountTarget, mountPoint], { sudoPassword })
  } catch (err) {
    if (mapperName) {
      await runAsRoot(["cryptsetup", "close", mapperName], { sudoPassword }).catch(() => {})
    }
    if (err instanceof MountBlockDeviceError) throw err
    throw new MountBlockDeviceError("Mount failed. Check the drive and try again.", "MOUNT_FAILED")
  }

  await chownMountToServiceUser(mountPoint, sudoPassword)

  const arciinPath = device.suggestedArciinPath
  try {
    await mkdir(arciinPath, { recursive: true })
  } catch {
    await runAsRoot(["mkdir", "-p", arciinPath], { sudoPassword })
    await chownMountToServiceUser(arciinPath, sudoPassword)
  }

  const fstabFs =
    fsType === "ext4" || fsType === "xfs" || fsType === "btrfs" || fsType === "ntfs"
      ? fsType
      : "ext4"
  const fstabSource = mountTarget
  await appendFstabIfMissing(
    `${fstabSource} ${mountPoint} ${fstabFs} defaults,nofail 0 2`,
    sudoPassword,
  ).catch(() => {})

  return {
    device: device.device,
    mountPoint,
    arciinPath,
    mapperName,
  }
}

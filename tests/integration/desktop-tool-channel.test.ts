import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest"
import Redis from "ioredis"
import { io as ioClient, type Socket } from "socket.io-client"

import {
  DESKTOP_TOOL_REQUEST_EVENT,
  DESKTOP_TOOL_RESULT_EVENT,
  DESKTOP_TOOL_SOCKET_PATH,
} from "@arciin/config"
import { allDesktopToolsWithheld } from "@arciin/shared"

import { hashPassword, hashToken } from "../../apps/api/src/services/security/auth"
import {
  claimDevicePairing,
  createDevicePairing,
  revokeDevice,
} from "../../apps/api/src/services/devices/pairing"
import { executeArciinChatTool } from "../../apps/api/src/services/chat/arciin-chat-tools"
import { resolveDesktopChatGate } from "../../apps/api/src/services/desktop-tools/access"
import { resetDesktopToolHub } from "../../apps/api/src/services/desktop-tools/hub"
import { registerSocket } from "../../apps/api/src/plugins/socket"
import {
  createTestStorageRoot,
  prisma,
  removeTestStorageRoot,
  resetDatabase,
  seedBaseFixtures,
  type Fixtures,
} from "./setup"

let fixtures: Fixtures
let redis: Redis
let ownerId: string
let memberId: string

async function pairDevice(userId: string, name = "Cert Desktop") {
  const { code } = await createDevicePairing(prisma, userId)
  return claimDevicePairing(prisma, {
    code,
    name,
    platform: "windows",
    deviceType: "desktop",
    protocolVersion: 1,
  })
}

async function buildListeningApp() {
  const Fastify = (await import("fastify")).default
  const { registerCookies } = await import("../../apps/api/src/plugins/cookies")
  const { registerDiscoveryRoutes } = await import("../../apps/api/src/modules/devices/routes")
  const app = Fastify({ logger: false })
  app.decorate("prisma", prisma)
  app.decorate("redis", redis)
  await registerCookies(app)
  await registerDiscoveryRoutes(app)
  await registerSocket(app)
  await app.listen({ port: 0, host: "127.0.0.1" })
  const address = app.server.address()
  const port = typeof address === "object" && address ? address.port : 0
  return { app, port }
}

function connectDesktop(port: number, credential: string, protocolVersion = 1) {
  return ioClient(`http://127.0.0.1:${port}${DESKTOP_TOOL_SOCKET_PATH}`, {
    transports: ["websocket"],
    extraHeaders: { Authorization: `Device ${credential}` },
    auth: { protocolVersion },
    reconnection: false,
    timeout: 4_000,
  })
}

function waitConnected(socket: Socket) {
  return new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("connect timeout")), 4_000)
    socket.once("connect", () => {
      clearTimeout(t)
      resolve()
    })
    socket.once("connect_error", (err) => {
      clearTimeout(t)
      reject(err)
    })
  })
}

beforeAll(async () => {
  redis = new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: 1 })
  await redis.ping()
  const root = await createTestStorageRoot()
  await resetDatabase()
  fixtures = await seedBaseFixtures(root)
  ownerId = fixtures.user.id
  await prisma.user.update({
    where: { id: ownerId },
    data: { passwordHash: await hashPassword("TestPass123!") },
  })
  const member = await prisma.user.create({
    data: {
      email: `member-${Date.now()}@example.invalid`,
      name: "Member",
      passwordHash: await hashPassword("TestPass123!"),
      role: "MEMBER",
      status: "ACTIVE",
    },
  })
  memberId = member.id
})

afterAll(async () => {
  await resetDatabase()
  await removeTestStorageRoot()
  await redis.quit()
  await prisma.$disconnect()
})

beforeEach(() => {
  resetDesktopToolHub()
})

afterEach(() => {
  resetDesktopToolHub()
})

describe("discovery capability", () => {
  it("advertises aiDesktopTools without changing pairing protocol 1", async () => {
    const { app } = await buildListeningApp()
    try {
      const res = await app.inject({ method: "GET", url: "/.well-known/arciin" })
      const body = res.json()
      expect(body.protocolVersion).toBe(1)
      expect(body.capabilities.aiDesktopTools.supported).toBe(true)
      expect(body.capabilities.aiDesktopTools.protocolVersion).toBe(1)
    } finally {
      await app.close()
    }
  })
})

describe("desktop tool channel", () => {
  it("lets an eligible Device connect and answer a list tool", async () => {
    const paired = await pairDevice(ownerId)
    const { app, port } = await buildListeningApp()
    const socket = connectDesktop(port, paired.credential)
    try {
      await waitConnected(socket)
      socket.on(DESKTOP_TOOL_REQUEST_EVENT, (request: { id: string; tool: string }) => {
        socket.emit(DESKTOP_TOOL_RESULT_EVENT, {
          requestId: request.id,
          status: "ok",
          result: {
            entries: [
              {
                name: "resume.pdf",
                kind: "file",
                relativePath: "Interview/resume.pdf",
                size: 2048,
                modifiedAt: "2026-09-14T00:00:00.000Z",
                scopeId: "scope-desk",
              },
            ],
          },
          completedAt: new Date().toISOString(),
        })
      })

      const gate = await resolveDesktopChatGate({
        prisma,
        userId: ownerId,
        desktopComputerAccess: "metadata_only",
        desktopContext: { enabled: true, deviceId: paired.device.id },
      })
      expect(gate.expose).toBe(true)
      expect(gate.withheldTools.size).toBe(0)

      const result = await executeArciinChatTool(
        {
          function: {
            name: "desktop.list_directory",
            arguments: { scopeId: "scope-desk", relativePath: "Interview" },
          },
        },
        {
          prisma,
          storageRoot: null,
          baseUrl: "http://127.0.0.1:1",
          model: "test",
          userId: ownerId,
          desktopDeviceId: paired.device.id,
        },
      )
      expect(result.ok).toBe(true)
      const entries = (result.result as { entries: { name: string }[] }).entries
      expect(entries[0]?.name).toBe("resume.pdf")
    } finally {
      socket.close()
      await app.close()
    }
  })

  it("rejects a browser session connecting as the Device channel", async () => {
    const raw = `sess_${ownerId}_${crypto.randomUUID()}`
    await prisma.session.create({
      data: {
        userId: ownerId,
        tokenHash: hashToken(raw),
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    })
    const { app, port } = await buildListeningApp()
    const socket = ioClient(`http://127.0.0.1:${port}${DESKTOP_TOOL_SOCKET_PATH}`, {
      transports: ["websocket"],
      extraHeaders: { Authorization: `Bearer ${raw}` },
      reconnection: false,
      timeout: 3_000,
    })
    try {
      await expect(waitConnected(socket)).rejects.toThrow()
    } finally {
      socket.close()
      await app.close()
    }
  })

  it("returns DESKTOP_OFFLINE when the Device is not connected", async () => {
    const paired = await pairDevice(ownerId)
    const result = await executeArciinChatTool(
      {
        function: {
          name: "desktop.search_files",
          arguments: { query: "resume", scopeIds: ["scope-desk"] },
        },
      },
      {
        prisma,
        storageRoot: null,
        baseUrl: "http://127.0.0.1:1",
        model: "test",
        userId: ownerId,
        desktopDeviceId: paired.device.id,
      },
    )
    expect(result.error).toBe("DESKTOP_OFFLINE")
  })

  it("times out when Desktop never answers", async () => {
    const paired = await pairDevice(ownerId)
    const { app, port } = await buildListeningApp()
    const socket = connectDesktop(port, paired.credential)
    try {
      await waitConnected(socket)
      const result = await executeArciinChatTool(
        {
          function: {
            name: "desktop.stat_file",
            arguments: { scopeId: "scope-desk", relativePath: "resume.pdf" },
          },
        },
        {
          prisma,
          storageRoot: null,
          baseUrl: "http://127.0.0.1:1",
          model: "test",
          userId: ownerId,
          desktopDeviceId: paired.device.id,
        },
      )
      expect(result.error).toBe("DESKTOP_TOOL_TIMEOUT")
    } finally {
      socket.close()
      await app.close()
    }
  }, 25_000)

  it("fails in-flight work when the Device is revoked", async () => {
    const paired = await pairDevice(ownerId)
    const { app, port } = await buildListeningApp()
    const socket = connectDesktop(port, paired.credential)
    try {
      await waitConnected(socket)
      const pending = executeArciinChatTool(
        {
          function: {
            name: "desktop.list_directory",
            arguments: { scopeId: "scope-desk" },
          },
        },
        {
          prisma,
          storageRoot: null,
          baseUrl: "http://127.0.0.1:1",
          model: "test",
          userId: ownerId,
          desktopDeviceId: paired.device.id,
        },
      )
      await new Promise((r) => setTimeout(r, 50))
      await revokeDevice(prisma, paired.device.id)
      const result = await pending
      expect(result.error).toBe("DESKTOP_OFFLINE")
    } finally {
      socket.close()
      await app.close()
    }
  })

  it("replaces a duplicate channel", async () => {
    const paired = await pairDevice(ownerId)
    const { app, port } = await buildListeningApp()
    const first = connectDesktop(port, paired.credential)
    const second = connectDesktop(port, paired.credential)
    try {
      await waitConnected(first)
      await waitConnected(second)
      await new Promise((r) => setTimeout(r, 50))
      expect(first.connected).toBe(false)
      expect(second.connected).toBe(true)
    } finally {
      first.close()
      second.close()
      await app.close()
    }
  })

  it("withholds tools for another user's Device", async () => {
    const paired = await pairDevice(ownerId)
    const gate = await resolveDesktopChatGate({
      prisma,
      userId: memberId,
      desktopComputerAccess: "metadata_only",
      desktopContext: { enabled: true, deviceId: paired.device.id },
    })
    expect(gate.expose).toBe(false)
    expect(gate.reason).toBe("device_unowned")
    expect([...gate.withheldTools].sort()).toEqual([...allDesktopToolsWithheld()].sort())
  })

  it("withholds tools when AI Security is off even if the chat asks", async () => {
    const paired = await pairDevice(ownerId)
    const gate = await resolveDesktopChatGate({
      prisma,
      userId: ownerId,
      desktopComputerAccess: "off",
      desktopContext: { enabled: true, deviceId: paired.device.id },
    })
    expect(gate.expose).toBe(false)
    expect(gate.reason).toBe("security_off")
  })

  it("withholds tools when This PC is disabled on the chat turn", async () => {
    const gate = await resolveDesktopChatGate({
      prisma,
      userId: ownerId,
      desktopComputerAccess: "metadata_only",
      desktopContext: { enabled: false, deviceId: "x" },
    })
    expect(gate.expose).toBe(false)
    expect(gate.reason).toBe("disabled")
  })

  it("rejects an absolute-path result", async () => {
    const paired = await pairDevice(ownerId)
    const { app, port } = await buildListeningApp()
    const socket = connectDesktop(port, paired.credential)
    try {
      await waitConnected(socket)
      socket.on(DESKTOP_TOOL_REQUEST_EVENT, (request: { id: string }) => {
        socket.emit(DESKTOP_TOOL_RESULT_EVENT, {
          requestId: request.id,
          status: "ok",
          result: { relativePath: "C:\\Users\\x\\resume.pdf", scopeId: "scope-desk", name: "resume.pdf" },
          completedAt: new Date().toISOString(),
        })
      })
      const result = await executeArciinChatTool(
        {
          function: {
            name: "desktop.stat_file",
            arguments: { scopeId: "scope-desk", relativePath: "resume.pdf" },
          },
        },
        {
          prisma,
          storageRoot: null,
          baseUrl: "http://127.0.0.1:1",
          model: "test",
          userId: ownerId,
          desktopDeviceId: paired.device.id,
        },
      )
      expect(result.error).toBe("DESKTOP_RESULT_INVALID")
    } finally {
      socket.close()
      await app.close()
    }
  })

  it("requires an approval marker before upload or backup tools dispatch", async () => {
    const upload = await executeArciinChatTool(
      {
        function: {
          name: "desktop.upload_file_to_arciin",
          arguments: { scopeId: "scope-desk", relativePath: "resume.pdf" },
        },
      },
      {
        prisma,
        storageRoot: null,
        baseUrl: "http://127.0.0.1:1",
        model: "test",
        userId: ownerId,
        desktopDeviceId: "dev_placeholder",
      },
    )
    expect(upload.error).toBe("DESKTOP_TOOL_DENIED")
    expect(upload.needsConfirmation).toBe(true)

    const backup = await executeArciinChatTool(
      {
        function: {
          name: "desktop.enable_backup_for_folder",
          arguments: { scopeId: "scope-desk" },
        },
      },
      {
        prisma,
        storageRoot: null,
        baseUrl: "http://127.0.0.1:1",
        model: "test",
        userId: ownerId,
        desktopDeviceId: "dev_placeholder",
      },
    )
    expect(backup.error).toBe("DESKTOP_TOOL_DENIED")
    expect(backup.needsConfirmation).toBe(true)
  })

  it("treats a wrong protocol version as unsupported once connected", async () => {
    const paired = await pairDevice(ownerId)
    const { app, port } = await buildListeningApp()
    const socket = connectDesktop(port, paired.credential, 99)
    try {
      await waitConnected(socket)
      const result = await executeArciinChatTool(
        {
          function: {
            name: "desktop.list_directory",
            arguments: { scopeId: "scope-desk" },
          },
        },
        {
          prisma,
          storageRoot: null,
          baseUrl: "http://127.0.0.1:1",
          model: "test",
          userId: ownerId,
          desktopDeviceId: paired.device.id,
        },
      )
      expect(result.error).toBe("DESKTOP_TOOL_UNSUPPORTED")
    } finally {
      socket.close()
      await app.close()
    }
  })
})

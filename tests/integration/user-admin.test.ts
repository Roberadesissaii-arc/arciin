import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

import {
  buildHostedTokenPayload,
  parseLicensePrivateKey,
  signHostedLicenseToken,
} from "@arciin/config"

import {
  createManagedUser,
  deleteManagedUser,
  listUsers,
  updateManagedUser,
  UserAdminError,
} from "../../apps/api/src/services/user/admin-users"
import { hashPassword, hashToken } from "../../apps/api/src/services/security/auth"
import {
  createTestStorageRoot,
  prisma,
  removeTestStorageRoot,
  resetDatabase,
  seedBaseFixtures,
  type Fixtures,
} from "./setup"

const vendorKey = parseLicensePrivateKey("P1L5nJPd7wq0kUwqhU7SbXe0P4H2fT1YtGxWvBoNsRA")
const VENDOR_KID = "arciin-lic-test"

let fixtures: Fixtures
let ownerId: string

async function activateTeam(instanceId: string) {
  const token = signHostedLicenseToken(
    buildHostedTokenPayload({
      licenseId: "lic_team_admin",
      plan: "team",
      status: "active",
      instanceId,
      serverLimit: 1,
      keyPrefix: "ARC_TEAM…ABCD",
      expiresAt: new Date(Date.now() + 31 * 86_400_000),
      graceUntil: new Date(Date.now() + 38 * 86_400_000),
    }),
    vendorKey,
    VENDOR_KID,
  )
  await prisma.instanceConfig.update({
    where: { id: instanceId },
    data: {
      licensePlan: "team",
      licenseStatus: "active",
      licenseSignedToken: token,
      licenseSource: "hosted",
    },
  })
}

async function seedUser(input: {
  email: string
  role: "OWNER" | "ADMIN" | "MEMBER" | "VIEWER"
  password?: string
}) {
  const passwordHash = await hashPassword(input.password ?? "TestPass123!")
  return prisma.user.create({
    data: {
      name: input.email.split("@")[0] ?? "User",
      email: input.email,
      passwordHash,
      role: input.role,
      status: "ACTIVE",
    },
  })
}

beforeAll(async () => {
  const root = await createTestStorageRoot()
  await resetDatabase()
  fixtures = await seedBaseFixtures(root)
  ownerId = fixtures.user.id
  await prisma.instanceConfig.deleteMany()
  await prisma.instanceConfig.create({
    data: {
      instanceName: "Integration Test",
      storageRoot: fixtures.storageLocation.rootPath,
      initializedAt: new Date(),
      licensePlan: "free",
      licenseStatus: "none",
    },
  })
  const instance = await prisma.instanceConfig.findFirstOrThrow()
  await activateTeam(instance.id)
})

afterAll(async () => {
  await resetDatabase()
  await removeTestStorageRoot()
  await prisma.$disconnect()
})

beforeEach(async () => {
  await prisma.session.deleteMany()
  await prisma.user.deleteMany({ where: { role: { not: "OWNER" } } })
})

describe("user administration", () => {
  it("lists every account including the owner", async () => {
    const rows = await listUsers(prisma)
    expect(rows.some((u) => u.role === "OWNER")).toBe(true)
  })

  it("lets the owner create a member", async () => {
    const owner = await prisma.user.findUniqueOrThrow({ where: { id: ownerId } })
    const created = await createManagedUser(prisma, owner, {
      name: "Member One",
      email: "member1@admin.test",
      password: "MemberPass123!",
      role: "MEMBER",
    })
    expect(created.role).toBe("MEMBER")
  })

  it("prevents creating a second owner", async () => {
    const owner = await prisma.user.findUniqueOrThrow({ where: { id: ownerId } })
    await expect(
      createManagedUser(prisma, owner, {
        name: "Fake Owner",
        email: "fake-owner@admin.test",
        password: "MemberPass123!",
        role: "OWNER" as never,
      }),
    ).rejects.toMatchObject({ code: "INVALID_ROLE" })
  })

  it("disabling a user clears their sessions", async () => {
    const owner = await prisma.user.findUniqueOrThrow({ where: { id: ownerId } })
    const member = await createManagedUser(prisma, owner, {
      name: "Disable Me",
      email: "disable@admin.test",
      password: "MemberPass123!",
      role: "MEMBER",
    })
    await prisma.session.create({
      data: {
        userId: member.id,
        tokenHash: "abc",
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    })
    await updateManagedUser(prisma, owner, member.id, { status: "DISABLED" })
    const count = await prisma.session.count({ where: { userId: member.id } })
    expect(count).toBe(0)
  })

  it("protects the owner row from modification", async () => {
    const owner = await prisma.user.findUniqueOrThrow({ where: { id: ownerId } })
    await expect(
      updateManagedUser(prisma, owner, ownerId, { role: "MEMBER" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" })
  })

  it("blocks admins from creating other admins", async () => {
    const admin = await seedUser({ email: "admin@admin.test", role: "ADMIN" })
    await expect(
      createManagedUser(prisma, admin, {
        name: "Another Admin",
        email: "admin2@admin.test",
        password: "MemberPass123!",
        role: "ADMIN",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" })
  })

  it("blocks members from managing users", async () => {
    const member = await seedUser({ email: "member-only@admin.test", role: "MEMBER" })
    await expect(
      createManagedUser(prisma, member, {
        name: "Nope",
        email: "nope@admin.test",
        password: "MemberPass123!",
        role: "VIEWER",
      }),
    ).rejects.toBeInstanceOf(UserAdminError)
  })

  it("clears sessions when a role changes", async () => {
    const owner = await prisma.user.findUniqueOrThrow({ where: { id: ownerId } })
    const member = await createManagedUser(prisma, owner, {
      name: "Role Change",
      email: "rolechange@admin.test",
      password: "MemberPass123!",
      role: "MEMBER",
    })
    await prisma.session.create({
      data: {
        userId: member.id,
        tokenHash: "role-change-session",
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    })
    await updateManagedUser(prisma, owner, member.id, { role: "VIEWER" })
    expect(await prisma.session.count({ where: { userId: member.id } })).toBe(0)
  })

  it("blocks self-disable, self-delete, and last-owner removal", async () => {
    const owner = await prisma.user.findUniqueOrThrow({ where: { id: ownerId } })
    await expect(updateManagedUser(prisma, owner, ownerId, { status: "DISABLED" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    })
    await expect(deleteManagedUser(prisma, owner, ownerId)).rejects.toMatchObject({
      code: "FORBIDDEN",
    })
    const admin = await seedUser({ email: "cannot-touch-owner@admin.test", role: "ADMIN" })
    await expect(updateManagedUser(prisma, admin, ownerId, { role: "MEMBER" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    })
    await expect(deleteManagedUser(prisma, admin, ownerId)).rejects.toMatchObject({
      code: "FORBIDDEN",
    })
  })

  it("lets an admin manage members but not other admins", async () => {
    const admin = await seedUser({ email: "admin-actor@admin.test", role: "ADMIN" })
    const owner = await prisma.user.findUniqueOrThrow({ where: { id: ownerId } })
    const member = await createManagedUser(prisma, owner, {
      name: "Managed Member",
      email: "managed-member@admin.test",
      password: "MemberPass123!",
      role: "MEMBER",
    })
    const updated = await updateManagedUser(prisma, admin, member.id, { role: "VIEWER" })
    expect(updated.role).toBe("VIEWER")
    const otherAdmin = await seedUser({ email: "peer-admin@admin.test", role: "ADMIN" })
    await expect(updateManagedUser(prisma, admin, otherAdmin.id, { role: "MEMBER" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    })
  })

  it("allows the owner to remove a member", async () => {
    const owner = await prisma.user.findUniqueOrThrow({ where: { id: ownerId } })
    const member = await createManagedUser(prisma, owner, {
      name: "Delete Me",
      email: "delete@admin.test",
      password: "MemberPass123!",
      role: "MEMBER",
    })
    await deleteManagedUser(prisma, owner, member.id)
    expect(await prisma.user.findUnique({ where: { id: member.id } })).toBeNull()
  })
})

describe("user administration HTTP routes", () => {
  async function sessionToken(userId: string) {
    const raw = `sess_${userId}_${Date.now()}`
    await prisma.session.create({
      data: {
        userId,
        tokenHash: hashToken(raw),
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    })
    return raw
  }

  async function buildApp() {
    const Fastify = (await import("fastify")).default
    const { registerCookies } = await import("../../apps/api/src/plugins/cookies")
    const { registerUserAdminRoutes } = await import("../../apps/api/src/modules/users/routes")
    const app = Fastify({ logger: false })
    app.decorate("prisma", prisma)
    await registerCookies(app)
    await registerUserAdminRoutes(app)
    await app.ready()
    return app
  }

  it("rejects unauthenticated and member access", async () => {
    const app = await buildApp()
    try {
      const anon = await app.inject({ method: "GET", url: "/settings/users" })
      expect(anon.statusCode).toBe(401)

      const member = await seedUser({ email: "http-member@admin.test", role: "MEMBER" })
      const token = await sessionToken(member.id)
      const blocked = await app.inject({
        method: "GET",
        url: "/settings/users",
        headers: { authorization: `Bearer ${token}` },
      })
      expect(blocked.statusCode).toBe(403)

      const viewer = await seedUser({ email: "http-viewer@admin.test", role: "VIEWER" })
      const viewerToken = await sessionToken(viewer.id)
      const viewerRes = await app.inject({
        method: "POST",
        url: "/settings/users",
        headers: { authorization: `Bearer ${viewerToken}` },
        payload: {
          name: "Nope",
          email: "nope-http@admin.test",
          password: "MemberPass123!",
          role: "MEMBER",
        },
      })
      expect(viewerRes.statusCode).toBe(403)
    } finally {
      await app.close()
    }
  })

  it("lets the owner create a user over HTTP and rejects mass-assignment", async () => {
    const app = await buildApp()
    try {
      const token = await sessionToken(ownerId)
      const created = await app.inject({
        method: "POST",
        url: "/settings/users",
        headers: { authorization: `Bearer ${token}` },
        payload: {
          name: "Http Member",
          email: "http-created@admin.test",
          password: "MemberPass123!",
          role: "MEMBER",
          passwordHash: "forged",
          id: "forged-id",
        },
      })
      expect(created.statusCode).toBe(201)
      const body = created.json() as { data: { role: string; email: string; passwordHash?: string } }
      expect(body.data.role).toBe("MEMBER")
      expect(body.data.email).toBe("http-created@admin.test")
      expect(body.data.passwordHash).toBeUndefined()

      const invalidRole = await app.inject({
        method: "POST",
        url: "/settings/users",
        headers: { authorization: `Bearer ${token}` },
        payload: {
          name: "Fake Owner",
          email: "http-owner@admin.test",
          password: "MemberPass123!",
          role: "OWNER",
        },
      })
      expect(invalidRole.statusCode).toBe(400)
    } finally {
      await app.close()
    }
  })

  it("enforces team.multi_user on the server", async () => {
    await prisma.instanceConfig.deleteMany()
    const instance = await prisma.instanceConfig.create({
      data: {
        instanceName: "Free Gate",
        storageRoot: fixtures.storageLocation.rootPath,
        initializedAt: new Date(),
        licensePlan: "free",
        licenseStatus: "none",
        licenseSignedToken: null,
      },
    })
    const app = await buildApp()
    try {
      const token = await sessionToken(ownerId)
      const res = await app.inject({
        method: "GET",
        url: "/settings/users",
        headers: { authorization: `Bearer ${token}` },
      })
      expect(res.statusCode).toBe(403)
      expect(res.json().error.code).toBe("LICENSE_REQUIRED")
    } finally {
      await app.close()
      await activateTeam(instance.id)
    }
  })

  it("does not leak hashes and treats unknown IDs as not found", async () => {
    const app = await buildApp()
    try {
      const token = await sessionToken(ownerId)
      const listed = await app.inject({
        method: "GET",
        url: "/settings/users",
        headers: { authorization: `Bearer ${token}` },
      })
      expect(listed.statusCode).toBe(200)
      const text = listed.body
      expect(text).not.toMatch(/passwordHash/)
      expect(text).not.toMatch(/\$argon2/)

      const missing = await app.inject({
        method: "PATCH",
        url: "/settings/users/clxxxxxxxxxxxxxxxxxxxxxx",
        headers: { authorization: `Bearer ${token}` },
        payload: { status: "DISABLED" },
      })
      expect(missing.statusCode).toBe(404)
    } finally {
      await app.close()
    }
  })
})

import type { PrismaClient, User, UserRole, UserStatus } from "@prisma/client"

import { hashPassword } from "@/services/security/auth"

export class UserAdminError extends Error {
  constructor(
    public code: string,
    message: string,
    public statusCode = 400,
  ) {
    super(message)
  }
}

const MANAGE_ROLES: UserRole[] = ["OWNER", "ADMIN"]
const ASSIGNABLE_ROLES: UserRole[] = ["ADMIN", "MEMBER", "VIEWER"]

export function canManageUsers(actor: Pick<User, "role">): boolean {
  return MANAGE_ROLES.includes(actor.role)
}

export function serializeAdminUser(user: User) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    status: user.status,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  }
}

async function countOwners(prisma: PrismaClient, excludeUserId?: string) {
  return prisma.user.count({
    where: {
      role: "OWNER",
      ...(excludeUserId ? { id: { not: excludeUserId } } : {}),
    },
  })
}

export async function listUsers(prisma: PrismaClient) {
  const rows = await prisma.user.findMany({ orderBy: [{ role: "asc" }, { createdAt: "asc" }] })
  return rows.map(serializeAdminUser)
}

export async function createManagedUser(
  prisma: PrismaClient,
  actor: Pick<User, "id" | "role">,
  input: { name: string; email: string; password: string; role: UserRole },
) {
  if (!canManageUsers(actor)) {
    throw new UserAdminError("FORBIDDEN", "You do not have permission to manage users.", 403)
  }
  if (input.role === "OWNER") {
    throw new UserAdminError("INVALID_ROLE", "Cannot create another owner account.", 400)
  }
  if (actor.role === "ADMIN" && input.role === "ADMIN") {
    throw new UserAdminError("FORBIDDEN", "Only the owner can create administrator accounts.", 403)
  }
  if (!ASSIGNABLE_ROLES.includes(input.role)) {
    throw new UserAdminError("INVALID_ROLE", "Role is not assignable.", 400)
  }

  const email = input.email.trim().toLowerCase()
  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing) {
    throw new UserAdminError("EMAIL_IN_USE", "A user with this email already exists.", 409)
  }

  const passwordHash = await hashPassword(input.password)
  const user = await prisma.user.create({
    data: {
      name: input.name.trim(),
      email,
      passwordHash,
      role: input.role,
      status: "ACTIVE",
    },
  })
  return serializeAdminUser(user)
}

export async function updateManagedUser(
  prisma: PrismaClient,
  actor: Pick<User, "id" | "role">,
  targetId: string,
  input: { role?: UserRole; status?: UserStatus },
) {
  if (!canManageUsers(actor)) {
    throw new UserAdminError("FORBIDDEN", "You do not have permission to manage users.", 403)
  }

  const target = await prisma.user.findUnique({ where: { id: targetId } })
  if (!target) {
    throw new UserAdminError("NOT_FOUND", "User not found.", 404)
  }

  if (target.role === "OWNER") {
    throw new UserAdminError("FORBIDDEN", "The owner account cannot be modified here.", 403)
  }

  if (actor.role === "ADMIN") {
    if (target.role === "ADMIN") {
      throw new UserAdminError("FORBIDDEN", "Administrators cannot modify other administrators.", 403)
    }
    if (input.role === "ADMIN") {
      throw new UserAdminError("FORBIDDEN", "Only the owner can grant administrator access.", 403)
    }
  }

  if (input.role === "OWNER") {
    throw new UserAdminError("INVALID_ROLE", "Cannot promote a user to owner.", 400)
  }

  if (input.role && !["ADMIN", "MEMBER", "VIEWER"].includes(input.role)) {
    throw new UserAdminError("INVALID_ROLE", "Role is not assignable.", 400)
  }

  if (target.id === actor.id && input.status === "DISABLED") {
    throw new UserAdminError("FORBIDDEN", "You cannot disable your own account.", 403)
  }

  const nextStatus = input.status ?? target.status

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.user.update({
      where: { id: targetId },
      data: {
        ...(input.role ? { role: input.role } : {}),
        ...(input.status ? { status: input.status } : {}),
      },
    })

    const roleChanged = input.role !== undefined && input.role !== target.role
    const disabled = nextStatus === "DISABLED" && target.status !== "DISABLED"
    if (roleChanged || disabled || input.status === "DISABLED") {
      await tx.session.deleteMany({ where: { userId: targetId } })
    }
    return row
  })

  return serializeAdminUser(updated)
}

export async function deleteManagedUser(
  prisma: PrismaClient,
  actor: Pick<User, "id" | "role">,
  targetId: string,
) {
  if (!canManageUsers(actor)) {
    throw new UserAdminError("FORBIDDEN", "You do not have permission to manage users.", 403)
  }
  if (targetId === actor.id) {
    throw new UserAdminError("FORBIDDEN", "You cannot delete your own account.", 403)
  }

  const target = await prisma.user.findUnique({ where: { id: targetId } })
  if (!target) {
    throw new UserAdminError("NOT_FOUND", "User not found.", 404)
  }
  if (target.role === "OWNER") {
    throw new UserAdminError("FORBIDDEN", "The owner account cannot be removed.", 403)
  }
  if (actor.role === "ADMIN" && target.role === "ADMIN") {
    throw new UserAdminError("FORBIDDEN", "Administrators cannot remove other administrators.", 403)
  }

  await prisma.$transaction(async (tx) => {
    await tx.session.deleteMany({ where: { userId: targetId } })
    await tx.user.delete({ where: { id: targetId } })
  })
}

export async function assertOwnerInvariant(prisma: PrismaClient) {
  const owners = await countOwners(prisma)
  if (owners < 1) {
    throw new UserAdminError("OWNER_REQUIRED", "The instance must have an owner.", 500)
  }
}

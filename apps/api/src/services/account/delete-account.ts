import type { PrismaClient } from "@prisma/client"

import { verifyPassword } from "@/services/security/auth"

export class DeleteAccountError extends Error {
  constructor(
    message: string,
    public code: "INVALID_PASSWORD" | "OWNER_TRANSFER_REQUIRED" | "DELETE_FAILED" = "DELETE_FAILED",
  ) {
    super(message)
    this.name = "DeleteAccountError"
  }
}

type Tx = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$extends"
>

async function wipeInstance(tx: Tx) {
  await tx.webhookDelivery.deleteMany()
  await tx.webhookEndpoint.deleteMany()
  await tx.assetTag.deleteMany()
  await tx.chatMessage.deleteMany()
  await tx.chatConversation.deleteMany()
  await tx.uploadSession.deleteMany()
  await tx.asset.deleteMany()
  await tx.folder.deleteMany()
  await tx.library.deleteMany()
  await tx.storageObject.deleteMany()
  await tx.storageLocation.deleteMany()
  await tx.job.deleteMany()
  await tx.activityEvent.deleteMany()
  await tx.apiKey.deleteMany()
  await tx.session.deleteMany()
  await tx.appDatabase.deleteMany()
  await tx.integration.deleteMany()
  await tx.tag.deleteMany()
  await tx.modelProfile.deleteMany()
  await tx.user.deleteMany()
  await tx.instanceConfig.deleteMany()
}

async function deleteUserData(tx: Tx, userId: string) {
  await tx.asset.deleteMany({ where: { ownerId: userId } })
  await tx.appDatabase.deleteMany({ where: { createdById: userId } })
  await tx.user.delete({ where: { id: userId } })
}

export async function deleteAccount(
  prisma: PrismaClient,
  userId: string,
  password: string,
): Promise<{ resetInstance: boolean }> {
  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user) {
    throw new DeleteAccountError("User not found.", "DELETE_FAILED")
  }

  if (!(await verifyPassword(password, user.passwordHash))) {
    throw new DeleteAccountError("Password is incorrect.", "INVALID_PASSWORD")
  }

  const userCount = await prisma.user.count()
  const isSoleOwner = user.role === "OWNER" && userCount === 1

  if (user.role === "OWNER" && userCount > 1) {
    throw new DeleteAccountError(
      "You are the instance owner. Transfer ownership to another admin before deleting your account.",
      "OWNER_TRANSFER_REQUIRED",
    )
  }

  if (isSoleOwner) {
    await prisma.$transaction(async (tx) => {
      await wipeInstance(tx)
    })
    return { resetInstance: true }
  }

  await prisma.$transaction(async (tx) => {
    await deleteUserData(tx, userId)
  })

  return { resetInstance: false }
}

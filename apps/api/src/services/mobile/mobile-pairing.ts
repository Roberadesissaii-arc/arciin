import { randomInt } from "node:crypto"

import {
  MOBILE_PAIRING_CODE_TTL_MINUTES,
  MOBILE_PAIRING_SESSION_DAYS,
} from "@arciin/shared"
import type { PrismaClient } from "@prisma/client"

import { hashToken } from "@/services/security/auth"

const CODE_ATTEMPTS = 1_000_000

function generatePairingCode(): string {
  return String(randomInt(0, CODE_ATTEMPTS)).padStart(6, "0")
}

export async function purgeExpiredMobilePairingCodes(prisma: PrismaClient) {
  await prisma.mobilePairingCode.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  })
}

export async function revokeActiveMobilePairingCodes(
  prisma: PrismaClient,
  createdById: string,
) {
  await prisma.mobilePairingCode.deleteMany({
    where: {
      createdById,
      usedAt: null,
      expiresAt: { gt: new Date() },
    },
  })
}

export async function createMobilePairingCode(
  prisma: PrismaClient,
  createdById: string,
): Promise<{ id: string; code: string; expiresAt: Date }> {
  await purgeExpiredMobilePairingCodes(prisma)
  await revokeActiveMobilePairingCodes(prisma, createdById)

  const expiresAt = new Date()
  expiresAt.setMinutes(expiresAt.getMinutes() + MOBILE_PAIRING_CODE_TTL_MINUTES)

  for (let attempt = 0; attempt < 8; attempt++) {
    const code = generatePairingCode()
    try {
      const row = await prisma.mobilePairingCode.create({
        data: {
          codeHash: hashToken(code),
          createdById,
          expiresAt,
        },
      })
      return { id: row.id, code, expiresAt }
    } catch {
      // rare codeHash collision
    }
  }

  throw new Error("Could not generate a pairing code.")
}

export async function findValidMobilePairingCode(
  prisma: PrismaClient,
  code: string,
) {
  const normalized = code.replace(/\D/g, "")
  if (normalized.length !== 6) return null

  const row = await prisma.mobilePairingCode.findUnique({
    where: { codeHash: hashToken(normalized) },
    include: { createdBy: true },
  })

  if (!row || row.usedAt || row.expiresAt < new Date()) {
    return null
  }

  if (row.createdBy.status !== "ACTIVE") {
    return null
  }

  return row
}

export async function consumeMobilePairingCode(prisma: PrismaClient, id: string) {
  await prisma.mobilePairingCode.update({
    where: { id },
    data: { usedAt: new Date() },
  })
}

export function mobilePairingSessionOptions() {
  return { expiresInDays: MOBILE_PAIRING_SESSION_DAYS }
}

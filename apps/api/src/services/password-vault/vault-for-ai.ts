import type { PrismaClient } from "@prisma/client"

import {
  buildVaultAiContextBlock,
  isPasswordRelatedChatQuery,
  isVaultListingQuery,
  parseAiSecurityConfig,
  type VaultEntryForAiRedaction,
} from "@arciin/shared"

import { decryptVaultPayload } from "@/services/password-vault/crypto"

export type PasswordVaultAiSnapshot = {
  entryCount: number
  contextLine: string | null
}

function entryMatchesQuery(entry: VaultEntryForAiRedaction, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  const hay = [entry.name, entry.username, entry.url, entry.notes]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
  const tokens = q.split(/\s+/).filter((t) => t.length > 2)
  if (tokens.length === 0) return hay.includes(q)
  return tokens.some((t) => hay.includes(t))
}

/** What the AI may know about the vault (never plaintext passwords). */
export async function getPasswordVaultAiSnapshot(
  prisma: PrismaClient,
  options?: { queryHint?: string; listAll?: boolean },
): Promise<PasswordVaultAiSnapshot> {
  const [rows, instance] = await Promise.all([
    prisma.passwordVaultEntry.findMany({
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    prisma.instanceConfig.findFirst({ select: { aiConfig: true } }),
  ])

  const cfg = (instance?.aiConfig as Record<string, unknown> | null) ?? {}
  const security = parseAiSecurityConfig(cfg.security)
  const access = security.passwordVaultAiAccess
  const count = rows.length

  if (count === 0 || access === "blocked") {
    return { entryCount: count, contextLine: null }
  }

  const decrypted: VaultEntryForAiRedaction[] = rows.map((r) => {
    const p = decryptVaultPayload(r.ciphertext, r.iv, r.authTag)
    return {
      name: p.name,
      username: p.username ?? null,
      password: p.password ?? null,
      url: p.url ?? null,
      notes: p.notes ?? null,
    }
  })

  const queryHint = options?.queryHint?.trim()
  const listAll = options?.listAll ?? Boolean(queryHint && isVaultListingQuery(queryHint))
  const passwordRelated = Boolean(queryHint && isPasswordRelatedChatQuery(queryHint))

  let entriesForContext = decrypted
  if (access === "metadata" && queryHint && !listAll && passwordRelated) {
    const relevant = decrypted.filter((e) => entryMatchesQuery(e, queryHint))
    if (relevant.length > 0) entriesForContext = relevant
  }

  const contextLine = buildVaultAiContextBlock({
    access,
    entryCount: count,
    entries: entriesForContext,
    share: security.passwordVaultAiShare,
    queryHint: queryHint || undefined,
    listAll,
  })

  return { entryCount: count, contextLine }
}

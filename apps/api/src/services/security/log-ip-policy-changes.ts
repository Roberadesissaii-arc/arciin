import type { FastifyInstance } from "fastify"

import { recordSecurityEvent } from "@/services/security/security-events"

export async function logIpPolicyChanges(
  fastify: Pick<FastifyInstance, "prisma" | "redis" | "publishRealtimeEvent">,
  input: {
    actorUserId: string
    actorName: string
    actorIp?: string | null
    prevBlocklist: string[]
    nextBlocklist: string[]
    prevAllowlist: string[]
    nextAllowlist: string[]
    prevEnforce: boolean
    nextEnforce: boolean
  },
) {
  const { actorUserId, actorName, actorIp } = input
  const ipMeta = actorIp ? { clientIp: actorIp, status: "policy" as const } : { status: "policy" as const }

  for (const ip of input.nextBlocklist.filter((x) => !input.prevBlocklist.includes(x))) {
    await recordSecurityEvent(fastify, {
      userId: actorUserId,
      type: "security.ip_blocklist_added",
      title: "IP blocked",
      message: `${actorName} added ${ip} to the blocklist.`,
      metadata: { ...ipMeta, clientIp: ip },
    })
  }

  for (const ip of input.prevBlocklist.filter((x) => !input.nextBlocklist.includes(x))) {
    await recordSecurityEvent(fastify, {
      userId: actorUserId,
      type: "security.ip_blocklist_removed",
      title: "IP unblocked",
      message: `${actorName} removed ${ip} from the blocklist.`,
      metadata: { ...ipMeta, clientIp: ip },
    })
  }

  for (const ip of input.nextAllowlist.filter((x) => !input.prevAllowlist.includes(x))) {
    await recordSecurityEvent(fastify, {
      userId: actorUserId,
      type: "security.ip_allowlist_added",
      title: "IP allowlisted",
      message: `${actorName} added ${ip} to the allowlist.`,
      metadata: { ...ipMeta, clientIp: ip },
    })
  }

  for (const ip of input.prevAllowlist.filter((x) => !input.nextAllowlist.includes(x))) {
    await recordSecurityEvent(fastify, {
      userId: actorUserId,
      type: "security.ip_allowlist_removed",
      title: "IP removed from allowlist",
      message: `${actorName} removed ${ip} from the allowlist.`,
      metadata: { ...ipMeta, clientIp: ip },
    })
  }

  if (input.prevEnforce !== input.nextEnforce) {
    await recordSecurityEvent(fastify, {
      userId: actorUserId,
      type: "security.allowlist_enforcement_changed",
      title: input.nextEnforce ? "Allowlist enforcement on" : "Allowlist enforcement off",
      message: `${actorName} ${input.nextEnforce ? "enabled" : "disabled"} HTTP API allowlist enforcement.`,
      metadata: ipMeta,
    })
  }
}

import type { BackupGrantContext } from "@/services/backup/auth"
import type { PrismaClient, Session, User } from "@prisma/client"
import type { Server as SocketIOServer } from "socket.io"
import type Redis from "ioredis"

import type { RealtimeEvent } from "@arciin/shared"

declare module "fastify" {
  interface FastifyInstance {
    prisma: PrismaClient
    redis: Redis
    io: SocketIOServer
    publishRealtimeEvent: (event: RealtimeEvent) => Promise<void>
  }

  interface FastifyRequest {
    /** Session sign-in and/or API key (Bearer). `session` is null when authenticated via API key only. */
    auth?: {
      user: User
      session: Session | null
      apiKeyId?: string | null
      apiKeyScopes?: string[] | null
    }
    /** Present only on computer-backup sync routes after `requireBackupGrant`. */
    backupGrant?: BackupGrantContext
  }
}

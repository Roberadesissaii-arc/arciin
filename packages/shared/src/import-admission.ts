import { IMPORT_MAX_ACTIVE_PER_USER } from "./import-url"

/**
 * How many link imports one user may have downloading at once, and what
 * happens to the rest.
 *
 * Each running import holds a slot: its upload id in a per-user sorted set,
 * scored by when it started. Taking a slot is one atomic script, so two
 * requests cannot both take the last one; giving it back is removing that id,
 * so releasing twice (a retried job, a crash and a sweep) cannot free a slot
 * some other import holds. The counter this replaces was decremented once per
 * job *attempt*, so a retried failure could drive it to zero with imports
 * still running.
 *
 * Imports that do not get a slot straight away — the rest of a batch — wait
 * in a per-user list on the server. Whenever a slot is released the worker
 * promotes the next waiting import, so a batch of five runs three, then the
 * next two as those finish, without the browser retrying anything.
 *
 * Works with any client exposing these ioredis commands.
 */
export type ImportAdmissionRedis = {
  eval(script: string, numKeys: number, ...args: Array<string | number>): Promise<unknown>
  zrem(key: string, member: string): Promise<number>
  rpush(key: string, value: string): Promise<number>
  lpush(key: string, value: string): Promise<number>
  lpop(key: string): Promise<string | null>
  llen(key: string): Promise<number>
  expire(key: string, seconds: number): Promise<number>
}

/** A slot not released after this long belongs to an import that died; it is reclaimed. */
export const IMPORT_SLOT_STALE_MS = 2 * 60 * 60 * 1000
/** Waiting imports per user. Beyond this a new batch is refused rather than queued without end. */
export const IMPORT_MAX_WAITING_PER_USER = 10
const WAITING_TTL_SECONDS = 24 * 60 * 60

export const importSlotsKey = (userId: string) => `import:slots:${userId}`
export const importWaitingKey = (userId: string) => `import:waiting:${userId}`

const ACQUIRE = `
redis.call("ZREMRANGEBYSCORE", KEYS[1], "-inf", ARGV[3])
if redis.call("ZSCORE", KEYS[1], ARGV[1]) then return 1 end
if redis.call("ZCARD", KEYS[1]) >= tonumber(ARGV[4]) then return 0 end
redis.call("ZADD", KEYS[1], ARGV[2], ARGV[1])
redis.call("PEXPIRE", KEYS[1], ARGV[5])
return 1
`

/** Take a slot for this upload. True if it may start now. Idempotent per upload id. */
export async function acquireImportSlot(
  redis: ImportAdmissionRedis,
  userId: string,
  uploadId: string,
  now = Date.now(),
  max = IMPORT_MAX_ACTIVE_PER_USER,
): Promise<boolean> {
  const result = await redis.eval(
    ACQUIRE,
    1,
    importSlotsKey(userId),
    uploadId,
    now,
    now - IMPORT_SLOT_STALE_MS,
    max,
    IMPORT_SLOT_STALE_MS,
  )
  return Number(result) === 1
}

/** Give the slot back. Safe to call more than once. */
export async function releaseImportSlot(redis: ImportAdmissionRedis, userId: string, uploadId: string): Promise<void> {
  await redis.zrem(importSlotsKey(userId), uploadId)
}

/** Put an import at the back of this user's waiting line. Returns the line's length. */
export async function queueWaitingImport<T extends { uploadId: string }>(
  redis: ImportAdmissionRedis,
  userId: string,
  payload: T,
): Promise<number> {
  const length = await redis.rpush(importWaitingKey(userId), JSON.stringify(payload))
  await redis.expire(importWaitingKey(userId), WAITING_TTL_SECONDS)
  return length
}

export async function waitingImportCount(redis: ImportAdmissionRedis, userId: string): Promise<number> {
  return redis.llen(importWaitingKey(userId))
}

/**
 * Start waiting imports while slots are free. `enqueue` hands one to the job
 * queue; if it throws, the import goes back to the front of the line and its
 * slot is released. Returns how many started.
 */
export async function promoteWaitingImports<T extends { uploadId: string }>(
  redis: ImportAdmissionRedis,
  userId: string,
  enqueue: (payload: T) => Promise<void>,
  max = IMPORT_MAX_ACTIVE_PER_USER,
): Promise<number> {
  let started = 0
  for (let guard = 0; guard < IMPORT_MAX_WAITING_PER_USER + max; guard++) {
    const raw = await redis.lpop(importWaitingKey(userId))
    if (!raw) break
    let payload: T
    try {
      payload = JSON.parse(raw) as T
    } catch {
      continue // unreadable entry: drop it
    }
    if (!payload?.uploadId) continue
    if (!(await acquireImportSlot(redis, userId, payload.uploadId, Date.now(), max))) {
      await redis.lpush(importWaitingKey(userId), raw) // no slot: back to the front
      break
    }
    try {
      await enqueue(payload)
      started++
    } catch (error) {
      await releaseImportSlot(redis, userId, payload.uploadId)
      await redis.lpush(importWaitingKey(userId), raw)
      throw error
    }
  }
  return started
}

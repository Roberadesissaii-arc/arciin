import { nanoid } from "nanoid"

/** Stable id for client stores; works without a secure context (e.g. http://192.168.x.x). */
export function createId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID()
  }
  return nanoid()
}

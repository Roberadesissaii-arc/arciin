import { hash, verify } from "@node-rs/argon2"

export function normalizeRecoveryAnswer(answer: string) {
  return answer.trim().toLowerCase()
}

export async function hashRecoveryAnswer(answer: string) {
  return hash(normalizeRecoveryAnswer(answer), {
    algorithm: 2,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  })
}

export async function verifyRecoveryAnswer(answer: string, answerHash: string) {
  return verify(answerHash, normalizeRecoveryAnswer(answer))
}

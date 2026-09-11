import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import {
  ENTITLEMENT_RUNTIME,
  LICENSE_FEATURES,
  PAID_WORKER_JOB_FEATURES,
  classifiedEntitlementIds,
  isActiveRuntimeEntitlement,
  isPaidWorkerJob,
  isPlaceholderEntitlement,
} from "@arciin/config"

describe("entitlement runtime inventory", () => {
  it("classifies every declared entitlement id", () => {
    expect(classifiedEntitlementIds().sort()).toEqual([...LICENSE_FEATURES].sort())
    for (const id of LICENSE_FEATURES) {
      expect(ENTITLEMENT_RUNTIME[id], id).toBeDefined()
      expect(ENTITLEMENT_RUNTIME[id].id).toBe(id)
      expect(["ACTIVE", "PLACEHOLDER", "DEPRECATED", "INTERNAL"]).toContain(
        ENTITLEMENT_RUNTIME[id].classification,
      )
    }
  })

  it("does not invent API gates for placeholders", () => {
    for (const id of LICENSE_FEATURES) {
      if (isPlaceholderEntitlement(id)) {
        expect(ENTITLEMENT_RUNTIME[id].apiGate, id).toBeNull()
        expect(ENTITLEMENT_RUNTIME[id].workerGate, id).toBeNull()
        expect(ENTITLEMENT_RUNTIME[id].implementedFeature, id).toBeNull()
      }
    }
  })

  it("gives every ACTIVE paid feature an authoritative API or worker gate", () => {
    for (const id of LICENSE_FEATURES) {
      if (!isActiveRuntimeEntitlement(id)) continue
      if (id.startsWith("core.") && id !== "core.basic_ai") continue
      expect(
        ENTITLEMENT_RUNTIME[id].apiGate || ENTITLEMENT_RUNTIME[id].workerGate,
        `${id} is ACTIVE but has no authoritative gate`,
      ).toBeTruthy()
    }
  })

  it("maps only real paid worker jobs", () => {
    expect(PAID_WORKER_JOB_FEATURES.transcribe_media).toBe("ai.chat")
    expect(PAID_WORKER_JOB_FEATURES.stage_update).toBe("ops.auto_updates")
    expect(PAID_WORKER_JOB_FEATURES.apply_update).toBe("ops.auto_updates")
    expect(isPaidWorkerJob("analyze_file")).toBe(false)
    expect(isPaidWorkerJob("generate_thumbnail")).toBe(false)
  })

  it("the worker consults the paid-job map before executing those jobs", () => {
    const handlers = readFileSync(
      join(process.cwd(), "apps/worker/src/processors/worker-handlers.ts"),
      "utf8",
    )
    expect(handlers).toContain("assertPaidJobEntitlement")
    expect(handlers.indexOf("assertPaidJobEntitlement")).toBeLessThan(
      handlers.indexOf("JOB_TYPES.transcribeMedia"),
    )
  })
})

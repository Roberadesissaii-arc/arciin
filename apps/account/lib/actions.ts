"use server"

import {
  createDemoLicense,
  deactivateServer,
  deleteLicense,
  revokeLicense,
} from "@/lib/license-api"
import { revalidatePath } from "next/cache"

export async function actionCreateDemoLicense(plan: string) {
  try {
    const data = await createDemoLicense(plan)
    revalidatePath("/account")
    revalidatePath("/account/licenses")
    revalidatePath("/account/servers")
    return { ok: true as const, data }
  } catch (e) {
    return {
      ok: false as const,
      message: e instanceof Error ? e.message : "Could not create license",
    }
  }
}

export async function actionRevokeLicense(licenseId: string) {
  try {
    await revokeLicense({ licenseId })
    revalidatePath("/account")
    revalidatePath("/account/licenses")
    revalidatePath("/account/servers")
    return { ok: true as const }
  } catch (e) {
    return {
      ok: false as const,
      message: e instanceof Error ? e.message : "Could not revoke license",
    }
  }
}

export async function actionDeactivateServer(licenseId: string, instanceId: string) {
  try {
    await deactivateServer({ licenseId, instanceId })
    revalidatePath("/account")
    revalidatePath("/account/licenses")
    revalidatePath("/account/servers")
    return { ok: true as const }
  } catch (e) {
    return {
      ok: false as const,
      message: e instanceof Error ? e.message : "Could not deactivate server",
    }
  }
}

export async function actionDeleteLicense(licenseId: string) {
  try {
    await deleteLicense({ licenseId })
    revalidatePath("/account")
    revalidatePath("/account/licenses")
    revalidatePath("/account/servers")
    return { ok: true as const }
  } catch (e) {
    return {
      ok: false as const,
      message: e instanceof Error ? e.message : "Could not delete license",
    }
  }
}

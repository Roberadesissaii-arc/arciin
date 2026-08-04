import path from "node:path"

import { config as loadDotenv } from "dotenv"

import { resolveEnvNamespace, isProductionNamespace } from "./environment"

/**
 * Load `.env`, then layer `.env.development` on top for non-production
 * namespaces.
 *
 * Two files rather than one so the development overrides live beside the
 * production config without ever being read by a production process: PM2
 * starts with ARCIIN_ENV_NAMESPACE=production, which skips the overlay
 * entirely.
 */
export function loadArciinEnv(repoRoot: string): { namespace: string; overlayLoaded: boolean } {
  loadDotenv({ path: path.join(repoRoot, ".env"), quiet: true })

  const namespace = resolveEnvNamespace()
  if (isProductionNamespace(namespace)) {
    return { namespace, overlayLoaded: false }
  }

  const overlay = loadDotenv({
    path: path.join(repoRoot, ".env.development"),
    override: true,
    quiet: true,
  })

  return { namespace, overlayLoaded: !overlay.error }
}

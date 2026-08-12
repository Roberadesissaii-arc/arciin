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
  // Snapshot BEFORE any file is read. Taken afterwards this would capture
  // `.env`'s production values as if the shell had set them, and restoring
  // those over the dev overlay would point a dev process at the production
  // database — the exact failure the isolation guard exists to catch.
  const shellProvided = new Map<string, string>()
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) shellProvided.set(key, value)
  }

  loadDotenv({ path: path.join(repoRoot, ".env"), quiet: true })

  const namespace = resolveEnvNamespace()
  if (isProductionNamespace(namespace)) {
    return { namespace, overlayLoaded: false }
  }

  // The overlay must beat `.env`, but not an explicit command-line value.
  //
  // `override: true` alone clobbered both, so `API_PORT=4300 pnpm dev:api`
  // silently kept the file's port. That made the browser suite impossible to
  // run: it needs its own ports, and there was no way to ask for them.
  // Snapshot what the shell actually set, let the overlay apply, then put the
  // explicit values back.
  const overlay = loadDotenv({
    path: path.join(repoRoot, ".env.development"),
    override: true,
    quiet: true,
  })

  const fileKeys = Object.keys(overlay.parsed ?? {})
  for (const key of fileKeys) {
    const shellValue = shellProvided.get(key)
    // Only restore keys the shell set *before* dotenv touched them, and only
    // when dotenv actually changed the value.
    if (shellValue !== undefined && process.env[key] !== shellValue) {
      process.env[key] = shellValue
    }
  }

  return { namespace, overlayLoaded: !overlay.error }
}

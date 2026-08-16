import path from "node:path"

/**
 * Where a stored file lives under the storage root.
 *
 * Content-addressed and fanned out two levels, so a directory never fills with
 * a hundred thousand siblings: `objects/ab/cd/<sha256>.<ext>`.
 *
 * This lives in the shared package rather than beside the upload service
 * because more than one thing needs to agree on it — the API when it stores an
 * upload, and the E2E seeder when it plants a fixture where the API will look
 * for it. When those two disagreed, the fixture existed in the database and its
 * bytes were somewhere the app would never read, which reads as a broken
 * feature rather than a broken path.
 *
 * Pure on purpose: no config, no filesystem, nothing that needs an environment,
 * so a test or a script can import it without booting an app.
 */
export function buildObjectKey(checksumSha256: string, extension: string): string {
  const normalizedExtension = extension.startsWith(".")
    ? extension.toLowerCase()
    : extension
      ? `.${extension.toLowerCase()}`
      : ""

  return path.join(
    "objects",
    checksumSha256.slice(0, 2),
    checksumSha256.slice(2, 4),
    `${checksumSha256}${normalizedExtension}`,
  )
}

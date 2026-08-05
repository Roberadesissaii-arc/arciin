/**
 * File Request policy — what an anonymous recipient is allowed to do.
 *
 * A File Request is the inverse of a Share: a Share lets an outsider *read*
 * what the owner selected, a File Request lets an outsider *write* into a
 * folder they cannot read. That inversion is the whole security problem. The
 * recipient holds a public URL and nothing else; every destination fact — the
 * library, the folder, the instance, the owner — comes from the resolved
 * request row, never from the request body. A public client that can name its
 * own destination folder can write into any folder on the instance.
 *
 * The other half is that a recipient must not learn anything about the folder
 * they are uploading into. Not its contents, not its id, not whether their
 * upload joined ten files or zero. So:
 *
 *   - an unavailable request always answers NOT_FOUND, never a reason
 *   - the public payload carries no ids that address anything else
 *   - submissions are addressed by their own token, never enumerated
 *
 * Pure so every rule is unit-testable without Prisma or Fastify.
 */

export type FileRequestStatusValue = "ACTIVE" | "EXPIRED" | "REVOKED" | "LIMIT_REACHED"

export type FileRequestAvailabilityCode =
  | "NOT_FOUND"
  | "REVOKED"
  | "EXPIRED"
  | "LIMIT_REACHED"

export type FileRequestAvailabilityInput = {
  exists: boolean
  status?: FileRequestStatusValue | string | null
  revokedAt?: Date | null
  expiresAt?: Date | null
  maxFileCount?: number | null
  maxTotalBytes?: bigint | number | null
  currentFileCount?: number
  currentBytes?: bigint | number
  /** The destination folder's live state, loaded alongside the request. */
  destinationFolder?: { deletedAt?: Date | null } | null
  destinationLibrary?: { id: string } | null
  now?: number
}

export type FileRequestAvailability =
  | { available: true }
  | { available: false; code: FileRequestAvailabilityCode }

function asBigInt(value: bigint | number | null | undefined): bigint {
  if (value == null) return 0n
  return typeof value === "bigint" ? value : BigInt(Math.trunc(value))
}

/**
 * Whether the request may still accept uploads.
 *
 * A deleted destination folder is reported as NOT_FOUND, matching the share
 * fix: the recipient must not be able to distinguish "this link never existed"
 * from "the owner deleted the folder behind it".
 */
export function checkFileRequestAvailability(
  input: FileRequestAvailabilityInput,
): FileRequestAvailability {
  if (!input.exists) return { available: false, code: "NOT_FOUND" }

  if (input.revokedAt || input.status === "REVOKED") {
    return { available: false, code: "REVOKED" }
  }

  const now = input.now ?? Date.now()
  if (input.expiresAt && input.expiresAt.getTime() <= now) {
    return { available: false, code: "EXPIRED" }
  }
  if (input.status === "EXPIRED") {
    return { available: false, code: "EXPIRED" }
  }

  // The destination is checked before quotas: a request pointing at a deleted
  // folder is gone, not merely full.
  if (!input.destinationFolder || input.destinationFolder.deletedAt) {
    return { available: false, code: "NOT_FOUND" }
  }
  if (!input.destinationLibrary) {
    return { available: false, code: "NOT_FOUND" }
  }

  if (input.maxFileCount != null && (input.currentFileCount ?? 0) >= input.maxFileCount) {
    return { available: false, code: "LIMIT_REACHED" }
  }

  const maxBytes = input.maxTotalBytes == null ? null : asBigInt(input.maxTotalBytes)
  if (maxBytes != null && asBigInt(input.currentBytes) >= maxBytes) {
    return { available: false, code: "LIMIT_REACHED" }
  }

  if (input.status === "LIMIT_REACHED") {
    return { available: false, code: "LIMIT_REACHED" }
  }

  return { available: true }
}

// ---------------------------------------------------------------------------
// Per-file admission
// ---------------------------------------------------------------------------

export type FileAdmissionCode =
  | "FILE_TOO_LARGE"
  | "EXTENSION_NOT_ALLOWED"
  | "MEDIA_TYPE_NOT_ALLOWED"
  | "FILE_COUNT_EXCEEDED"
  | "TOTAL_BYTES_EXCEEDED"
  | "INVALID_FILENAME"

export type FileAdmission =
  | { allowed: true; safeFilename: string }
  | { allowed: false; code: FileAdmissionCode; message: string }

export type FileAdmissionInput = {
  filename: string
  sizeBytes: bigint | number
  /** Media type as detected from *content*, not from the filename. */
  detectedMediaType?: string | null
  /** Extension as detected from content, without a leading dot. */
  detectedExtension?: string | null
  maxFileSizeBytes?: bigint | number | null
  maxFileCount?: number | null
  maxTotalBytes?: bigint | number | null
  currentFileCount?: number
  currentBytes?: bigint | number
  /** Empty means "no restriction". Lower-case, no leading dot. */
  allowedExtensions?: string[]
  /** Empty means "no restriction". */
  allowedMediaTypes?: string[]
}

/**
 * Strip a client filename down to something that cannot escape a directory or
 * confuse a shell, a browser, or a Content-Disposition header.
 *
 * Returns null when nothing usable survives, which is itself a rejection: a
 * name of only separators is an attack, not a file.
 */
export function sanitizeSubmittedFilename(raw: string): string | null {
  if (typeof raw !== "string") return null

  // Take the last path segment under both separators before anything else, so
  // "../../etc/passwd" and "..\\..\\win.ini" both reduce to their basename.
  const base = raw.split(/[/\\]/).pop() ?? ""

  const cleaned = base
    // Control characters, including the NUL that truncates C-string paths.
    .replace(/[\u0000-\u001f\u007f]/g, "")
    // Characters that are hostile in headers, shells or Windows paths.
    .replace(/["'`$;|&<>*?:]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    // A leading dot hides the file; leading dashes read as CLI flags.
    .replace(/^[.\-\s]+/, "")

  if (!cleaned) return null
  // "." and ".." cannot survive the leading-dot strip above, but a name that is
  // now empty of anything but an extension dot is still useless.
  if (!/[A-Za-z0-9]/.test(cleaned)) return null

  return cleaned.slice(0, 200)
}

export function admitFile(input: FileAdmissionInput): FileAdmission {
  const safeFilename = sanitizeSubmittedFilename(input.filename)
  if (!safeFilename) {
    return {
      allowed: false,
      code: "INVALID_FILENAME",
      message: "That filename is not accepted.",
    }
  }

  const size = asBigInt(input.sizeBytes)

  const maxFile = input.maxFileSizeBytes == null ? null : asBigInt(input.maxFileSizeBytes)
  if (maxFile != null && size > maxFile) {
    return {
      allowed: false,
      code: "FILE_TOO_LARGE",
      message: "That file is larger than this request allows.",
    }
  }

  if (input.maxFileCount != null && (input.currentFileCount ?? 0) + 1 > input.maxFileCount) {
    return {
      allowed: false,
      code: "FILE_COUNT_EXCEEDED",
      message: "This request has reached its file limit.",
    }
  }

  const maxTotal = input.maxTotalBytes == null ? null : asBigInt(input.maxTotalBytes)
  if (maxTotal != null && asBigInt(input.currentBytes) + size > maxTotal) {
    return {
      allowed: false,
      code: "TOTAL_BYTES_EXCEEDED",
      message: "This request has reached its total upload limit.",
    }
  }

  // Extension rules are applied to the *detected* extension when we have one.
  // Checking the client's filename instead would let a recipient rename
  // payload.exe to photo.jpg and walk straight through the allowlist.
  const allowedExtensions = (input.allowedExtensions ?? []).filter(Boolean)
  if (allowedExtensions.length > 0) {
    const detected = (input.detectedExtension ?? "").toLowerCase().replace(/^\./, "")
    const claimed = (safeFilename.split(".").pop() ?? "").toLowerCase()
    const effective = detected || claimed
    const allowed = allowedExtensions.map((e) => e.toLowerCase().replace(/^\./, ""))
    if (!effective || !allowed.includes(effective)) {
      return {
        allowed: false,
        code: "EXTENSION_NOT_ALLOWED",
        message: "That file type is not accepted by this request.",
      }
    }
  }

  const allowedMediaTypes = (input.allowedMediaTypes ?? []).filter(Boolean)
  if (allowedMediaTypes.length > 0) {
    const detected = input.detectedMediaType ?? ""
    if (!detected || !allowedMediaTypes.includes(detected)) {
      return {
        allowed: false,
        code: "MEDIA_TYPE_NOT_ALLOWED",
        message: "That file type is not accepted by this request.",
      }
    }
  }

  return { allowed: true, safeFilename }
}

// ---------------------------------------------------------------------------
// Submitter identification
// ---------------------------------------------------------------------------

export type SubmitterCheck =
  | { ok: true; name: string | null; email: string | null }
  | { ok: false; code: "SUBMITTER_NAME_REQUIRED" | "SUBMITTER_EMAIL_REQUIRED" | "ANONYMOUS_NOT_ALLOWED"; message: string }

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function checkSubmitter(input: {
  requireName: boolean
  requireEmail: boolean
  allowAnonymous: boolean
  name?: string | null
  email?: string | null
  /** True when the caller proved an Arciin session. */
  authenticated?: boolean
}): SubmitterCheck {
  const name = input.name?.trim() || null
  const email = input.email?.trim().toLowerCase() || null

  if (!input.allowAnonymous && !input.authenticated) {
    return {
      ok: false,
      code: "ANONYMOUS_NOT_ALLOWED",
      message: "This request requires you to sign in before uploading.",
    }
  }

  if (input.requireName && !name) {
    return {
      ok: false,
      code: "SUBMITTER_NAME_REQUIRED",
      message: "Your name is required for this request.",
    }
  }

  if (input.requireEmail && (!email || !EMAIL_PATTERN.test(email))) {
    return {
      ok: false,
      code: "SUBMITTER_EMAIL_REQUIRED",
      message: "A valid email address is required for this request.",
    }
  }

  // An optional email that is present but malformed is dropped rather than
  // rejected: it is a convenience field, and storing garbage helps nobody.
  const acceptedEmail = email && EMAIL_PATTERN.test(email) ? email : null

  return { ok: true, name: name ? name.slice(0, 120) : null, email: acceptedEmail }
}

// ---------------------------------------------------------------------------
// Public projection
// ---------------------------------------------------------------------------

export type PublicFileRequestView = {
  title: string
  message: string | null
  expiresAt: string | null
  requireName: boolean
  requireEmail: boolean
  requiresAccessCode: boolean
  allowedExtensions: string[]
  allowedMediaTypes: string[]
  maxFileSizeBytes: number | null
  remainingFileCount: number | null
  remainingBytes: number | null
  /** Whether the submitter may see the files they themselves uploaded. */
  allowSubmitterViewOwn: boolean
}

/**
 * Everything the public page is allowed to know.
 *
 * Deliberately built by listing what goes *in* rather than deleting what must
 * stay out — an omission in a redact-list silently leaks, an omission here just
 * fails to render. No folder id, no library id, no instance id, no owner
 * identity, no counts of what the folder already holds.
 */
export function toPublicFileRequest(request: {
  title: string
  message?: string | null
  expiresAt?: Date | null
  requireName: boolean
  requireEmail: boolean
  accessCodeHash?: string | null
  allowedExtensions?: string[]
  allowedMediaTypes?: string[]
  maxFileSizeBytes?: bigint | number | null
  maxFileCount?: number | null
  maxTotalBytes?: bigint | number | null
  currentFileCount?: number
  currentBytes?: bigint | number
  allowSubmitterViewOwn?: boolean
}): PublicFileRequestView {
  const remainingFileCount =
    request.maxFileCount == null
      ? null
      : Math.max(0, request.maxFileCount - (request.currentFileCount ?? 0))

  const remainingBytes =
    request.maxTotalBytes == null
      ? null
      : Math.max(0, Number(asBigInt(request.maxTotalBytes) - asBigInt(request.currentBytes)))

  return {
    title: request.title,
    message: request.message ?? null,
    expiresAt: request.expiresAt?.toISOString() ?? null,
    requireName: request.requireName,
    requireEmail: request.requireEmail,
    requiresAccessCode: Boolean(request.accessCodeHash),
    allowedExtensions: request.allowedExtensions ?? [],
    allowedMediaTypes: request.allowedMediaTypes ?? [],
    maxFileSizeBytes:
      request.maxFileSizeBytes == null ? null : Number(asBigInt(request.maxFileSizeBytes)),
    remainingFileCount,
    remainingBytes,
    allowSubmitterViewOwn: request.allowSubmitterViewOwn ?? false,
  }
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const FILE_REQUEST_DEFAULTS = {
  expiresInDays: 14,
  maxFileCount: 200,
  /** 20 GB total, 5 GB per file — generous for photo/video handoff, still bounded. */
  maxTotalBytes: 20n * 1024n * 1024n * 1024n,
  maxFileSizeBytes: 5n * 1024n * 1024n * 1024n,
  allowAnonymous: true,
  requireName: false,
  requireEmail: false,
  allowSubmitterViewOwn: false,
  notifyOwner: true,
} as const

/** Uploads per minute from one abuse identifier against one request. */
export const FILE_REQUEST_RATE_LIMIT_PER_MINUTE = 30
/** Simultaneous in-flight uploads against one request, across all submitters. */
export const FILE_REQUEST_MAX_CONCURRENCY = 6

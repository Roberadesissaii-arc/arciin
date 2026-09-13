export class BackupError extends Error {
  constructor(
    public readonly code:
      | "BACKUP_NOT_SUPPORTED"
      | "BACKUP_UNAUTHORIZED"
      | "BACKUP_CREDENTIAL_INVALID"
      | "BACKUP_DEVICE_UNPAIRED"
      | "BACKUP_FORBIDDEN"
      | "BACKUP_DISABLED"
      | "BACKUP_NOT_FOUND"
      | "BACKUP_ROOT_NOT_FOUND"
      | "BACKUP_ENTRY_NOT_FOUND"
      | "BACKUP_READ_ONLY"
      | "BACKUP_IDEMPOTENCY_CONFLICT"
      | "PATH_TRAVERSAL"
      | "PATH_INVALID"
      | "PATH_TOO_LONG"
      | "VALIDATION_ERROR"
      | "UPLOAD_TOO_LARGE",
    message: string,
    public readonly status = 400,
  ) {
    super(message)
    this.name = "BackupError"
  }
}

export function backupErrorStatus(error: BackupError): number {
  return error.status
}

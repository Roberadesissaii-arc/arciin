import { ApiError } from "@/lib/api/errors"

export type RecoveryFieldErrors = {
  email?: string
  answer?: string
  newPassword?: string
  confirmPassword?: string
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function validateForgotPasswordEmail(email: string): RecoveryFieldErrors {
  const errors: RecoveryFieldErrors = {}
  const trimmed = email.trim()

  if (!trimmed) {
    errors.email = "Enter your email address."
  } else if (!EMAIL_PATTERN.test(trimmed)) {
    errors.email = "Enter a valid email address."
  }

  return errors
}

export function validateForgotPasswordReset(
  answer: string,
  newPassword: string,
  confirmPassword: string,
): RecoveryFieldErrors {
  const errors: RecoveryFieldErrors = {}

  if (!answer.trim()) {
    errors.answer = "Enter your security answer."
  }
  if (!newPassword) {
    errors.newPassword = "Enter a new password."
  } else if (newPassword.length < 8) {
    errors.newPassword = "Use at least 8 characters."
  }
  if (!confirmPassword) {
    errors.confirmPassword = "Confirm your new password."
  } else if (newPassword !== confirmPassword) {
    errors.confirmPassword = "Passwords do not match."
  }

  return errors
}

export function hasRecoveryFieldErrors(errors: RecoveryFieldErrors): boolean {
  return Object.values(errors).some(Boolean)
}

function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message
  if (err instanceof Error) return err.message
  return "Something went wrong. Try again."
}

export function mapRecoveryApiError(err: unknown): { fields: RecoveryFieldErrors; form?: string } {
  if (err instanceof ApiError) {
    if (err.code === "RECOVERY_FAILED") {
      return { fields: { answer: "Security answer is incorrect." } }
    }
    if (err.code === "VALIDATION_ERROR") {
      return { fields: {}, form: "Check your entries and try again." }
    }
    return { fields: {}, form: errorMessage(err) }
  }

  return { fields: {}, form: errorMessage(err) }
}

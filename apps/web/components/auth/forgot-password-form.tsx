"use client"

import Link from "next/link"
import { useState } from "react"
import { Eye, EyeOff, KeyRound, Lock, Mail, ShieldQuestion } from "lucide-react"

import {
  AuthLightField,
  AuthLightFormMessage,
  AuthPrimaryButton,
} from "@/components/auth/auth-light"
import { lookupPasswordRecovery, resetPasswordWithRecovery } from "@/lib/api/recovery"
import {
  hasRecoveryFieldErrors,
  mapRecoveryApiError,
  validateForgotPasswordEmail,
  validateForgotPasswordReset,
  type RecoveryFieldErrors,
} from "@/lib/auth/recovery-validation"

type Step = "email" | "reset" | "done"

export function ForgotPasswordForm() {
  const [step, setStep] = useState<Step>("email")
  const [busy, setBusy] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<RecoveryFieldErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [recoveryUnavailable, setRecoveryUnavailable] = useState(false)
  const [email, setEmail] = useState("")
  const [question, setQuestion] = useState("")
  const [answer, setAnswer] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [showPw, setShowPw] = useState(false)

  function clearFieldError(key: keyof RecoveryFieldErrors) {
    setFieldErrors((prev) => (prev[key] ? { ...prev, [key]: undefined } : prev))
    setFormError(null)
    setRecoveryUnavailable(false)
  }

  async function handleLookup(e: React.FormEvent) {
    e.preventDefault()
    setFieldErrors({})
    setFormError(null)
    setRecoveryUnavailable(false)

    const validation = validateForgotPasswordEmail(email)
    if (hasRecoveryFieldErrors(validation)) {
      setFieldErrors(validation)
      return
    }

    setBusy(true)
    try {
      const result = await lookupPasswordRecovery(email.trim().toLowerCase())
      if (!result.available || !result.question) {
        setRecoveryUnavailable(true)
        return
      }
      setQuestion(result.question)
      setStep("reset")
    } catch (err) {
      const mapped = mapRecoveryApiError(err)
      setFieldErrors(mapped.fields)
      if (mapped.form) setFormError(mapped.form)
    } finally {
      setBusy(false)
    }
  }

  async function handleReset(e: React.FormEvent) {
    e.preventDefault()
    setFieldErrors({})
    setFormError(null)

    const validation = validateForgotPasswordReset(answer, newPassword, confirmPassword)
    if (hasRecoveryFieldErrors(validation)) {
      setFieldErrors(validation)
      return
    }

    setBusy(true)
    try {
      await resetPasswordWithRecovery({
        email: email.trim().toLowerCase(),
        answer,
        newPassword,
      })
      setStep("done")
    } catch (err) {
      const mapped = mapRecoveryApiError(err)
      setFieldErrors(mapped.fields)
      if (mapped.form) setFormError(mapped.form)
    } finally {
      setBusy(false)
    }
  }

  if (step === "done") {
    return (
      <div className="space-y-5">
        <AuthLightFormMessage
          tone="success"
          message="Your password was updated. Sign in with your new password."
        />
        <Link href="/login" className="block">
          <AuthPrimaryButton type="button">Sign in</AuthPrimaryButton>
        </Link>
      </div>
    )
  }

  if (step === "reset") {
    return (
      <form className="space-y-4" method="post" onSubmit={handleReset}>
        <div className="rounded-2xl border border-[#e8e8e8] bg-[#f7f7f7] px-4 py-3">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest text-[#a0a0a0]">
            <ShieldQuestion className="size-3.5" />
            Security question
          </p>
          <p className="mt-1 text-sm leading-snug text-[#222222]">{question}</p>
        </div>

        <AuthLightField
          id="recovery-answer"
          label="Your answer"
          icon={KeyRound}
          value={answer}
          onChange={(v) => {
            setAnswer(v)
            clearFieldError("answer")
          }}
          placeholder="Answer from setup"
          autoComplete="off"
          error={fieldErrors.answer}
        />
        <AuthLightField
          id="recovery-new-password"
          label="New password"
          icon={Lock}
          type={showPw ? "text" : "password"}
          value={newPassword}
          onChange={(v) => {
            setNewPassword(v)
            clearFieldError("newPassword")
          }}
          placeholder="At least 8 characters"
          autoComplete="new-password"
          error={fieldErrors.newPassword}
          right={
            <button
              type="button"
              tabIndex={-1}
              className="text-[#c0c0c0] transition-colors hover:text-[#8a8a8a]"
              onClick={() => setShowPw((v) => !v)}
              aria-label={showPw ? "Hide password" : "Show password"}
            >
              {showPw ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          }
        />
        <AuthLightField
          id="recovery-confirm-password"
          label="Confirm password"
          icon={Lock}
          type="password"
          value={confirmPassword}
          onChange={(v) => {
            setConfirmPassword(v)
            clearFieldError("confirmPassword")
          }}
          placeholder="Repeat password"
          autoComplete="new-password"
          error={fieldErrors.confirmPassword}
        />

        <AuthLightFormMessage message={formError} />

        <AuthPrimaryButton type="submit" disabled={busy}>
          <KeyRound className="size-4" />
          {busy ? "Updating…" : "Reset password"}
        </AuthPrimaryButton>

        <p className="text-center text-[12.5px]">
          <Link
            href="/login"
            className="font-medium text-[#717171] underline-offset-4 hover:text-[#444444] hover:underline"
          >
            Back to sign in
          </Link>
        </p>
      </form>
    )
  }

  return (
    <form className="space-y-4" method="post" onSubmit={handleLookup}>
      {recoveryUnavailable ? (
        <AuthLightFormMessage
          tone="info"
          message="No security question on that account. Add one under Account → Password after signing in."
        />
      ) : null}

      <AuthLightField
        id="recovery-email"
        label="Email"
        icon={Mail}
        type="email"
        value={email}
        onChange={(v) => {
          setEmail(v)
          clearFieldError("email")
        }}
        placeholder="you@example.com"
        autoComplete="email"
        error={fieldErrors.email}
      />

      <AuthLightFormMessage message={formError} />

      <AuthPrimaryButton type="submit" disabled={busy}>
        {busy ? "Checking…" : "Continue"}
      </AuthPrimaryButton>

      <p className="text-center text-[12.5px]">
        <Link
          href="/login"
          className="font-medium text-[#717171] underline-offset-4 hover:text-[#444444] hover:underline"
        >
          Back to sign in
        </Link>
      </p>
    </form>
  )
}

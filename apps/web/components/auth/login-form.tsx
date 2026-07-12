"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { Check, Eye, EyeOff, Lock, LockKeyhole, Mail } from "lucide-react"
import { toast } from "@/lib/notifications/arciin-toast"
import { isIpForbiddenError } from "@/lib/api/errors"
import {
  ipForbiddenScreenCopy,
  resolveIpForbiddenReason,
} from "@/lib/security/ip-forbidden"
import { notifyIpBlocked } from "@/lib/notifications/toast-actions"

import {
  AuthLightField,
  AuthLightFormMessage,
  AuthPrimaryButton,
} from "@/components/auth/auth-light"
import { useLogin } from "@/hooks/use-auth"
import {
  queueWelcomeToast,
  readLoginRemember,
  writeLoginRemember,
} from "@/lib/auth/login-remember"
import { loginSchema, type LoginSchema } from "@/lib/validation/auth"

export function LoginForm() {
  const router = useRouter()
  const loginMutation = useLogin()
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [showPw, setShowPw] = useState(false)
  // Lazy initializer — reads localStorage once on mount, no effect needed.
  const [rememberMe, setRememberMe] = useState(() => readLoginRemember().rememberMe)
  const form = useForm<LoginSchema>({
    defaultValues: { email: "", password: "" },
  })

  useEffect(() => {
    const saved = readLoginRemember()
    if (saved.email) {
      form.setValue("email", saved.email)
    }
  }, [form])

  /**
   * Never accept or keep credentials in the URL. If something linked here with
   * ?email=…&password=… (or a pre-hydration GET submit), scrub them from the
   * address bar and history immediately — they are not read into the form.
   */
  useEffect(() => {
    const url = new URL(window.location.href)
    if (!url.searchParams.has("email") && !url.searchParams.has("password")) return
    url.searchParams.delete("email")
    url.searchParams.delete("password")
    const qs = url.searchParams.toString()
    window.history.replaceState({}, "", qs ? `${url.pathname}?${qs}` : url.pathname)
  }, [])

  return (
    <form
      className="space-y-4"
      /* POST so a submit before hydration can never serialize fields into the URL. */
      method="post"
      onSubmit={form.handleSubmit(async (values) => {
        setSubmitError(null)
        const parsed = loginSchema.safeParse(values)

        if (!parsed.success) {
          const fieldErrors = parsed.error.flatten().fieldErrors

          Object.entries(fieldErrors).forEach(([field, messages]) => {
            const message = messages?.[0]

            if (message) {
              form.setError(field as keyof LoginSchema, {
                type: "manual",
                message,
              })
            }
          })

          return
        }

        try {
          await loginMutation.mutateAsync({ ...parsed.data, rememberMe })
          writeLoginRemember(parsed.data.email, rememberMe)
          queueWelcomeToast()
          router.push("/dashboard")
          router.refresh()
        } catch (error) {
          if (isIpForbiddenError(error)) {
            const copy = ipForbiddenScreenCopy(resolveIpForbiddenReason(error.message))
            setSubmitError(copy.description)
            notifyIpBlocked(copy.title, copy.description)
            return
          }

          const message =
            error instanceof TypeError
              ? "Could not reach the Arciin API. Ensure pnpm dev (web + api) is running and your tunnel points at port 3000."
              : error instanceof Error
                ? error.message
                : "Could not sign in."
          setSubmitError(message)
          toast.error("Could not sign in", { description: message })
        }
      })}
    >
      <AuthLightField
        id="email"
        label="Email"
        icon={Mail}
        type="email"
        placeholder="you@example.com"
        autoComplete="email"
        error={form.formState.errors.email?.message}
        inputProps={form.register("email")}
      />
      <AuthLightField
        id="password"
        label="Password"
        icon={Lock}
        type={showPw ? "text" : "password"}
        placeholder="Your password"
        autoComplete="current-password"
        error={form.formState.errors.password?.message}
        inputProps={form.register("password")}
        right={
          <button
            type="button"
            tabIndex={-1}
            onClick={() => setShowPw((v) => !v)}
            className="text-[#c0c0c0] transition-colors hover:text-[#8a8a8a]"
            aria-label={showPw ? "Hide password" : "Show password"}
          >
            {showPw ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        }
      />

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <label
            htmlFor="remember-me"
            className="flex cursor-pointer items-center gap-2.5"
          >
            <button
              id="remember-me"
              type="button"
              role="checkbox"
              aria-checked={rememberMe}
              onClick={() => setRememberMe((v) => !v)}
              className="flex size-[18px] shrink-0 items-center justify-center rounded-[5px] border transition-colors"
              style={{
                borderColor: rememberMe ? "#ff4f12" : "#d4d4d4",
                backgroundColor: rememberMe ? "#ff4f12" : "#ffffff",
              }}
            >
              {rememberMe ? <Check className="size-3 stroke-[2.5] text-white" /> : null}
            </button>
            <span className="text-[12.5px] font-medium text-[#717171]">Remember me</span>
          </label>
          <Link
            href="/forgot-password"
            className="text-[12.5px] font-medium text-[#ff4f12] underline-offset-4 hover:underline"
          >
            Forgot password?
          </Link>
        </div>
        <p className="text-[11px] leading-relaxed text-[#a0a0a0]">
          Saves your email on this device and keeps you signed in longer. Arciin never stores
          your password — enter it each time you sign in.
        </p>
      </div>

      <AuthLightFormMessage message={submitError} />

      <AuthPrimaryButton type="submit" disabled={loginMutation.isPending}>
        <LockKeyhole className="size-4" />
        {loginMutation.isPending ? "Signing in…" : "Sign in"}
      </AuthPrimaryButton>
    </form>
  )
}

"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { Eye, EyeOff, LockKeyhole } from "lucide-react"
import { toast } from "sonner"
import { useState } from "react"

import { useLogin } from "@/hooks/use-auth"
import { loginSchema, type LoginSchema } from "@/lib/validation/auth"

// ── shared input style ────────────────────────────────────────────────────────
const INPUT_BASE =
  "w-full rounded-2xl border border-white/[0.1] bg-white/[0.05] px-4 py-4 text-[16px] text-white placeholder-zinc-600 outline-none transition-all duration-150 focus:border-[#ff4f12]/50 focus:bg-white/[0.07] focus:ring-2 focus:ring-[#ff4f12]/20"

export function MobileLogin() {
  const router = useRouter()
  const loginMutation = useLogin()
  const [showPassword, setShowPassword] = useState(false)
  const form = useForm<LoginSchema>({
    defaultValues: { email: "", password: "" },
  })

  const onSubmit = form.handleSubmit(async (values) => {
    const parsed = loginSchema.safeParse(values)
    if (!parsed.success) {
      const fieldErrors = parsed.error.flatten().fieldErrors
      Object.entries(fieldErrors).forEach(([field, messages]) => {
        const message = messages?.[0]
        if (message) form.setError(field as keyof LoginSchema, { type: "manual", message })
      })
      return
    }
    try {
      await loginMutation.mutateAsync(parsed.data)
      toast.success("Welcome back.")
      router.push("/dashboard")
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not sign in.")
    }
  })

  return (
    <div
      className="relative flex min-h-[100dvh] flex-col overflow-hidden bg-[#09090b]"
      style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {/* Top glow */}
      <div
        className="pointer-events-none absolute inset-0 z-0"
        aria-hidden
        style={{
          background:
            "radial-gradient(ellipse 80% 50% at 50% -10%, rgba(255,75,51,0.28) 0%, transparent 60%)",
        }}
      />
      {/* Secondary soft glow */}
      <div
        className="pointer-events-none absolute inset-0 z-0"
        aria-hidden
        style={{
          background:
            "radial-gradient(ellipse 55% 35% at 80% 5%, rgba(255,120,90,0.12) 0%, transparent 50%)",
        }}
      />

      {/* Content */}
      <div className="relative z-10 flex min-h-[100dvh] flex-col px-6">
        {/* Brand mark */}
        <div className="flex items-end pb-8 pt-14">
          <div>
            <p className="font-heading text-2xl font-semibold tracking-[-0.03em] text-white">
              Arciin
            </p>
            <p
              className="mt-1 text-[11px] font-medium uppercase tracking-[0.22em]"
              style={{ color: "rgba(255,255,255,0.35)" }}
            >
              Your server, your control.
            </p>
          </div>
        </div>

        {/* Heading */}
        <div className="mb-8">
          <h1 className="font-heading text-[28px] font-semibold tracking-tight text-white leading-tight">
            Sign in
          </h1>
          <p className="mt-2 text-[14px] leading-relaxed" style={{ color: "rgba(255,255,255,0.4)" }}>
            Enter your credentials to access this Arciin instance.
          </p>
        </div>

        {/* Form */}
        <form className="flex flex-col gap-4" onSubmit={onSubmit}>
          {/* Email */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[13px] font-medium" style={{ color: "rgba(255,255,255,0.55)" }}>
              Email
            </label>
            <input
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              className={INPUT_BASE}
              {...form.register("email")}
            />
            {form.formState.errors.email && (
              <p className="text-[12px] text-red-400">{form.formState.errors.email.message}</p>
            )}
          </div>

          {/* Password */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[13px] font-medium" style={{ color: "rgba(255,255,255,0.55)" }}>
              Password
            </label>
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                placeholder="••••••••"
                className={INPUT_BASE + " pr-12"}
                {...form.register("password")}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-4 top-1/2 -translate-y-1/2"
                style={{ color: "rgba(255,255,255,0.3)" }}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
            {form.formState.errors.password && (
              <p className="text-[12px] text-red-400">{form.formState.errors.password.message}</p>
            )}
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={loginMutation.isPending}
            className="mt-2 flex w-full items-center justify-center gap-2 rounded-2xl py-4 text-[15px] font-semibold text-white transition-all active:scale-[0.98] disabled:opacity-60"
            style={{
              background: loginMutation.isPending
                ? "rgba(255,79,18,0.6)"
                : "linear-gradient(135deg, #ff4f12 0%, #ff6a33 100%)",
              boxShadow: "0 0 32px rgba(255,75,51,0.3)",
            }}
          >
            <LockKeyhole className="size-4 shrink-0" />
            {loginMutation.isPending ? "Signing in…" : "Sign in"}
          </button>
        </form>

        {/* Footer */}
        <div className="mt-auto pb-6 pt-10 text-center">
          <p className="text-[13px]" style={{ color: "rgba(255,255,255,0.3)" }}>
            First time?{" "}
            <Link
              href="/setup"
              className="underline-offset-4 hover:underline"
              style={{ color: "rgba(255,255,255,0.6)" }}
            >
              Set up this instance
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}

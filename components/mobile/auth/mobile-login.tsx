"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { Eye, EyeOff, Server, ShieldCheck } from "lucide-react"
import { toast } from "sonner"

import { useLogin } from "@/hooks/use-auth"
import { loginSchema, type LoginSchema } from "@/lib/validation/auth"

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
        const msg = messages?.[0]
        if (msg) form.setError(field as keyof LoginSchema, { type: "manual", message: msg })
      })
      return
    }
    try {
      await loginMutation.mutateAsync(parsed.data)
      router.push("/dashboard")
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not sign in.")
    }
  })

  return (
    <div
      className="relative flex min-h-[100dvh] flex-col bg-[#09090b]"
      style={{
        paddingTop: "env(safe-area-inset-top)",
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
    >
      {/* ── Atmosphere ──────────────────────────────────────────────────── */}
      <div
        className="pointer-events-none fixed inset-0"
        aria-hidden
        style={{
          background: [
            "radial-gradient(ellipse 80% 55% at 50% -5%, rgba(255,79,18,0.22) 0%, transparent 65%)",
            "radial-gradient(ellipse 50% 30% at 85% 10%, rgba(255,120,60,0.10) 0%, transparent 55%)",
          ].join(","),
        }}
      />
      {/* Subtle grid overlay */}
      <div
        className="pointer-events-none fixed inset-0 opacity-[0.025]"
        aria-hidden
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)",
          backgroundSize: "40px 40px",
        }}
      />

      {/* ── Content ─────────────────────────────────────────────────────── */}
      <div className="relative z-10 flex flex-1 flex-col justify-center px-7 pb-10 pt-16">

        {/* Brand */}
        <div className="mb-10">
          {/* Icon mark */}
          <div
            className="mb-5 flex size-[52px] items-center justify-center rounded-[16px]"
            style={{
              background: "linear-gradient(135deg, #ff4f12 0%, #cc2e00 100%)",
              boxShadow: "0 8px 32px rgba(255,79,18,0.35), 0 0 0 1px rgba(255,79,18,0.2)",
            }}
          >
            <Server className="size-[22px] text-white" />
          </div>

          {/* Name */}
          <h1 className="font-heading text-[32px] font-bold tracking-tight text-white leading-none">
            Arciin
          </h1>

          {/* One-line tagline */}
          <p
            className="mt-2 text-[14px]"
            style={{ color: "rgba(255,255,255,0.38)" }}
          >
            Sign in to your instance
          </p>
        </div>

        {/* Form */}
        <form className="flex flex-col gap-3" onSubmit={onSubmit}>
          {/* Email */}
          <div>
            <div
              className="flex items-center gap-3 rounded-2xl px-4 transition-all"
              style={{
                background: "rgba(255,255,255,0.05)",
                border: "1px solid rgba(255,255,255,0.1)",
              }}
            >
              <input
                type="email"
                autoComplete="email"
                placeholder="Email"
                className="flex-1 bg-transparent py-[15px] text-[16px] text-white placeholder-zinc-600 outline-none"
                {...form.register("email")}
              />
            </div>
            {form.formState.errors.email && (
              <p className="mt-1.5 px-1 text-[12px] text-red-400">
                {form.formState.errors.email.message}
              </p>
            )}
          </div>

          {/* Password */}
          <div>
            <div
              className="flex items-center gap-3 rounded-2xl px-4 transition-all"
              style={{
                background: "rgba(255,255,255,0.05)",
                border: "1px solid rgba(255,255,255,0.1)",
              }}
            >
              <input
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                placeholder="Password"
                className="flex-1 bg-transparent py-[15px] text-[16px] text-white placeholder-zinc-600 outline-none"
                {...form.register("password")}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="shrink-0 text-zinc-600 transition active:text-zinc-300"
                aria-label={showPassword ? "Hide" : "Show"}
              >
                {showPassword
                  ? <EyeOff className="size-[18px]" />
                  : <Eye className="size-[18px]" />}
              </button>
            </div>
            {form.formState.errors.password && (
              <p className="mt-1.5 px-1 text-[12px] text-red-400">
                {form.formState.errors.password.message}
              </p>
            )}
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={loginMutation.isPending}
            className="mt-2 w-full rounded-2xl py-[15px] text-[15px] font-semibold text-white transition-all active:scale-[0.98] disabled:opacity-55"
            style={{
              background: "linear-gradient(135deg, #ff4f12 0%, #ff6a33 100%)",
              boxShadow: "0 4px 24px rgba(255,79,18,0.35), 0 0 0 1px rgba(255,79,18,0.15)",
            }}
          >
            {loginMutation.isPending ? "Signing in…" : "Sign in"}
          </button>
        </form>

        {/* Trust footer */}
        <div
          className="mt-10 flex items-center justify-center gap-1.5"
        >
          <ShieldCheck className="size-3.5" style={{ color: "rgba(255,255,255,0.2)" }} />
          <span
            className="text-[12px]"
            style={{ color: "rgba(255,255,255,0.2)" }}
          >
            Local authentication · data stays on your server
          </span>
        </div>
      </div>
    </div>
  )
}

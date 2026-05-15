"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { Eye, EyeOff } from "lucide-react"
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

  const input =
    "w-full rounded-2xl border border-white/[0.1] bg-white/[0.06] px-4 py-[15px] text-[16px] text-white placeholder-zinc-600 outline-none transition focus:border-[#ff4f12]/50 focus:ring-2 focus:ring-[#ff4f12]/20"

  return (
    <div
      className="flex min-h-[100dvh] flex-col items-center justify-center bg-[#09090b] px-6"
      style={{
        paddingTop: "env(safe-area-inset-top)",
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
    >
      {/* Glow */}
      <div
        className="pointer-events-none fixed inset-0"
        aria-hidden
        style={{
          background:
            "radial-gradient(ellipse 70% 45% at 50% 0%, rgba(255,79,18,0.16) 0%, transparent 60%)",
        }}
      />

      <div className="relative z-10 w-full max-w-sm">
        {/* Logo */}
        <p className="mb-10 font-heading text-[26px] font-semibold tracking-tight text-white">
          Arciin
        </p>

        {/* Fields */}
        <form className="flex flex-col gap-3" onSubmit={onSubmit}>
          <div>
            <input
              type="email"
              autoComplete="email"
              placeholder="Email"
              className={input}
              {...form.register("email")}
            />
            {form.formState.errors.email && (
              <p className="mt-1.5 px-1 text-[12px] text-red-400">
                {form.formState.errors.email.message}
              </p>
            )}
          </div>

          <div>
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                placeholder="Password"
                className={input + " pr-12"}
                {...form.register("password")}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-600 transition active:text-zinc-300"
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff className="size-[18px]" /> : <Eye className="size-[18px]" />}
              </button>
            </div>
            {form.formState.errors.password && (
              <p className="mt-1.5 px-1 text-[12px] text-red-400">
                {form.formState.errors.password.message}
              </p>
            )}
          </div>

          <button
            type="submit"
            disabled={loginMutation.isPending}
            className="mt-1 w-full rounded-2xl py-[15px] text-[15px] font-semibold text-white transition-all active:scale-[0.98] disabled:opacity-60"
            style={{
              background: "linear-gradient(135deg, #ff4f12 0%, #ff6a33 100%)",
              boxShadow: "0 0 28px rgba(255,75,51,0.22)",
            }}
          >
            {loginMutation.isPending ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  )
}

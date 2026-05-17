"use client"

import { Suspense, useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { useForm } from "react-hook-form"
import { LockKeyhole } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { useLogin } from "@/hooks/use-auth"
import { loginSchema, type LoginSchema } from "@/lib/validation/auth"

function LoginFormInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const loginMutation = useLogin()
  const [submitError, setSubmitError] = useState<string | null>(null)
  const emailFromUrl = searchParams.get("email")?.trim() ?? ""
  const passwordFromUrl = searchParams.get("password") ?? ""
  const hadUrlCredentials = Boolean(emailFromUrl || passwordFromUrl)
  const form = useForm<LoginSchema>({
    defaultValues: {
      email: emailFromUrl,
      password: passwordFromUrl,
    },
  })

  useEffect(() => {
    if (!hadUrlCredentials) return
    const next = new URL(window.location.href)
    next.searchParams.delete("email")
    next.searchParams.delete("password")
    const qs = next.searchParams.toString()
    window.history.replaceState({}, "", qs ? `${next.pathname}?${qs}` : next.pathname)
  }, [hadUrlCredentials])

  return (
    <form
      className="space-y-6"
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
          await loginMutation.mutateAsync(parsed.data)
          toast.success("Welcome back.")
          router.push("/dashboard")
          router.refresh()
        } catch (error) {
          const message =
            error instanceof TypeError
              ? "Could not reach the Arciin API. Ensure pnpm dev (web + api) is running and your tunnel points at port 3000."
              : error instanceof Error
                ? error.message
                : "Could not sign in."
          setSubmitError(message)
          toast.error(message)
        }
      })}
    >

      {hadUrlCredentials ? (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[12px] leading-relaxed text-amber-100">
          Email and password were read from the URL into this form only — you still need to click Sign in.
          Do not share login links with passwords in them; change your password if this URL was exposed.
        </p>
      ) : null}

      <FieldGroup className="gap-4">
        <Field>
          <FieldLabel htmlFor="email">Email</FieldLabel>
          <Input id="email" type="email" autoComplete="email" {...form.register("email")} />
          <FieldError errors={[form.formState.errors.email]} />
        </Field>
        <Field>
          <FieldLabel htmlFor="password">Password</FieldLabel>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            {...form.register("password")}
          />
          <FieldError errors={[form.formState.errors.password]} />
        </Field>
      </FieldGroup>

      {submitError ? (
        <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[13px] text-red-100">
          {submitError}
        </p>
      ) : null}

      <Button
        type="submit"
        disabled={loginMutation.isPending}
        className="w-full bg-primary text-white shadow-[0_0_36px_rgba(255,75,51,0.16)] hover:bg-primary/90"
      >
        <LockKeyhole className="size-4" />
        {loginMutation.isPending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  )
}

export function LoginForm() {
  return (
    <Suspense
      fallback={
        <div className="space-y-4 py-2">
          <div className="h-10 animate-pulse rounded-lg bg-white/10" />
          <div className="h-10 animate-pulse rounded-lg bg-white/10" />
          <div className="h-10 animate-pulse rounded-lg bg-primary/40" />
        </div>
      }
    >
      <LoginFormInner />
    </Suspense>
  )
}

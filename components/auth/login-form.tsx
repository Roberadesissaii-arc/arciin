"use client"

import { useRouter } from "next/navigation"
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

export function LoginForm() {
  const router = useRouter()
  const loginMutation = useLogin()
  const form = useForm<LoginSchema>({
    defaultValues: {
      email: "",
      password: "",
    },
  })

  return (
    <form
      className="space-y-6"
      onSubmit={form.handleSubmit(async (values) => {
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
          toast.error(error instanceof Error ? error.message : "Could not sign in.")
        }
      })}
    >
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

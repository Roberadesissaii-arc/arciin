"use client"

import Link from "next/link"
import { useState } from "react"
import { useRouter } from "next/navigation"
import { useForm, useWatch } from "react-hook-form"
import {
  ArrowLeft,
  ArrowRight,
  Clapperboard,
  FileText,
  ImageIcon,
  Inbox,
  Music4,
  Sparkles,
  type LucideIcon,
} from "lucide-react"
import { toast } from "sonner"

import { useClaimInstance } from "@/hooks/use-instance"
import { cn } from "@/lib/utils"
import {
  setupDetailsSchema,
  setupLibraryOptions,
  setupSchema,
  type SetupSchema,
} from "@/lib/validation/setup"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldSet,
  FieldTitle,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"

const setupDetailFields = [
  "setupToken",
  "instanceName",
  "storageRoot",
  "adminName",
  "adminEmail",
  "adminPassword",
  "confirmPassword",
] as const satisfies readonly (keyof SetupSchema)[]

const libraryMeta = {
  Videos: {
    description: "Movies, screen recordings, and clips routed to the video library.",
    icon: Clapperboard,
  },
  Images: {
    description: "Photos, renders, screenshots, and artwork kept in one place.",
    icon: ImageIcon,
  },
  Music: {
    description: "Audio uploads, albums, and sound assets ready for playback later.",
    icon: Music4,
  },
  Documents: {
    description: "PDFs, notes, archives, and structured docs for the instance.",
    icon: FileText,
  },
  Inbox: {
    description: "Fallback destination for anything Arciin cannot classify yet.",
    icon: Inbox,
  },
} satisfies Record<
  (typeof setupLibraryOptions)[number],
  { description: string; icon: LucideIcon }
>

export function SetupForm() {
  const router = useRouter()
  const claimMutation = useClaimInstance()
  const [step, setStep] = useState<"details" | "libraries">("details")
  const form = useForm<SetupSchema>({
    defaultValues: {
      setupToken: "",
      instanceName: "Local Instance",
      adminName: "",
      adminEmail: "",
      adminPassword: "",
      confirmPassword: "",
      storageRoot: "./data/arciin",
      libraries: [...setupLibraryOptions],
      acceptedTermsAndPrivacy: false,
    },
  })

  const selectedLibraries = useWatch({
    control: form.control,
    name: "libraries",
  }) ?? []
  const instanceName = useWatch({
    control: form.control,
    name: "instanceName",
  })
  const storageRoot = useWatch({
    control: form.control,
    name: "storageRoot",
  })
  const adminEmail = useWatch({
    control: form.control,
    name: "adminEmail",
  })
  const acceptedTermsAndPrivacy = useWatch({
    control: form.control,
    name: "acceptedTermsAndPrivacy",
  })

  const applyFieldErrors = (
    fieldErrors: Partial<Record<keyof SetupSchema, string[] | undefined>>,
    fields?: readonly (keyof SetupSchema)[]
  ) => {
    const allowedFields = fields ? new Set<string>(fields) : null

    Object.entries(fieldErrors).forEach(([field, messages]) => {
      if (allowedFields && !allowedFields.has(field)) {
        return
      }

      const message = messages?.[0]

      if (message) {
        form.setError(field as keyof SetupSchema, {
          type: "manual",
          message,
        })
      }
    })
  }

  const handleContinue = async () => {
    setupDetailFields.forEach((field) => form.clearErrors(field))

    const parsed = setupDetailsSchema.safeParse(form.getValues())

    if (!parsed.success) {
      applyFieldErrors(parsed.error.flatten().fieldErrors, setupDetailFields)
      return
    }

    setStep("libraries")
  }

  const submitClaim = form.handleSubmit(async (values) => {
    const parsed = setupSchema.safeParse(values)

    if (!parsed.success) {
      applyFieldErrors(parsed.error.flatten().fieldErrors)
      return
    }

    try {
      await claimMutation.mutateAsync(parsed.data)
      toast.success("Arciin is ready.")
      router.push("/dashboard")
      router.refresh()
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not claim the instance."
      )
    }
  })

  return (
    <form
      className="space-y-8"
      onSubmit={(event) => {
        if (step === "details") {
          event.preventDefault()
          void handleContinue()
          return
        }

        void submitClaim(event)
      }}
    >
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <Badge className="bg-[#FF4B33]/12 px-3 py-1 text-[#FFB08F] hover:bg-[#FF4B33]/12">
            {step === "details" ? "Step 1 of 2" : "Step 2 of 2"}
          </Badge>
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "h-1.5 w-8 rounded-full transition-colors",
                "bg-primary"
              )}
            />
            <span
              className={cn(
                "h-1.5 w-8 rounded-full transition-colors",
                step === "libraries" ? "bg-primary" : "bg-white/10"
              )}
            />
          </div>
        </div>

        {step === "details" ? (
          <div className="space-y-2">
            <h2 className="text-3xl font-semibold tracking-tight text-white">
              Instance configuration
            </h2>
            <p className="text-sm leading-6 text-zinc-400">
              Set the setup token, owner account, and local storage path before Arciin creates
              the instance.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            <h2 className="text-3xl font-semibold tracking-tight text-white">
              Choose default libraries
            </h2>
            <p className="text-sm leading-6 text-zinc-400">
              Pick the libraries Arciin should create immediately after the first successful claim.
            </p>
          </div>
        )}
      </div>

      {step === "details" ? (
        <>
          <FieldGroup className="gap-5">
            <Field>
              <FieldLabel htmlFor="setupToken">Setup token</FieldLabel>
              <Input
                id="setupToken"
                type="password"
                autoComplete="off"
                className="h-11 rounded-lg border-white/10 bg-white/[0.03]"
                {...form.register("setupToken")}
              />
              <FieldError errors={[form.formState.errors.setupToken]} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="instanceName">Instance name</FieldLabel>
                <Input
                  id="instanceName"
                  className="h-11 rounded-lg border-white/10 bg-white/[0.03]"
                  {...form.register("instanceName")}
                />
                <FieldError errors={[form.formState.errors.instanceName]} />
              </Field>
              <Field>
                <FieldLabel htmlFor="storageRoot">Storage root path</FieldLabel>
                <Input
                  id="storageRoot"
                  className="h-11 rounded-lg border-white/10 bg-white/[0.03]"
                  {...form.register("storageRoot")}
                />
                <FieldError errors={[form.formState.errors.storageRoot]} />
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="adminName">Admin name</FieldLabel>
                <Input
                  id="adminName"
                  autoComplete="name"
                  className="h-11 rounded-lg border-white/10 bg-white/[0.03]"
                  {...form.register("adminName")}
                />
                <FieldError errors={[form.formState.errors.adminName]} />
              </Field>
              <Field>
                <FieldLabel htmlFor="adminEmail">Admin email</FieldLabel>
                <Input
                  id="adminEmail"
                  type="email"
                  autoComplete="email"
                  className="h-11 rounded-lg border-white/10 bg-white/[0.03]"
                  {...form.register("adminEmail")}
                />
                <FieldError errors={[form.formState.errors.adminEmail]} />
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="adminPassword">Admin password</FieldLabel>
                <Input
                  id="adminPassword"
                  type="password"
                  autoComplete="new-password"
                  className="h-11 rounded-lg border-white/10 bg-white/[0.03]"
                  {...form.register("adminPassword")}
                />
                <FieldError errors={[form.formState.errors.adminPassword]} />
              </Field>
              <Field>
                <FieldLabel htmlFor="confirmPassword">Confirm password</FieldLabel>
                <Input
                  id="confirmPassword"
                  type="password"
                  autoComplete="new-password"
                  className="h-11 rounded-lg border-white/10 bg-white/[0.03]"
                  {...form.register("confirmPassword")}
                />
                <FieldError errors={[form.formState.errors.confirmPassword]} />
              </Field>
            </div>
          </FieldGroup>

          <div className="flex flex-col gap-4 border-t border-white/8 pt-6 sm:flex-row sm:items-center sm:justify-between">
            <p className="max-w-sm text-sm leading-6 text-zinc-400">
              Setup stays local first. After this step you can choose the default libraries
              Arciin should create.
            </p>
            <Button
              type="submit"
              size="lg"
              className="w-full bg-primary text-white shadow-[0_0_36px_rgba(255,75,51,0.16)] hover:bg-primary/90 sm:w-auto"
            >
              Continue
              <ArrowRight className="size-4" />
            </Button>
          </div>
        </>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-3">
            <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-3 sm:p-3.5">
              <div className="text-[10px] font-medium uppercase tracking-[0.16em] text-zinc-500">
                Instance
              </div>
              <div className="mt-0.5 truncate text-sm font-medium text-white">
                {instanceName?.trim() || "Local Instance"}
              </div>
            </div>
            <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-3 sm:p-3.5">
              <div className="text-[10px] font-medium uppercase tracking-[0.16em] text-zinc-500">
                Storage
              </div>
              <div className="mt-0.5 truncate text-sm font-medium text-white">
                {storageRoot?.trim() || "./data/arciin"}
              </div>
            </div>
            <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-3 sm:p-3.5">
              <div className="text-[10px] font-medium uppercase tracking-[0.16em] text-zinc-500">
                Owner
              </div>
              <div className="mt-0.5 truncate text-sm font-medium text-white">
                {adminEmail?.trim() || "owner@local"}
              </div>
            </div>
          </div>

          <FieldSet className="gap-3">
            <div className="flex items-center justify-between gap-3">
              <FieldTitle>Default libraries</FieldTitle>
              <Badge variant="outline" className="border-white/8 text-zinc-400">
                {selectedLibraries.length} selected
              </Badge>
            </div>
            <FieldDescription className="text-xs leading-relaxed">
              Keep at least one library enabled. Inbox is recommended as the catch-all for
              unknown file types during upload.
            </FieldDescription>
            <div className="grid grid-cols-2 gap-2 pt-1 sm:grid-cols-3 sm:gap-2">
              {setupLibraryOptions.map((library) => {
                const checked = selectedLibraries.includes(library)
                const Icon = libraryMeta[library].icon

                return (
                  <label
                    key={library}
                    className={cn(
                      "flex cursor-pointer flex-col gap-1.5 rounded-2xl border p-2.5 text-left transition-colors sm:p-3",
                      checked
                        ? "border-white/18 bg-white/[0.06]"
                        : "border-white/8 bg-black/20 hover:border-white/14 hover:bg-white/[0.04]"
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div
                        className={cn(
                          "flex size-8 shrink-0 items-center justify-center rounded-lg border",
                          checked
                            ? "border-white/15 bg-white/[0.08] text-zinc-200"
                            : "border-white/8 bg-white/[0.04] text-zinc-500"
                        )}
                      >
                        <Icon className="size-3.5" />
                      </div>
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(nextChecked) => {
                          const current = form.getValues("libraries")
                          const nextLibraries = nextChecked
                            ? Array.from(new Set([...current, library]))
                            : current.filter((value) => value !== library)

                          form.setValue("libraries", nextLibraries, {
                            shouldDirty: true,
                            shouldValidate: true,
                          })
                          form.clearErrors("libraries")
                        }}
                      />
                    </div>
                    <span className="truncate text-sm font-medium text-white">{library}</span>
                    <span className="line-clamp-2 text-[11px] leading-snug text-zinc-400">
                      {libraryMeta[library].description}
                    </span>
                  </label>
                )
              })}
            </div>
            <FieldError errors={[form.formState.errors.libraries]} />
          </FieldSet>

          <p className="text-xs leading-relaxed text-zinc-500 sm:text-sm">
            First user becomes owner. Setup locks after the first successful claim. Passwords
            are hashed before storage.
          </p>

          <div className="rounded-lg border border-white/8 bg-black/20 p-3">
            <div className="flex gap-3">
              <Checkbox
                id="accept-legal"
                className="mt-0.5"
                checked={Boolean(acceptedTermsAndPrivacy)}
                onCheckedChange={(next) => {
                  form.setValue("acceptedTermsAndPrivacy", next === true, {
                    shouldDirty: true,
                    shouldValidate: true,
                  })
                }}
              />
              <label htmlFor="accept-legal" className="cursor-pointer text-sm leading-relaxed text-zinc-400">
                I have read and agree to Arciin&apos;s{" "}
                <Link
                  href="/legal/terms"
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-zinc-200 underline underline-offset-4 hover:text-white"
                >
                  Terms of Use
                </Link>{" "}
                and{" "}
                <Link
                  href="/legal/privacy"
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-zinc-200 underline underline-offset-4 hover:text-white"
                >
                  Privacy Policy
                </Link>
                . I understand this software runs on infrastructure I control and that I am
                responsible for how it is operated and secured.
              </label>
            </div>
            <FieldError
              className="mt-2 pl-7"
              errors={[form.formState.errors.acceptedTermsAndPrivacy]}
            />
          </div>

          <div className="flex flex-col gap-3 border-t border-white/8 pt-5 sm:flex-row sm:items-center sm:justify-between">
            <Button
              type="button"
              variant="outline"
              size="lg"
              onClick={() => setStep("details")}
              className="border-white/10 bg-white/[0.03] text-white hover:bg-white/[0.06] sm:w-auto"
            >
              <ArrowLeft className="size-4" />
              Back
            </Button>
            <Button
              type="submit"
              size="lg"
              disabled={claimMutation.isPending}
              className="w-full bg-primary text-white shadow-[0_0_36px_rgba(255,75,51,0.16)] hover:bg-primary/90 sm:w-auto"
            >
              <Sparkles className="size-4" />
              {claimMutation.isPending ? "Claiming instance..." : "Claim instance"}
            </Button>
          </div>
        </div>
      )}
    </form>
  )
}

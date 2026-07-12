"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { useForm, useWatch } from "react-hook-form"
import {
  ArrowLeft,
  ArrowRight,
  Clapperboard,
  FileText,
  ImageIcon,
  Inbox,
  KeyRound,
  Lock,
  Mail,
  Music4,
  Server,
  Sparkles,
  User,
  type LucideIcon,
} from "lucide-react"
import { toast } from "@/lib/notifications/arciin-toast"

import { ARCIIN_DEV_STORAGE_ROOT } from "@arciin/shared"

import { useClaimInstance } from "@/hooks/use-instance"
import { getInstanceStatus } from "@/lib/api/instance"
import {
  AuthLightField,
  AuthPrimaryButton,
  AuthSecondaryButton,
} from "@/components/auth/auth-light"
import { SetupStoragePicker } from "@/components/auth/setup-storage-picker"
import { cn } from "@/lib/utils"
import {
  setupDetailsSchema,
  setupLibraryOptions,
  setupSchema,
  type SetupSchema,
} from "@/lib/validation/setup"
import { Checkbox } from "@/components/ui/checkbox"

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

const lightCheckboxClass =
  "border-[#d4d4d4] bg-white data-[state=checked]:border-[#ff4f12] data-[state=checked]:bg-[#ff4f12] data-[state=checked]:text-white"

function SetupFieldError({ message }: { message?: string }) {
  if (!message) return null
  return (
    <p className="px-1 text-[11px] font-medium text-[#dc2626]" role="alert">
      {message}
    </p>
  )
}

export function SetupForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const claimMutation = useClaimInstance()
  const [step, setStep] = useState<"details" | "libraries">("details")
  const [storageRootHint, setStorageRootHint] = useState<string | null>(null)
  const form = useForm<SetupSchema>({
    defaultValues: {
      setupToken: "",
      instanceName: "Local Instance",
      adminName: "",
      adminEmail: "",
      adminPassword: "",
      confirmPassword: "",
      storageRoot: "",
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

  useEffect(() => {
    const fromUrl = searchParams.get("token")?.trim()
    if (fromUrl) {
      form.setValue("setupToken", fromUrl)
    }
  }, [form, searchParams])

  useEffect(() => {
    let cancelled = false
    void getInstanceStatus()
      .then((status) => {
        if (cancelled) return
        if (status.setupTokenPrefill && !form.getValues("setupToken")?.trim()) {
          form.setValue("setupToken", status.setupTokenPrefill)
        }
        if (!status.suggestedStorageRoot) return
        const current = form.getValues("storageRoot")
        if (!current?.trim() || current === ARCIIN_DEV_STORAGE_ROOT || current === "./data/arciin") {
          form.setValue("storageRoot", status.suggestedStorageRoot)
        }
        if (status.storageRootHint) setStorageRootHint(status.storageRootHint)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [form])

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
      toast.success("Arciin is ready.", {
        description: "Your instance is claimed and the owner account is set up.",
      })
      router.push("/setup/complete")
      router.refresh()
    } catch (error) {
      toast.error("Could not claim the instance", {
        description: error instanceof Error ? error.message : "Try again in a moment.",
      })
    }
  })

  return (
    <form
      className="space-y-5"
      method="post"
      onSubmit={(event) => {
        if (step === "details") {
          event.preventDefault()
          void handleContinue()
          return
        }

        void submitClaim(event)
      }}
    >
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <span className="inline-flex items-center rounded-full border border-[#ffd9c9] bg-[#fff3ee] px-3 py-1 text-[11px] font-semibold text-[#e04a12]">
            {step === "details" ? "Step 1 of 2" : "Step 2 of 2"}
          </span>
          <div className="flex items-center gap-2">
            <span className="h-1.5 w-8 rounded-full bg-[#ff4f12] transition-colors" />
            <span
              className={cn(
                "h-1.5 w-8 rounded-full transition-colors",
                step === "libraries" ? "bg-[#ff4f12]" : "bg-[#e8e8e8]"
              )}
            />
          </div>
        </div>

        {step === "details" ? (
          <div className="space-y-1">
            <h2 className="font-heading text-[22px] font-bold tracking-tight text-[#111111]">
              Instance configuration
            </h2>
            <p className="text-[13px] leading-relaxed text-[#a0a0a0]">
              Setup token, owner account, and where files are stored.
            </p>
          </div>
        ) : (
          <div className="space-y-1">
            <h2 className="font-heading text-[22px] font-bold tracking-tight text-[#111111]">
              Choose default libraries
            </h2>
            <p className="text-[13px] leading-relaxed text-[#a0a0a0]">
              Pick the libraries Arciin should create immediately after the first successful claim.
            </p>
          </div>
        )}
      </div>

      {step === "details" ? (
        <>
          <div className="space-y-3.5">
            <AuthLightField
              id="setupToken"
              label="Setup token"
              icon={KeyRound}
              type="password"
              autoComplete="off"
              placeholder="From install output or ARCIIN_SETUP_TOKEN in .env"
              error={form.formState.errors.setupToken?.message}
              inputProps={form.register("setupToken")}
              description={
                <>
                  Printed at the end of <code>./install.sh</code> and in{" "}
                  <code>ARCIIN_SETUP_TOKEN</code> in your server <code>.env</code>. Open{" "}
                  <code>/setup?token=…</code> from the install summary to prefill.
                </>
              }
            />
            <AuthLightField
              id="instanceName"
              label="Instance name"
              icon={Server}
              error={form.formState.errors.instanceName?.message}
              inputProps={form.register("instanceName")}
            />
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="storageRoot"
                className="text-[11px] font-semibold uppercase tracking-widest text-[#a0a0a0]"
              >
                Storage location
              </label>
              <SetupStoragePicker
                value={storageRoot ?? ""}
                onChange={(path) => form.setValue("storageRoot", path, { shouldValidate: true })}
                hint={storageRootHint}
                errorMessage={form.formState.errors.storageRoot?.message}
              />
            </div>
            <div className="grid gap-3.5 sm:grid-cols-2">
              <AuthLightField
                id="adminName"
                label="Admin name"
                icon={User}
                autoComplete="name"
                error={form.formState.errors.adminName?.message}
                inputProps={form.register("adminName")}
              />
              <AuthLightField
                id="adminEmail"
                label="Admin email"
                icon={Mail}
                type="email"
                autoComplete="email"
                error={form.formState.errors.adminEmail?.message}
                inputProps={form.register("adminEmail")}
              />
            </div>
            <div className="grid gap-3.5 sm:grid-cols-2">
              <AuthLightField
                id="adminPassword"
                label="Admin password"
                icon={Lock}
                type="password"
                autoComplete="new-password"
                error={form.formState.errors.adminPassword?.message}
                inputProps={form.register("adminPassword")}
              />
              <AuthLightField
                id="confirmPassword"
                label="Confirm password"
                icon={Lock}
                type="password"
                autoComplete="new-password"
                error={form.formState.errors.confirmPassword?.message}
                inputProps={form.register("confirmPassword")}
              />
            </div>
          </div>

          <div className="flex flex-col gap-3 border-t border-[#ececec] pt-4 sm:flex-row sm:items-center sm:justify-end">
            <AuthPrimaryButton type="submit" className="sm:w-auto sm:px-6">
              Continue
              <ArrowRight className="size-4" />
            </AuthPrimaryButton>
          </div>
        </>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-3">
            <div className="rounded-2xl border border-[#e8e8e8] bg-[#f7f7f7] p-3 sm:p-3.5">
              <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#a0a0a0]">
                Instance
              </div>
              <div className="mt-0.5 truncate text-sm font-medium text-[#222222]">
                {instanceName?.trim() || "Local Instance"}
              </div>
            </div>
            <div className="rounded-2xl border border-[#e8e8e8] bg-[#f7f7f7] p-3 sm:p-3.5">
              <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#a0a0a0]">
                Storage
              </div>
              <div className="mt-0.5 truncate text-sm font-medium text-[#222222]">
                {storageRoot?.trim() || "/srv/arciin-storage/arciin"}
              </div>
            </div>
            <div className="rounded-2xl border border-[#e8e8e8] bg-[#f7f7f7] p-3 sm:p-3.5">
              <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#a0a0a0]">
                Owner
              </div>
              <div className="mt-0.5 truncate text-sm font-medium text-[#222222]">
                {adminEmail?.trim() || "owner@local"}
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-[#111111]">Default libraries</p>
              <span className="rounded-full border border-[#e5e5e5] bg-white px-2.5 py-0.5 text-[11px] font-medium text-[#717171]">
                {selectedLibraries.length} selected
              </span>
            </div>
            <p className="text-xs leading-relaxed text-[#a0a0a0]">
              Keep at least one library enabled. Inbox is recommended as the catch-all for
              unknown file types during upload.
            </p>
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
                        ? "border-[#ffb59a] bg-[#fff5f0]"
                        : "border-[#e8e8e8] bg-white hover:border-[#d9d9d9] hover:bg-[#fafafa]"
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div
                        className={cn(
                          "flex size-8 shrink-0 items-center justify-center rounded-lg border",
                          checked
                            ? "border-[#ffcab5] bg-white text-[#ff4f12]"
                            : "border-[#ececec] bg-[#f7f7f7] text-[#a0a0a0]"
                        )}
                      >
                        <Icon className="size-3.5" />
                      </div>
                      <Checkbox
                        checked={checked}
                        className={lightCheckboxClass}
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
                    <span className="truncate text-sm font-medium text-[#222222]">{library}</span>
                    <span className="line-clamp-2 text-[11px] leading-snug text-[#8a8a8a]">
                      {libraryMeta[library].description}
                    </span>
                  </label>
                )
              })}
            </div>
            <SetupFieldError message={form.formState.errors.libraries?.message} />
          </div>

          <p className="text-xs leading-relaxed text-[#a0a0a0] sm:text-[13px]">
            First user becomes owner. Setup locks after the first successful claim. Passwords
            are hashed before storage.
          </p>

          <div className="rounded-2xl border border-[#e8e8e8] bg-[#f7f7f7] p-3.5">
            <div className="flex gap-3">
              <Checkbox
                id="accept-legal"
                className={cn("mt-0.5", lightCheckboxClass)}
                checked={Boolean(acceptedTermsAndPrivacy)}
                onCheckedChange={(next) => {
                  form.setValue("acceptedTermsAndPrivacy", next === true, {
                    shouldDirty: true,
                    shouldValidate: true,
                  })
                }}
              />
              <label
                htmlFor="accept-legal"
                className="cursor-pointer text-[13px] leading-relaxed text-[#717171]"
              >
                I have read and agree to Arciin&apos;s{" "}
                <Link
                  href="/legal/terms"
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-[#ff4f12] underline underline-offset-4 hover:text-[#e04a12]"
                >
                  Terms of Use
                </Link>{" "}
                and{" "}
                <Link
                  href="/legal/privacy"
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-[#ff4f12] underline underline-offset-4 hover:text-[#e04a12]"
                >
                  Privacy Policy
                </Link>
                . I understand this software runs on infrastructure I control and that I am
                responsible for how it is operated and secured.
              </label>
            </div>
            <div className="mt-2 pl-7">
              <SetupFieldError
                message={form.formState.errors.acceptedTermsAndPrivacy?.message}
              />
            </div>
          </div>

          <div className="flex flex-col gap-3 border-t border-[#ececec] pt-5 sm:flex-row sm:items-center sm:justify-between">
            <AuthSecondaryButton type="button" onClick={() => setStep("details")}>
              <ArrowLeft className="size-4" />
              Back
            </AuthSecondaryButton>
            <AuthPrimaryButton
              type="submit"
              disabled={claimMutation.isPending || !acceptedTermsAndPrivacy}
              className="sm:w-auto sm:px-6"
            >
              <Sparkles className="size-4" />
              {claimMutation.isPending ? "Claiming instance..." : "Claim instance"}
            </AuthPrimaryButton>
          </div>
        </div>
      )}
    </form>
  )
}

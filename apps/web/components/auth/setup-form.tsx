"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { useForm, useWatch } from "react-hook-form"
import {
  ArrowLeft,
  ArrowRight,
  Check,
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
  setupInstanceSchema,
  setupLibraryOptions,
  setupOwnerSchema,
  setupSchema,
  setupStepFields,
  type SetupSchema,
  type SetupStep,
} from "@/lib/validation/setup"
import { Checkbox } from "@/components/ui/checkbox"

const libraryMeta = {
  Videos: { short: "Movies & clips", icon: Clapperboard },
  Images: { short: "Photos & art", icon: ImageIcon },
  Music: { short: "Audio & albums", icon: Music4 },
  Documents: { short: "PDFs & notes", icon: FileText },
  Inbox: { short: "Unclassified", icon: Inbox },
} satisfies Record<(typeof setupLibraryOptions)[number], { short: string; icon: LucideIcon }>

const lightCheckboxClass =
  "border-[#d4d4d4] bg-white data-[state=checked]:border-[#ff4f12] data-[state=checked]:bg-[#ff4f12] data-[state=checked]:text-white"

const STEPS: Record<SetupStep, { label: string; title: string; subtitle: string }> = {
  1: {
    label: "Server",
    title: "Server & storage",
    subtitle: "Token, instance name, and where files are stored.",
  },
  2: {
    label: "Owner",
    title: "Owner account",
    subtitle: "Admin name, email, and password for this server.",
  },
  3: {
    label: "Libraries",
    title: "Default libraries",
    subtitle: "What Arciin creates on claim — then accept terms.",
  },
}

function SetupFieldError({ message }: { message?: string }) {
  if (!message) return null
  return (
    <p className="px-0.5 text-[11px] font-medium text-[#dc2626]" role="alert">
      {message}
    </p>
  )
}

/**
 * Side-by-side steps: [1 Server] —— [2 Owner] —— [3 Libraries]
 * No duplicate “Step X of 3” / current-label row.
 */
function StepProgress({ step }: { step: SetupStep }) {
  return (
    <nav aria-label="Setup steps">
      <ol className="flex items-center">
        {([1, 2, 3] as const).map((n, index) => {
          const done = n < step
          const active = n === step
          return (
            <li key={n} className="flex min-w-0 flex-1 items-center">
              <div className="flex min-w-0 items-center gap-2">
                <span
                  className={cn(
                    "flex size-8 shrink-0 items-center justify-center rounded-full text-[12px] font-bold transition-colors",
                    done && "bg-[#ff4f12] text-white",
                    active && "bg-[#ff4f12] text-white ring-4 ring-[#ff4f12]/15",
                    !done && !active && "border border-[#e5e5e5] bg-white text-[#b0b0b0]",
                  )}
                >
                  {done ? <Check className="size-3.5" strokeWidth={3} /> : n}
                </span>
                <span
                  className={cn(
                    "truncate text-[12px] font-semibold",
                    active ? "text-[#111111]" : done ? "text-[#717171]" : "text-[#c0c0c0]",
                  )}
                >
                  {STEPS[n].label}
                </span>
              </div>
              {index < 2 ? (
                <span
                  aria-hidden
                  className={cn(
                    "mx-2 h-1 min-w-[12px] flex-1 rounded-full transition-colors",
                    n < step ? "bg-[#ff4f12]" : "bg-[#e8e8e8]",
                  )}
                />
              ) : null}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

export function SetupForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const claimMutation = useClaimInstance()
  const [step, setStep] = useState<SetupStep>(1)
  const [tokenFromUrl, setTokenFromUrl] = useState(false)
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

  const selectedLibraries =
    useWatch({ control: form.control, name: "libraries" }) ?? []
  const acceptedTermsAndPrivacy = useWatch({
    control: form.control,
    name: "acceptedTermsAndPrivacy",
  })
  const storageRoot = useWatch({ control: form.control, name: "storageRoot" })
  const setupTokenValue = useWatch({ control: form.control, name: "setupToken" })

  useEffect(() => {
    const fromUrl = searchParams.get("token")?.trim()
    if (fromUrl) {
      form.setValue("setupToken", fromUrl)
      setTokenFromUrl(true)
    }
  }, [form, searchParams])

  useEffect(() => {
    let cancelled = false
    void getInstanceStatus()
      .then((status) => {
        if (cancelled) return
        if (!status.suggestedStorageRoot) return
        const current = form.getValues("storageRoot")
        if (
          !current?.trim() ||
          current === ARCIIN_DEV_STORAGE_ROOT ||
          current === "./data/arciin"
        ) {
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
    fields?: readonly (keyof SetupSchema)[],
  ) => {
    const allowedFields = fields ? new Set<string>(fields) : null
    Object.entries(fieldErrors).forEach(([field, messages]) => {
      if (allowedFields && !allowedFields.has(field)) return
      const message = messages?.[0]
      if (message) {
        form.setError(field as keyof SetupSchema, { type: "manual", message })
      }
    })
  }

  const clearStepErrors = (target: SetupStep) => {
    setupStepFields[target].forEach((field) => form.clearErrors(field))
  }

  const goNextFromStep1 = () => {
    clearStepErrors(1)
    const values = form.getValues()
    const parsed = setupInstanceSchema.safeParse({
      setupToken: values.setupToken,
      instanceName: values.instanceName,
      storageRoot: values.storageRoot,
    })
    if (!parsed.success) {
      applyFieldErrors(parsed.error.flatten().fieldErrors, setupStepFields[1])
      return
    }
    setStep(2)
  }

  const goNextFromStep2 = () => {
    clearStepErrors(2)
    const values = form.getValues()
    const parsed = setupOwnerSchema.safeParse({
      adminName: values.adminName,
      adminEmail: values.adminEmail,
      adminPassword: values.adminPassword,
      confirmPassword: values.confirmPassword,
    })
    if (!parsed.success) {
      applyFieldErrors(parsed.error.flatten().fieldErrors, setupStepFields[2])
      return
    }
    setStep(3)
  }

  const submitClaim = form.handleSubmit(async (values) => {
    const parsed = setupSchema.safeParse(values)
    if (!parsed.success) {
      applyFieldErrors(parsed.error.flatten().fieldErrors)
      const flat = parsed.error.flatten().fieldErrors
      if (flat.setupToken || flat.instanceName || flat.storageRoot) setStep(1)
      else if (flat.adminName || flat.adminEmail || flat.adminPassword || flat.confirmPassword) {
        setStep(2)
      } else setStep(3)
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
      className="flex min-h-0 flex-1 flex-col"
      method="post"
      onSubmit={(event) => {
        if (step === 1) {
          event.preventDefault()
          goNextFromStep1()
          return
        }
        if (step === 2) {
          event.preventDefault()
          goNextFromStep2()
          return
        }
        void submitClaim(event)
      }}
    >
      <div className="shrink-0 space-y-3">
        <StepProgress step={step} />
        <div>
          <h1 className="font-heading text-[22px] font-bold tracking-tight text-[#111111] sm:text-[24px]">
            {STEPS[step].title}
          </h1>
          <p className="mt-1 text-[13px] leading-snug text-[#a0a0a0]">{STEPS[step].subtitle}</p>
        </div>
      </div>

      {/* Floating fields on the canvas — no nested card wrapper */}
      <div className="mt-4 flex min-h-0 flex-1 flex-col justify-start space-y-3 overflow-hidden">
        {step === 1 ? (
          <>
            {tokenFromUrl && setupTokenValue ? (
              <div className="flex items-center gap-2 rounded-2xl border border-[#ffd9c9] bg-[#fff8f4] px-3 py-2">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-white text-[#ff4f12]">
                  <KeyRound className="size-3.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] font-semibold text-[#111111]">Setup token ready</p>
                  <p className="truncate text-[10px] text-[#8a8a8a]">From install link</p>
                </div>
                <button
                  type="button"
                  className="shrink-0 text-[11px] font-medium text-[#ff4f12] underline-offset-2 hover:underline"
                  onClick={() => setTokenFromUrl(false)}
                >
                  Edit
                </button>
                <input type="hidden" {...form.register("setupToken")} />
              </div>
            ) : (
              <AuthLightField
                compact
                id="setupToken"
                label="Setup token"
                icon={KeyRound}
                type="password"
                autoComplete="off"
                placeholder="From install summary or .env"
                error={form.formState.errors.setupToken?.message}
                inputProps={form.register("setupToken")}
              />
            )}
            <AuthLightField
              compact
              id="instanceName"
              label="Instance name"
              icon={Server}
              placeholder="Local Instance"
              error={form.formState.errors.instanceName?.message}
              inputProps={form.register("instanceName")}
            />
            <div className="flex min-h-0 flex-col gap-1">
              <span className="text-[11px] font-semibold uppercase tracking-widest text-[#a0a0a0]">
                Storage location
              </span>
              <SetupStoragePicker
                value={storageRoot ?? ""}
                onChange={(path) => form.setValue("storageRoot", path, { shouldValidate: true })}
                hint={storageRootHint}
                errorMessage={form.formState.errors.storageRoot?.message}
                compact
              />
            </div>
          </>
        ) : null}

        {step === 2 ? (
          <>
            <AuthLightField
              compact
              id="adminName"
              label="Admin name"
              icon={User}
              autoComplete="name"
              placeholder="Your name"
              error={form.formState.errors.adminName?.message}
              inputProps={form.register("adminName")}
            />
            <AuthLightField
              compact
              id="adminEmail"
              label="Admin email"
              icon={Mail}
              type="email"
              autoComplete="email"
              placeholder="owner@example.com"
              error={form.formState.errors.adminEmail?.message}
              inputProps={form.register("adminEmail")}
            />
            <div className="grid gap-2.5 sm:grid-cols-2">
              <AuthLightField
                compact
                id="adminPassword"
                label="Password"
                icon={Lock}
                type="password"
                autoComplete="new-password"
                placeholder="Min. 8 characters"
                error={form.formState.errors.adminPassword?.message}
                inputProps={form.register("adminPassword")}
              />
              <AuthLightField
                compact
                id="confirmPassword"
                label="Confirm"
                icon={Lock}
                type="password"
                autoComplete="new-password"
                placeholder="Repeat password"
                error={form.formState.errors.confirmPassword?.message}
                inputProps={form.register("confirmPassword")}
              />
            </div>
            <p className="text-[11px] leading-snug text-[#a0a0a0]">
              First user becomes OWNER. Passwords stay hashed on this server.
            </p>
          </>
        ) : null}

        {step === 3 ? (
          <>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
              {setupLibraryOptions.map((library) => {
                const checked = selectedLibraries.includes(library)
                const Icon = libraryMeta[library].icon
                return (
                  <label
                    key={library}
                    className={cn(
                      "flex cursor-pointer flex-col gap-0.5 rounded-xl border p-2 transition-colors",
                      checked
                        ? "border-[#ffb59a] bg-[#fff5f0]"
                        : "border-[#ececec] bg-white hover:border-[#e0e0e0]",
                    )}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span
                        className={cn(
                          "flex size-6 items-center justify-center rounded-md border",
                          checked
                            ? "border-[#ffcab5] bg-white text-[#ff4f12]"
                            : "border-[#f0f0f0] bg-[#f7f7f7] text-[#a0a0a0]",
                        )}
                      >
                        <Icon className="size-3" />
                      </span>
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
                    <span className="truncate text-[12px] font-semibold text-[#222222]">
                      {library}
                    </span>
                    <span className="truncate text-[10px] text-[#8a8a8a]">
                      {libraryMeta[library].short}
                    </span>
                  </label>
                )
              })}
            </div>
            <SetupFieldError message={form.formState.errors.libraries?.message} />

            <div className="rounded-xl border border-[#ececec] bg-[#fafafa] p-2.5">
              <div className="flex gap-2">
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
                  className="cursor-pointer text-[11.5px] leading-snug text-[#717171]"
                >
                  I agree to Arciin&apos;s{" "}
                  <Link
                    href="/legal/terms"
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium text-[#ff4f12] underline underline-offset-2 hover:text-[#e04a12]"
                  >
                    Terms
                  </Link>{" "}
                  and{" "}
                  <Link
                    href="/legal/privacy"
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium text-[#ff4f12] underline underline-offset-2 hover:text-[#e04a12]"
                  >
                    Privacy Policy
                  </Link>
                  .
                </label>
              </div>
              <div className="mt-1 pl-7">
                <SetupFieldError
                  message={form.formState.errors.acceptedTermsAndPrivacy?.message}
                />
              </div>
            </div>
          </>
        ) : null}
      </div>

      {/* Bottom padding matches left hero outer inset (p-5) */}
      <div className="mt-auto flex shrink-0 items-center justify-between gap-3 border-t border-[#f0f0f0] pt-4 pb-5 lg:pb-5">
        {step > 1 ? (
          <AuthSecondaryButton
            type="button"
            onClick={() => setStep((step - 1) as SetupStep)}
            className="h-10 rounded-xl sm:w-auto"
          >
            <ArrowLeft className="size-4" />
            Back
          </AuthSecondaryButton>
        ) : (
          <span className="text-[11px] text-[#c0c0c0]">Locks after claim</span>
        )}

        {step < 3 ? (
          <AuthPrimaryButton
            type="submit"
            className="h-10 rounded-xl shadow-none sm:w-auto sm:min-w-[8.5rem] sm:px-5"
          >
            Continue
            <ArrowRight className="size-4" />
          </AuthPrimaryButton>
        ) : (
          <AuthPrimaryButton
            type="submit"
            disabled={claimMutation.isPending || !acceptedTermsAndPrivacy}
            className="h-10 rounded-xl shadow-none sm:w-auto sm:min-w-[8.5rem] sm:px-5"
          >
            <Sparkles className="size-4" />
            {claimMutation.isPending ? "Claiming…" : "Claim instance"}
          </AuthPrimaryButton>
        )}
      </div>
    </form>
  )
}

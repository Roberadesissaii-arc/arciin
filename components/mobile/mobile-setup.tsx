"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"
import {
  ArrowRight,
  CheckCircle2,
  Clapperboard,
  FileText,
  ImageIcon,
  Music4,
  Sparkles,
} from "lucide-react"
import { toast } from "sonner"
import { useForm } from "react-hook-form"

import { useClaimInstance } from "@/hooks/use-instance"
import {
  setupDetailsSchema,
  setupLibraryOptions,
  setupSchema,
  type SetupSchema,
} from "@/lib/validation/setup"
import { cn } from "@/lib/utils"

const INPUT_BASE =
  "w-full rounded-2xl border border-white/[0.1] bg-white/[0.05] px-4 py-4 text-[16px] text-white placeholder-zinc-600 outline-none transition-all duration-150 focus:border-[#ff4f12]/50 focus:bg-white/[0.07] focus:ring-2 focus:ring-[#ff4f12]/20"

const LIBRARY_ICONS: Record<string, React.ElementType> = {
  Videos: Clapperboard,
  Images: ImageIcon,
  Music: Music4,
  Documents: FileText,
  Inbox: FileText,
}

const LIBRARY_DESCRIPTIONS: Record<string, string> = {
  Videos: "Movies, screen recordings, and clips.",
  Images: "Photos, renders, screenshots, and artwork.",
  Music: "Audio files and playlists.",
  Documents: "PDFs, spreadsheets, and text files.",
  Inbox: "Unclassified uploads waiting for review.",
}

const STEPS = ["Welcome", "Account", "Libraries"] as const
type Step = 0 | 1 | 2

export function MobileSetup() {
  const router = useRouter()
  const claimMutation = useClaimInstance()
  const [step, setStep] = useState<Step>(0)
  const [selectedLibraries, setSelectedLibraries] = useState<string[]>([...setupLibraryOptions])

  const form = useForm<SetupSchema>({
    defaultValues: {
      setupToken: "",
      instanceName: "",
      storageRoot: "./data/arciin",
      adminName: "",
      adminEmail: "",
      adminPassword: "",
      confirmPassword: "",
      libraries: [...setupLibraryOptions],
      acceptedTermsAndPrivacy: true,
    },
  })

  function toggleLibrary(name: string) {
    setSelectedLibraries((prev) =>
      prev.includes(name) ? prev.filter((l) => l !== name) : [...prev, name],
    )
  }

  async function handleNext() {
    if (step === 0) {
      setStep(1)
      return
    }
    if (step === 1) {
      const result = setupDetailsSchema.safeParse(form.getValues())
      if (!result.success) {
        const fieldErrors = result.error.flatten().fieldErrors
        Object.entries(fieldErrors).forEach(([field, messages]) => {
          const message = messages?.[0]
          if (message) form.setError(field as keyof SetupSchema, { type: "manual", message })
        })
        return
      }
      setStep(2)
      return
    }
    // Step 2 — submit
    const values = { ...form.getValues(), libraries: selectedLibraries }
    const parsed = setupSchema.safeParse(values)
    if (!parsed.success) {
      toast.error("Please fix the errors and try again.")
      return
    }
    try {
      await claimMutation.mutateAsync(parsed.data)
      toast.success("Instance claimed. Welcome to Arciin.")
      router.push("/dashboard")
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Setup failed.")
    }
  }

  return (
    <div
      className="relative flex min-h-[100dvh] flex-col overflow-hidden bg-[#09090b]"
      style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {/* Glow */}
      <div
        className="pointer-events-none absolute inset-0 z-0"
        aria-hidden
        style={{
          background:
            "radial-gradient(ellipse 80% 50% at 50% -10%, rgba(255,75,51,0.25) 0%, transparent 60%)",
        }}
      />

      <div className="relative z-10 flex min-h-[100dvh] flex-col px-6">
        {/* Brand */}
        <div className="flex items-end pb-6 pt-14">
          <div>
            <p className="font-heading text-2xl font-semibold tracking-[-0.03em] text-white">
              Arciin
            </p>
            <p
              className="mt-1 text-[11px] font-medium uppercase tracking-[0.22em]"
              style={{ color: "rgba(255,255,255,0.35)" }}
            >
              First-run setup
            </p>
          </div>
        </div>

        {/* Step indicators */}
        <div className="mb-8 flex items-center gap-2">
          {STEPS.map((label, i) => (
            <div key={label} className="flex items-center gap-2">
              <div
                className={cn(
                  "flex size-6 items-center justify-center rounded-full text-[11px] font-bold transition-all",
                  i < step
                    ? "bg-[#ff4f12] text-white"
                    : i === step
                      ? "border border-[#ff4f12] text-[#ff4f12]"
                      : "border border-white/[0.15] text-zinc-600",
                )}
              >
                {i < step ? <CheckCircle2 className="size-3.5" /> : i + 1}
              </div>
              <span
                className={cn(
                  "text-[12px] font-medium",
                  i === step ? "text-white" : "text-zinc-600",
                )}
              >
                {label}
              </span>
              {i < STEPS.length - 1 && (
                <div
                  className={cn(
                    "h-px w-6 rounded-full transition-all",
                    i < step ? "bg-[#ff4f12]/60" : "bg-white/[0.1]",
                  )}
                />
              )}
            </div>
          ))}
        </div>

        {/* ── Step 0: Welcome ───────────────────────────────────────────────── */}
        {step === 0 && (
          <div className="flex flex-1 flex-col">
            <div className="mb-8">
              <div
                className="mb-4 flex size-12 items-center justify-center rounded-2xl"
                style={{ background: "rgba(255,79,18,0.15)", border: "1px solid rgba(255,79,18,0.25)" }}
              >
                <Sparkles className="size-5 text-[#ff4f12]" />
              </div>
              <h1 className="font-heading text-[26px] font-semibold tracking-tight text-white">
                Claim your instance
              </h1>
              <p
                className="mt-3 text-[14px] leading-relaxed"
                style={{ color: "rgba(255,255,255,0.4)" }}
              >
                This server has not been configured yet. You&apos;ll create the administrator
                account and set up your default libraries.
              </p>
            </div>

            <div
              className="mb-6 rounded-2xl p-4"
              style={{
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.08)",
              }}
            >
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="setup-token"
                  className="text-[13px] font-medium"
                  style={{ color: "rgba(255,255,255,0.55)" }}
                >
                  Setup token
                </label>
                <input
                  id="setup-token"
                  type="text"
                  autoComplete="off"
                  placeholder="From ARCIIN_SETUP_TOKEN in .env"
                  className={INPUT_BASE}
                  {...form.register("setupToken")}
                />
                {form.formState.errors.setupToken && (
                  <p className="text-[12px] text-red-400">
                    {form.formState.errors.setupToken.message}
                  </p>
                )}
                <p
                  className="text-[11px] leading-relaxed"
                  style={{ color: "rgba(255,255,255,0.25)" }}
                >
                  Found in your <span className="font-mono">.env</span> file after running{" "}
                  <span className="font-mono">./install.sh</span>
                </p>
              </div>
            </div>

            <div className="mt-auto pb-6">
              <button
                type="button"
                onClick={handleNext}
                className="flex w-full items-center justify-center gap-2 rounded-2xl py-4 text-[15px] font-semibold text-white transition-all active:scale-[0.98]"
                style={{
                  background: "linear-gradient(135deg, #ff4f12 0%, #ff6a33 100%)",
                  boxShadow: "0 0 32px rgba(255,75,51,0.3)",
                }}
              >
                Continue
                <ArrowRight className="size-4 shrink-0" />
              </button>
            </div>
          </div>
        )}

        {/* ── Step 1: Account ───────────────────────────────────────────────── */}
        {step === 1 && (
          <div className="flex flex-1 flex-col">
            <div className="mb-6">
              <h2 className="font-heading text-[22px] font-semibold text-white">Admin account</h2>
              <p
                className="mt-1.5 text-[13px] leading-relaxed"
                style={{ color: "rgba(255,255,255,0.4)" }}
              >
                This becomes the owner account with full access to this instance.
              </p>
            </div>

            <div className="flex flex-col gap-4 overflow-y-auto">
              {(
                [
                  { name: "instanceName",    label: "Instance name",    placeholder: "My Server",       inputType: "text"     },
                  { name: "adminName",       label: "Your name",        placeholder: "Alex",            inputType: "text"     },
                  { name: "adminEmail",      label: "Email",            placeholder: "you@example.com", inputType: "email"    },
                  { name: "adminPassword",   label: "Password",         placeholder: "••••••••",        inputType: "password" },
                  { name: "confirmPassword", label: "Confirm password", placeholder: "••••••••",        inputType: "password" },
                  { name: "storageRoot",     label: "Storage path",     placeholder: "./data/arciin",   inputType: "text"     },
                ] as Array<{ name: keyof SetupSchema; label: string; placeholder: string; inputType: string }>
              ).map(({ name, label, placeholder, inputType }) => (
                <div key={name} className="flex flex-col gap-1.5">
                  <label
                    className="text-[13px] font-medium"
                    style={{ color: "rgba(255,255,255,0.55)" }}
                  >
                    {label}
                  </label>
                  <input
                    type={inputType}
                    autoComplete={
                      inputType === "email" ? "email" : inputType === "password" ? "new-password" : "off"
                    }
                    placeholder={placeholder}
                    className={INPUT_BASE}
                    {...form.register(name)}
                  />
                  {form.formState.errors[name] && (
                    <p className="text-[12px] text-red-400">
                      {form.formState.errors[name]?.message}
                    </p>
                  )}
                </div>
              ))}
            </div>

            <div className="mt-auto pb-6 pt-6">
              <button
                type="button"
                onClick={handleNext}
                className="flex w-full items-center justify-center gap-2 rounded-2xl py-4 text-[15px] font-semibold text-white transition-all active:scale-[0.98]"
                style={{
                  background: "linear-gradient(135deg, #ff4f12 0%, #ff6a33 100%)",
                  boxShadow: "0 0 32px rgba(255,75,51,0.3)",
                }}
              >
                Continue
                <ArrowRight className="size-4 shrink-0" />
              </button>
            </div>
          </div>
        )}

        {/* ── Step 2: Libraries ─────────────────────────────────────────────── */}
        {step === 2 && (
          <div className="flex flex-1 flex-col">
            <div className="mb-6">
              <h2 className="font-heading text-[22px] font-semibold text-white">
                Default libraries
              </h2>
              <p
                className="mt-1.5 text-[13px] leading-relaxed"
                style={{ color: "rgba(255,255,255,0.4)" }}
              >
                Choose which libraries to create. Files you upload will route automatically.
              </p>
            </div>

            <div className="flex flex-col gap-3">
              {setupLibraryOptions.map((option) => {
                const Icon = LIBRARY_ICONS[option] ?? FileText
                const selected = selectedLibraries.includes(option)
                return (
                  <button
                    key={option}
                    type="button"
                    onClick={() => toggleLibrary(option)}
                    className="flex items-center gap-4 rounded-2xl p-4 text-left transition-all active:scale-[0.98]"
                    style={{
                      background: selected ? "rgba(255,79,18,0.1)" : "rgba(255,255,255,0.03)",
                      border: selected
                        ? "1px solid rgba(255,79,18,0.3)"
                        : "1px solid rgba(255,255,255,0.08)",
                    }}
                  >
                    <div
                      className="flex size-10 shrink-0 items-center justify-center rounded-xl"
                      style={{
                        background: selected
                          ? "rgba(255,79,18,0.2)"
                          : "rgba(255,255,255,0.06)",
                      }}
                    >
                      <Icon
                        className="size-5"
                        style={{ color: selected ? "#ff4f12" : "rgba(255,255,255,0.4)" }}
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p
                        className="text-[14px] font-semibold"
                        style={{ color: selected ? "#fff" : "rgba(255,255,255,0.6)" }}
                      >
                        {option}
                      </p>
                      <p
                        className="mt-0.5 text-[12px] leading-snug"
                        style={{ color: "rgba(255,255,255,0.3)" }}
                      >
                        {LIBRARY_DESCRIPTIONS[option] ?? ""}
                      </p>
                    </div>
                    <div
                      className="flex size-5 shrink-0 items-center justify-center rounded-md"
                      style={{
                        background: selected ? "#ff4f12" : "rgba(255,255,255,0.06)",
                        border: selected ? "none" : "1px solid rgba(255,255,255,0.12)",
                      }}
                    >
                      {selected && (
                        <svg
                          className="size-3 text-white"
                          viewBox="0 0 12 12"
                          fill="none"
                        >
                          <path
                            d="M2 6l3 3 5-5"
                            stroke="currentColor"
                            strokeWidth="1.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>

            <div className="mt-auto pb-6 pt-6">
              <button
                type="button"
                onClick={handleNext}
                disabled={claimMutation.isPending}
                className="flex w-full items-center justify-center gap-2 rounded-2xl py-4 text-[15px] font-semibold text-white transition-all active:scale-[0.98] disabled:opacity-60"
                style={{
                  background: claimMutation.isPending
                    ? "rgba(255,79,18,0.6)"
                    : "linear-gradient(135deg, #ff4f12 0%, #ff6a33 100%)",
                  boxShadow: "0 0 32px rgba(255,75,51,0.3)",
                }}
              >
                {claimMutation.isPending ? "Setting up…" : "Claim instance"}
                {!claimMutation.isPending && <Sparkles className="size-4 shrink-0" />}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

import Link from "next/link"
import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

/**
 * Light auth design kit for desktop `/login`, `/forgot-password`, and `/setup`.
 * Mirrors the Arciin mobile app auth screens: #f7f7f7 canvas, white rounded cards,
 * orange gradient hero, and quiet gray field chrome.
 */

export const AUTH_HERO_GRADIENT = "linear-gradient(155deg, #ff6a30 0%, #c82d00 100%)"

export function AuthLightWordmark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "font-heading shrink-0 text-[34px] font-black leading-none tracking-tight text-white",
        className,
      )}
    >
      Arciin<span className="text-white/35">.</span>
    </span>
  )
}

export function AuthPlatformBadge({
  children = "Web",
  className,
}: {
  children?: ReactNode
  className?: string
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-white/25 bg-white/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/90",
        className,
      )}
    >
      {children}
    </span>
  )
}

/** Orange gradient hero panel — left column on desktop auth screens. */
export function AuthHeroPanel({
  children,
  className,
  fill = false,
}: {
  children: ReactNode
  className?: string
  /** Let children use the full panel height instead of bottom-anchoring them. */
  fill?: boolean
}) {
  return (
    <div
      className={cn("relative flex-1 overflow-hidden rounded-[28px]", className)}
      style={{ background: AUTH_HERO_GRADIENT }}
    >
      <div
        className="pointer-events-none absolute -top-24 right-[-10%] h-[360px] w-[360px] rounded-full bg-white/10 blur-[90px]"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute bottom-[-20%] left-[-8%] h-[320px] w-[320px] rounded-full bg-black/15 blur-[80px]"
        aria-hidden
      />
      <div className="relative z-10 flex h-full flex-col p-8">
        <div className="flex items-start justify-between gap-3">
          <AuthLightWordmark />
          <AuthPlatformBadge className="mt-1 shrink-0" />
        </div>
        <div className={fill ? "flex min-h-0 flex-1 flex-col" : "mt-auto"}>{children}</div>
      </div>
    </div>
  )
}

/** Card header — bold dark title with quiet subtitle, same as mobile. */
export function AuthLightCardHeader({
  title,
  subtitle,
}: {
  title: string
  subtitle: ReactNode
}) {
  return (
    <div>
      <h1 className="font-heading text-[22px] font-bold tracking-tight text-[#111111]">
        {title}
      </h1>
      <p className="mt-1 text-[13px] leading-relaxed text-[#a0a0a0]">{subtitle}</p>
    </div>
  )
}

/** White rounded card that hosts a form. */
export function AuthLightCard({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "rounded-3xl border border-[#efefef] bg-white px-6 py-6 shadow-[0_1px_2px_rgba(0,0,0,0.03)] sm:px-8 sm:py-8",
        className,
      )}
    >
      {children}
    </div>
  )
}

/** Labeled input row with a leading icon — mirror of the mobile AuthMobileField. */
export function AuthLightField({
  id,
  label,
  icon: Icon,
  type = "text",
  placeholder,
  value,
  onChange,
  right,
  autoComplete,
  error,
  description,
  mono,
  inputProps,
}: {
  id: string
  label: string
  icon?: React.ElementType
  type?: string
  placeholder?: string
  value?: string
  onChange?: (v: string) => void
  right?: ReactNode
  autoComplete?: string
  error?: string | null
  description?: ReactNode
  mono?: boolean
  /** Escape hatch for react-hook-form `register()` spreads (uncontrolled usage). */
  inputProps?: React.InputHTMLAttributes<HTMLInputElement>
}) {
  const invalid = Boolean(error)

  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={id}
        className="text-[11px] font-semibold uppercase tracking-widest text-[#a0a0a0]"
      >
        {label}
      </label>
      <div
        className={cn(
          "flex items-center gap-3 rounded-2xl border px-4 py-3 transition-colors focus-within:border-[#ff4f12]/60",
          invalid ? "border-[#fca5a5] bg-[#fffafa]" : "border-[#e8e8e8] bg-[#f7f7f7]",
        )}
      >
        {Icon ? (
          <Icon
            className={cn("size-4 shrink-0", invalid ? "text-[#f87171]" : "text-[#c0c0c0]")}
            aria-hidden
          />
        ) : null}
        <input
          id={id}
          name={id}
          type={type}
          placeholder={placeholder}
          {...(onChange
            ? { value: value ?? "", onChange: (e) => onChange(e.target.value) }
            : {})}
          autoComplete={autoComplete}
          aria-invalid={invalid}
          aria-describedby={invalid ? `${id}-error` : undefined}
          className={cn(
            "min-w-0 flex-1 bg-transparent text-[#222222] outline-none placeholder:text-[#c0c0c0]",
            mono ? "font-mono text-[13px]" : "text-[14px]",
          )}
          {...inputProps}
        />
        {right}
      </div>
      {description ? (
        <p className="px-1 text-[11px] leading-relaxed text-[#a0a0a0]">{description}</p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className="px-1 text-[11px] font-medium text-[#dc2626]" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}

/** Compact form-level message. */
export function AuthLightFormMessage({
  message,
  tone = "error",
}: {
  message?: string | null
  tone?: "error" | "info" | "success"
}) {
  if (!message) return null

  return (
    <p
      className={cn(
        "rounded-xl border px-3.5 py-2.5 text-[12.5px] leading-relaxed",
        tone === "error" && "border-[#fecaca] bg-[#fef2f2] text-[#b91c1c]",
        tone === "info" && "border-[#fde5b8] bg-[#fffaf0] text-[#92600a]",
        tone === "success" && "border-[#bbf7d0] bg-[#f0fdf4] text-[#15803d]",
      )}
      role={tone === "error" ? "alert" : "status"}
    >
      {message}
    </p>
  )
}

/** Orange gradient primary button — same treatment as the mobile `auth-primary-button`. */
export function AuthPrimaryButton({
  children,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={cn(
        "flex h-12 w-full items-center justify-center gap-2 rounded-2xl border-none text-[15px] font-semibold text-white shadow-[0_4px_18px_rgba(255,79,18,0.3)] transition-opacity hover:opacity-95 disabled:opacity-60",
        className,
      )}
      style={{ background: "linear-gradient(135deg, #ff6a30 0%, #cc2e00 100%)" }}
    >
      {children}
    </button>
  )
}

/** Quiet secondary button (light outline). */
export function AuthSecondaryButton({
  children,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={cn(
        "flex h-12 items-center justify-center gap-2 rounded-2xl border border-[#e5e5e5] bg-white px-5 text-[14px] font-semibold text-[#444444] transition-colors hover:bg-[#fafafa] disabled:opacity-60",
        className,
      )}
    >
      {children}
    </button>
  )
}

/** Privacy / Terms footer links for light pages. */
export function AuthLightLegalFooter({ className }: { className?: string }) {
  return (
    <footer
      className={cn(
        "relative z-10 flex shrink-0 justify-end gap-6 border-t border-[#ececec] px-6 py-4 sm:px-10 lg:px-16",
        className,
      )}
    >
      <Link
        href="/legal/privacy"
        className="text-[11px] text-[#a0a0a0] underline-offset-4 transition-colors hover:text-[#555555] hover:underline"
      >
        Privacy
      </Link>
      <Link
        href="/legal/terms"
        className="text-[11px] text-[#a0a0a0] underline-offset-4 transition-colors hover:text-[#555555] hover:underline"
      >
        Terms
      </Link>
    </footer>
  )
}

/** Small dark wordmark + context label for the top of the right column / mobile widths. */
export function AuthLightPageHeader({ contextLabel }: { contextLabel: string }) {
  return (
    <div>
      <p className="font-heading text-sm font-bold tracking-tight text-[#111111]">
        Arciin<span className="text-[#ff4f12]">.</span>
      </p>
      <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#a0a0a0]">
        {contextLabel}
      </p>
    </div>
  )
}

/**
 * Same atmosphere + panel shell as `/login` and `/setup` (hero card on the left).
 * Keeps instance auth screens visually one family.
 */
import type { ReactNode } from "react"

export function InstanceAuthAtmosphere() {
  return (
    <>
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_90%_75%_at_100%_0%,rgba(255,75,51,0.22),transparent_55%),radial-gradient(ellipse_60%_50%_at_96%_6%,rgba(255,120,90,0.1),transparent_48%)]"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-0 bg-[linear-gradient(145deg,rgba(255,75,51,0.07)_0%,transparent_42%)]"
        aria-hidden
      />
    </>
  )
}

export function InstanceAuthPanel({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div
      className={`relative overflow-hidden rounded-[28px] border border-white/[0.07] bg-background shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] ${className ?? ""}`}
    >
      <div
        className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(255,75,51,0.12)_0%,rgba(9,9,11,0.06)_28%,rgba(9,9,11,0.35)_55%,transparent_100%)]"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute -top-32 left-1/2 aspect-[1.35] w-[min(92%,520px)] -translate-x-1/2 bg-[radial-gradient(ellipse_at_50%_35%,rgba(255,75,51,0.45)_0%,rgba(255,75,51,0.12)_42%,transparent_72%)] blur-[68px]"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute -top-20 left-[18%] h-[280px] w-[min(55%,340px)] bg-[radial-gradient(ellipse_at_center,rgba(255,120,90,0.22)_0%,transparent_68%)] blur-[56px]"
        aria-hidden
      />
      {children}
    </div>
  )
}

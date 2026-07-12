import { cn } from "@/lib/utils"

/** Shared app canvas: flat deep base (no colored glow). */
export function AppAmbientBackground({ className }: { className?: string }) {
  return (
    <div className={cn("pointer-events-none", className)} aria-hidden>
      <div className="absolute inset-0 bg-[#09090b]" />
    </div>
  )
}

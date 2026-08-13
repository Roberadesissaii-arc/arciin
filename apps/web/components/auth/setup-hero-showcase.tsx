import { DashboardPreview } from "@/components/auth/login-hero-showcase"

/**
 * Orange setup hero — same dashboard preview treatment as login, with
 * first-run copy anchored at the bottom of the panel.
 */
export function SetupHeroShowcase() {
  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden px-9 pb-10 pt-9">
      <div
        aria-hidden
        className="absolute left-9 top-6 z-0 w-[118%] origin-top-left scale-[0.84] opacity-85"
        style={{
          maskImage:
            "linear-gradient(to bottom, black 52%, black 72%, rgba(0,0,0,0.65) 86%, transparent 100%)",
          WebkitMaskImage:
            "linear-gradient(to bottom, black 52%, black 72%, rgba(0,0,0,0.65) 86%, transparent 100%)",
        }}
      >
        <DashboardPreview />
      </div>

      <div className="relative z-10 mt-auto max-w-lg space-y-4">
        <span className="inline-flex items-center rounded-full border border-white/25 bg-white/10 px-3 py-1 text-[11px] font-semibold text-white/90">
          First-run setup
        </span>
        <h2 className="font-heading text-[2.2rem] font-bold leading-[1.14] tracking-tight text-white xl:text-[2.55rem]">
          Claim your instance.
          <span className="block text-white/55">Keep it on your server.</span>
        </h2>
        <p className="max-w-[24rem] text-[14px] leading-7 text-white/80">
          Create the owner account, pick where files live, and enable default libraries.
          Setup locks after the first successful claim.
        </p>
      </div>
    </div>
  )
}

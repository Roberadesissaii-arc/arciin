import { DashboardPreview } from "@/components/auth/login-hero-showcase"

/**
 * Same orange-panel “dashboard preview” treatment as {@link LoginHeroShowcase},
 * with first-run copy instead of the sign-in headline.
 * Layout, scale, and fade mask match the login hero so the panels feel identical.
 */
export function SetupHeroShowcase() {
  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden px-9 pb-10 pt-9">
      {/* Identical dashboard preview block as login (image inside the orange container) */}
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

      <div className="relative z-10 mt-auto max-w-lg space-y-5">
        <h2 className="font-heading text-[2.4rem] font-bold leading-[1.14] tracking-tight text-white xl:text-[2.7rem]">
          Claim your instance.
          <span className="block">Your server.</span>
          <span className="block text-white/55">Your control.</span>
        </h2>
        <p className="max-w-[24rem] text-[14.5px] leading-7 text-white/80">
          Three quick steps: storage, owner account, and libraries. Setup locks after the first
          successful claim — then you only sign in.
        </p>
      </div>
    </div>
  )
}

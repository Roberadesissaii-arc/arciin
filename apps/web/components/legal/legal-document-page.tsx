import Link from "next/link"

import { type LegalSection } from "@/lib/legal/content"

export function LegalDocumentPage({
  title,
  sections,
  backHref = "/setup",
  backLabel = "Back to setup",
}: {
  title: string
  sections: LegalSection[]
  backHref?: string
  backLabel?: string
}) {
  return (
    <main className="relative flex min-h-svh flex-col bg-background">
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_90%_75%_at_100%_0%,rgba(255,75,51,0.18),transparent_55%)]"
        aria-hidden
      />

      <header className="relative z-10 border-b border-white/[0.06] px-6 py-4 sm:px-10">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4">
          <div>
            <p className="font-heading text-sm font-semibold tracking-tight text-white">Arciin</p>
            <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-zinc-500">{title}</p>
          </div>
          <Link
            href={backHref}
            className="text-[12px] text-zinc-400 underline-offset-4 transition-colors hover:text-zinc-200 hover:underline"
          >
            {backLabel}
          </Link>
        </div>
      </header>

      <div className="relative z-10 flex-1 overflow-y-auto px-6 py-8 sm:px-10">
        <article className="mx-auto max-w-3xl space-y-8">
          {sections.map((section) => (
            <section key={section.title} className="space-y-3">
              <h2 className="text-lg font-semibold tracking-tight text-white">{section.title}</h2>
              <div className="space-y-3 text-sm leading-relaxed text-zinc-400">
                {section.paragraphs.map((paragraph) => (
                  <p key={paragraph}>{paragraph}</p>
                ))}
              </div>
            </section>
          ))}
        </article>
      </div>

      <footer className="relative z-10 flex shrink-0 justify-end gap-6 border-t border-white/[0.06] px-6 py-4 sm:px-10">
        <Link
          href="/legal/privacy"
          className="text-[11px] text-zinc-500 underline-offset-4 transition-colors hover:text-zinc-300 hover:underline"
        >
          Privacy
        </Link>
        <Link
          href="/legal/terms"
          className="text-[11px] text-zinc-500 underline-offset-4 transition-colors hover:text-zinc-300 hover:underline"
        >
          Terms
        </Link>
      </footer>
    </main>
  )
}

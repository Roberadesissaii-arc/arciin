import type { Metadata } from "next"
import Link from "next/link"

export const metadata: Metadata = {
  title: "Terms of Use — Arciin",
  description: "Terms for using the Arciin self-hosted application.",
}

export default function TermsPage() {
  return (
    <main className="min-h-svh bg-background px-6 py-12 text-zinc-400 sm:px-10 sm:py-16">
      <article className="mx-auto max-w-3xl">
        <nav className="mb-10 flex flex-wrap gap-x-4 gap-y-2 text-xs text-zinc-500">
          <Link href="/setup" className="hover:text-zinc-300 hover:underline">
            Back to setup
          </Link>
          <span aria-hidden className="text-zinc-700">
            |
          </span>
          <Link href="/legal/privacy" className="hover:text-zinc-300 hover:underline">
            Privacy Policy
          </Link>
        </nav>

        <header className="border-b border-white/10 pb-8">
          <h1 className="font-heading text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            Terms of Use
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed">
            These Terms of Use govern your access to and use of the Arciin software on an instance
            you deploy or are invited to use. By creating an account, completing first-run setup,
            or otherwise using Arciin, you agree to these terms for that instance, together with any
            additional terms the operator publishes.
          </p>
          <p className="mt-4 text-xs leading-relaxed text-zinc-500">
            This document is a baseline for self-hosted deployments. It is not legal advice.
            Operators should adapt it for their organization, industry, and jurisdiction.
          </p>
        </header>

        <div className="space-y-10 py-10 text-sm leading-relaxed">
          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-white">1. The service</h2>
            <p>
              Arciin provides tools to organize files and media, manage libraries and folders, run
              uploads and background jobs, and administer a private instance. Features may evolve
              between versions. The operator chooses what is exposed on the network and which
              integrations are enabled.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-white">2. Eligibility and accounts</h2>
            <p>
              First-run setup creates an owner account and locks public self-registration unless the
              operator adds additional access controls later. You must provide accurate information
              where required and keep credentials confidential. You are responsible for activity
              under your account except where Arciin or the operator can demonstrate a compromise
              outside your control.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-white">3. Acceptable use</h2>
            <p>You agree not to misuse Arciin. Without limitation, you must not:</p>
            <ul className="list-disc space-y-2 pl-5">
              <li>Violate applicable law or third-party rights.</li>
              <li>
                Attempt unauthorized access to the instance, other users&apos; data, or connected
                systems (including probing, exploitation, or credential stuffing).
              </li>
              <li>
                Use the instance to distribute malware, conduct fraud, harass others, or store
                unlawful content, as determined by the operator and applicable law.
              </li>
              <li>
                Interfere with stability or integrity (for example by abusing APIs, bypassing quotas
                the operator sets, or disrupting workers except as permitted for testing in
                non-production environments).
              </li>
            </ul>
            <p className="pt-2">
              The operator may suspend or remove access for policy or security reasons.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-white">4. Your content</h2>
            <p>
              You retain rights to files and metadata you upload, subject to licenses you grant
              others outside this software. To operate the product, Arciin stores and processes
              your content on the operator&apos;s infrastructure as configured. You represent that
              you have the rights needed for that processing.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-white">5. Operator responsibilities</h2>
            <p>
              If you are the operator, you are responsible for securing the host, database, Redis,
              backups, TLS, access control, and compliance with laws that apply to your users and
              data. You are responsible for publishing a Privacy Policy and any notices required in
              your region.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-white">6. Software updates and changes</h2>
            <p>
              Upgrades may change behavior, defaults, or dependencies. Review release notes before
              upgrading production systems. Continued use after an upgrade constitutes acceptance
              of the updated software behavior; material policy changes should be communicated by
              the operator to end users where required.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-white">7. Disclaimers</h2>
            <p>
              To the maximum extent permitted by law, Arciin is provided &quot;as is&quot; without
              warranties of merchantability, fitness for a particular purpose, or non-infringement.
              The operator and upstream contributors do not warrant uninterrupted or error-free
              operation or that defects will be corrected. You assume risk for data loss; maintain
              backups and test recovery procedures.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-white">8. Limitation of liability</h2>
            <p>
              To the maximum extent permitted by law, neither the operator nor licensors or
              contributors of Arciin are liable for indirect, incidental, special, consequential,
              or punitive damages, or for loss of profits, data, or goodwill, arising out of or
              related to your use of the software, except where liability cannot be excluded by law.
              Aggregate liability for direct damages may be limited to fees you paid for the
              software in the twelve months preceding the claim, if any; many self-hosted deployments
              involve no fee.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-white">9. Indemnity</h2>
            <p>
              To the extent permitted by law, you agree to indemnify and hold harmless the operator
              (and, if applicable, licensors) from claims arising out of your content, your misuse
              of Arciin, or your violation of these terms or applicable law.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-white">10. Termination</h2>
            <p>
              The operator may revoke access to the instance. After termination, data retention and
              deletion follow operator practices and technical capabilities (for example database
              and filesystem cleanup).
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-white">11. Governing law</h2>
            <p>
              The operator may specify governing law and venue for disputes involving that instance.
              If none is specified, disputes are handled according to the laws and courts applicable
              to the operator&apos;s jurisdiction, unless mandatory consumer protections say
              otherwise.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-white">12. Privacy</h2>
            <p>
              Processing of personal data is described in the{" "}
              <Link href="/legal/privacy" className="text-zinc-200 underline underline-offset-4 hover:text-white">
                Privacy Policy
              </Link>
              . If there is a conflict between documents for a given deployment, the operator&apos;s
              published terms take precedence for that instance.
            </p>
          </section>
        </div>

        <footer className="border-t border-white/10 pt-8 text-xs text-zinc-500">
          <p>Effective as of the date shown in your deployment documentation unless you replace this page.</p>
        </footer>
      </article>
    </main>
  )
}

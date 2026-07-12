import { LegalDocumentPage } from "@/components/legal/legal-document-page"
import { privacyPolicySections } from "@/lib/legal/content"

export default function PrivacyPage() {
  return (
    <LegalDocumentPage
      title="Privacy Policy"
      sections={privacyPolicySections}
      backHref="/login"
      backLabel="Back to sign in"
    />
  )
}

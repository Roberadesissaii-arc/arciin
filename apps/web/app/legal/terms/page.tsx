import { LegalDocumentPage } from "@/components/legal/legal-document-page"
import { termsOfUseSections } from "@/lib/legal/content"

export default function TermsPage() {
  return (
    <LegalDocumentPage title="Terms of Use" sections={termsOfUseSections} backHref="/login" backLabel="Back to sign in" />
  )
}

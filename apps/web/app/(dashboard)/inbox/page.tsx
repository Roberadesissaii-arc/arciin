import { InboxPageIntro } from "@/components/libraries/inbox-page-intro"
import { LibraryBrowser } from "@/components/libraries/library-browser"

export default function InboxPage() {
  return (
    <LibraryBrowser
      title="Inbox"
      description="Code, archives, installers, and anything that has no dedicated library. Documents is for PDFs and Office files — not scripts."
      librarySlug="inbox"
      intro={<InboxPageIntro />}
    />
  )
}

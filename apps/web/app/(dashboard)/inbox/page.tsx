import { InboxPageIntro } from "@/components/libraries/inbox-page-intro"
import { LibraryBrowser } from "@/components/libraries/library-browser"

export default function InboxPage() {
  return (
    <LibraryBrowser
      title="Inbox"
      description="Unclassified files land here automatically. Review, move, or organise them into the right library."
      librarySlug="inbox"
      intro={<InboxPageIntro />}
    />
  )
}

const ADJ = [
  "Project",
  "Archive",
  "Media",
  "Personal",
  "Shared",
  "Draft",
  "Collection",
  "Backup",
  "Season",
  "Studio",
  "Travel",
  "Work",
]

const NOUN = [
  "2025",
  "Uploads",
  "Imports",
  "Clips",
  "Files",
  "Library",
  "Vault",
  "Inbox",
  "Pack",
  "Shelf",
]

/** Suggest a readable default folder name (user can edit or regenerate). */
export function generateFolderName() {
  const adj = ADJ[Math.floor(Math.random() * ADJ.length)]
  const noun = NOUN[Math.floor(Math.random() * NOUN.length)]
  return `${adj} ${noun}`
}

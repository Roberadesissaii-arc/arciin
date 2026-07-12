export function getFileExtension(filename: string) {
  const parts = filename.split(".")
  return parts.length > 1 ? parts.at(-1)?.toLowerCase() ?? "" : ""
}

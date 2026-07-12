/** Windows-style duplicate name: `file (1).ext`, `file (2).ext`, … */
export function nextAvailableFilename(baseName: string, taken: Set<string>): string {
  if (!taken.has(baseName)) {
    taken.add(baseName)
    return baseName
  }

  const dot = baseName.lastIndexOf(".")
  const stem = dot === -1 ? baseName : baseName.slice(0, dot)
  const ext = dot === -1 ? "" : baseName.slice(dot)

  for (let n = 1; n < 10_000; n++) {
    const candidate = `${stem} (${n})${ext}`
    if (!taken.has(candidate)) {
      taken.add(candidate)
      return candidate
    }
  }

  const fallback = `${stem} (${Date.now()})${ext}`
  taken.add(fallback)
  return fallback
}

export function renameFile(file: File, newName: string): File {
  return new File([file], newName, { type: file.type, lastModified: file.lastModified })
}

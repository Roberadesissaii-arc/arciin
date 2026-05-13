const formatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 1,
})

export function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return "0 B"
  }

  const units = ["B", "KB", "MB", "GB", "TB"]
  const exponent = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1)
  const size = value / 1024 ** exponent

  return `${formatter.format(size)} ${units[exponent]}`
}

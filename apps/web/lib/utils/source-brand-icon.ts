/** Known source keys with SVG logos under /assets/icons/sources/ or /assets/icons/apps/. */
const SOURCE_ICON_FILES: Record<string, { file: string; dir?: "sources" | "apps" }> = {
  youtube: { file: "youtube.svg", dir: "sources" },
  tiktok: { file: "tiktok.svg", dir: "sources" },
  linkedin: { file: "linkedin.svg", dir: "sources" },
  pinterest: { file: "pinterest.svg", dir: "sources" },
  amazon: { file: "amazon.svg", dir: "sources" },
  walmart: { file: "walmart.svg", dir: "sources" },
  pexels: { file: "pexels.svg", dir: "sources" },
  facebook: { file: "facebook.svg", dir: "sources" },
  instagram: { file: "instagram.svg", dir: "apps" },
  spotify: { file: "spotify.svg", dir: "apps" },
  github: { file: "github.svg", dir: "apps" },
}

/** Logos with white fills need a dark tile so they stay visible in the UI. */
const DARK_ICON_TILE_SOURCES = new Set(["tiktok", "x", "github", "spotify"])

/** Full-color logos that should sit on a white tile (not the default dark badge). */
const LIGHT_TILE_SOURCES = new Set(["instagram", "youtube", "pinterest", "facebook", "linkedin"])

/** Public URL for a source brand icon, or null when only initials are available. */
export function sourceBrandIconSrc(sourceKey: string): string | null {
  const entry = SOURCE_ICON_FILES[sourceKey]
  if (!entry) return null
  const dir = entry.dir ?? "sources"
  return `/assets/icons/${dir}/${entry.file}`
}

export function sourceBrandHasIcon(sourceKey: string): boolean {
  return sourceKey in SOURCE_ICON_FILES
}

/** Background for the icon tile when an SVG logo is shown. */
export function sourceBrandIconTileBg(sourceKey: string): string {
  if (DARK_ICON_TILE_SOURCES.has(sourceKey)) return "#000000"
  if (LIGHT_TILE_SOURCES.has(sourceKey)) return "#ffffff"
  return "#ffffff"
}

/** Short brand mark fallback when no SVG logo exists. */
export function brandMarkForSource(key: string): string {
  const marks: Record<string, string> = {
    youtube: "YT",
    vimeo: "VM",
    tiktok: "TT",
    instagram: "IG",
    pinterest: "PI",
    linkedin: "IN",
    facebook: "FB",
    x: "X",
    amazon: "A",
    walmart: "W",
    target: "T",
    etsy: "E",
    ebay: "EB",
    spotify: "SP",
    audible: "AU",
    soundcloud: "SC",
    github: "GH",
    reddit: "R",
    twitch: "TW",
    unsplash: "U",
    pexels: "PX",
    imgur: "IM",
    flickr: "FL",
    giphy: "GF",
    dailymotion: "DM",
    aliexpress: "AE",
    dribbble: "DR",
    behance: "BE",
    tumblr: "TB",
  }
  return marks[key] ?? key.slice(0, 2).toUpperCase()
}

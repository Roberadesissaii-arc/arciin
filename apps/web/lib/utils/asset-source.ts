export type AssetSourceInfo = {
  /** Stable platform key ('youtube', 'amazon', … or 'web' for anything else). */
  key: string
  /** Human label shown on the badge ('YouTube', 'Amazon', or the bare domain). */
  label: string
  /** Brand color (hex) used as the badge background. */
  color: string
  /** The original link this asset was imported from. */
  href: string
}

type BrandRule = {
  key: string
  label: string
  color: string
  /**
   * Registrable domains AND content-delivery domains for the brand. A host matches
   * when it equals a domain or ends with "." + domain, so both the site
   * (www.amazon.com) and its CDN (m.media-amazon.com) resolve to the same brand.
   */
  domains: string[]
  /** Extra matcher for brands with many country TLDs (amazon.co.uk, pinterest.de, …). */
  test?: RegExp
}

const BRANDS: BrandRule[] = [
  {
    key: "youtube",
    label: "YouTube",
    color: "#FF0000",
    domains: ["youtube.com", "youtu.be", "youtube-nocookie.com", "ytimg.com"],
  },
  {
    key: "linkedin",
    label: "LinkedIn",
    color: "#0A66C2",
    domains: ["linkedin.com", "lnkd.in", "licdn.com"],
  },
  {
    key: "pinterest",
    label: "Pinterest",
    color: "#E60023",
    domains: ["pinterest.com", "pin.it", "pinimg.com"],
    test: /(^|\.)pinterest\.[a-z]/,
  },
  {
    key: "instagram",
    label: "Instagram",
    color: "#E4405F",
    domains: ["instagram.com", "instagr.am", "cdninstagram.com"],
  },
  {
    key: "tiktok",
    label: "TikTok",
    color: "#010101",
    domains: ["tiktok.com", "tiktokcdn.com", "tiktokcdn-us.com"],
  },
  {
    key: "x",
    label: "X",
    color: "#000000",
    domains: ["x.com", "twitter.com", "t.co", "twimg.com"],
  },
  {
    key: "vimeo",
    label: "Vimeo",
    color: "#1AB7EA",
    domains: ["vimeo.com", "vimeocdn.com"],
  },
  {
    key: "facebook",
    label: "Facebook",
    color: "#1877F2",
    domains: ["facebook.com", "m.facebook.com", "fb.watch", "fb.com", "fbcdn.net"],
  },
  {
    key: "amazon",
    label: "Amazon",
    color: "#FF9900",
    domains: [
      "media-amazon.com",
      "ssl-images-amazon.com",
      "images-amazon.com",
      "amzn.to",
      "amzn.com",
      "a.co",
    ],
    // amazon.com, amazon.co.uk, amazon.de, amazon.com.br, …
    test: /(^|\.)amazon\.[a-z]{2,}(\.[a-z]{2,})?$/,
  },
  {
    key: "walmart",
    label: "Walmart",
    color: "#0071DC",
    domains: ["walmart.com", "walmart.ca", "walmartimages.com"],
  },
  {
    key: "target",
    label: "Target",
    color: "#CC0000",
    domains: ["target.com", "target.scene7.com", "targetimg1.com"],
  },
  {
    key: "etsy",
    label: "Etsy",
    color: "#F1641E",
    domains: ["etsy.com", "etsystatic.com"],
  },
  {
    key: "ebay",
    label: "eBay",
    color: "#E53238",
    domains: ["ebay.com", "ebayimg.com", "ebaystatic.com"],
    test: /(^|\.)ebay\.[a-z]/,
  },
  {
    key: "aliexpress",
    label: "AliExpress",
    color: "#FF4747",
    domains: ["aliexpress.com", "alicdn.com"],
  },
  {
    key: "pexels",
    label: "Pexels",
    color: "#05A081",
    domains: ["pexels.com"],
  },
  {
    key: "unsplash",
    label: "Unsplash",
    color: "#111111",
    domains: ["unsplash.com"],
  },
  {
    key: "imgur",
    label: "Imgur",
    color: "#1BB76E",
    domains: ["imgur.com", "imgur.io"],
  },
  {
    key: "flickr",
    label: "Flickr",
    color: "#0063DC",
    domains: ["flickr.com", "staticflickr.com", "flic.kr"],
  },
  {
    key: "giphy",
    label: "Giphy",
    color: "#000000",
    domains: ["giphy.com"],
  },
  {
    key: "reddit",
    label: "Reddit",
    color: "#FF4500",
    domains: ["reddit.com", "redd.it", "redditmedia.com", "redditstatic.com"],
  },
  {
    key: "twitch",
    label: "Twitch",
    color: "#9146FF",
    domains: ["twitch.tv", "ttvnw.net"],
  },
  {
    key: "github",
    label: "GitHub",
    color: "#181717",
    domains: ["github.com", "github.io", "githubusercontent.com", "githubassets.com"],
  },
  {
    key: "dribbble",
    label: "Dribbble",
    color: "#EA4C89",
    domains: ["dribbble.com"],
  },
  {
    key: "behance",
    label: "Behance",
    color: "#1769FF",
    domains: ["behance.net"],
  },
  {
    key: "soundcloud",
    label: "SoundCloud",
    color: "#FF5500",
    domains: ["soundcloud.com", "sndcdn.com"],
  },
  {
    key: "spotify",
    label: "Spotify",
    color: "#1DB954",
    domains: ["spotify.com", "scdn.co", "spotifycdn.com"],
  },
  {
    key: "dailymotion",
    label: "Dailymotion",
    color: "#0066DC",
    domains: ["dailymotion.com", "dai.ly", "dmcdn.net"],
  },
  {
    key: "tumblr",
    label: "Tumblr",
    color: "#36465D",
    domains: ["tumblr.com", "tumblr.co"],
  },
]

function hostMatchesDomain(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`)
}

function findBrand(host: string): BrandRule | undefined {
  return BRANDS.find(
    (rule) =>
      rule.domains.some((domain) => hostMatchesDomain(host, domain)) ||
      (rule.test?.test(host) ?? false),
  )
}

/** Prettify an unknown host into a compact label, e.g. "www.example.co.uk" → "example.co.uk". */
function domainLabel(host: string): string {
  return host.replace(/^www\./, "")
}

/** Detect the source platform for an imported asset from its original link. */
export function detectAssetSource(url?: string | null): AssetSourceInfo | null {
  if (!url) return null
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null

  const host = parsed.hostname.toLowerCase().replace(/\.$/, "")
  const brand = findBrand(host)
  if (brand) {
    return { key: brand.key, label: brand.label, color: brand.color, href: url }
  }

  return { key: "web", label: domainLabel(host), color: "#3f3f46", href: url }
}

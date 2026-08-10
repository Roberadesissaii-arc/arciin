import type { PasswordVaultEntry } from "@/lib/types/models"

export type VaultBrandCategory = "app" | "cloud" | "model"

export type VaultBrandMatch = {
  key: string
  category: VaultBrandCategory
  label: string
}

type BrandRule = {
  key: string
  category: VaultBrandCategory
  label: string
  patterns: RegExp[]
}

/**
 * SVG assets live under /assets/icons/{apps|cloud|models}/.
 * Files are lowercase kebab-case. Root-drop icons are ingested here.
 */
const LOCAL_ICON_FILES: Record<VaultBrandCategory, Record<string, string>> = {
  app: {
    spotify: "spotify.svg",
    amazon: "amazon.svg",
    "amazon-prime": "amazon-prime.svg",
    walmart: "walmart.svg",
    vercel: "vercel.svg",
    netflix: "netflix.svg",
    hulu: "hulu.svg",
    "disney-plus": "disney-plus.svg",
    "apple-tv": "apple-tv-plus.svg",
    plex: "plex.svg",
    github: "github.svg",
    google: "google.svg",
    "google-drive": "google-drive.svg",
    onedrive: "onedrive.svg",
    microsoft: "microsoft.svg",
    apple: "apple.svg",
    discord: "discord.svg",
    notion: "notion.svg",
    adobe: "adobe.svg",
    capcut: "capcut.svg",
    mcp: "mcp.svg",
    figma: "Figma.svg",
    slack: "Slack.svg",
    alexa: "alexa.svg",
    instagram: "instagram.svg",
    jetbrains: "jetbrains.svg",
    tuya: "tuya.svg",
    // Sourced from dashboardicons.com and vendored under di-* so they are
    // served from this instance. Hot-linking their CDN would tell a third
    // party which services a self-hosted password vault holds accounts for.
    arduino: "di-arduino.svg",
    atlassian: "di-atlassian.svg",
    att: "di-at-t.svg",
    chatgpt: "di-chatgpt.svg",
    digitalocean: "di-digital-ocean.svg",
    "disney-plus-di": "di-disney-plus.svg",
    docker: "di-docker.svg",
    godaddy: "di-godaddy.svg",
    hostinger: "di-hostinger.svg",
    ibm: "di-ibm.svg",
    leetcode: "di-leetcode.svg",
    linkedin: "di-linkedin.svg",
    linode: "di-linode.svg",
    n8n: "di-n8n.svg",
    ngrok: "di-ngrok.svg",
    paypal: "di-paypal.svg",
    postman: "di-postman.svg",
    "raspberry-pi": "di-raspberry-pi.svg",
    stripe: "di-stripe.svg",
    supabase: "di-supabase.svg",
    tmdb: "di-tmdb.svg",
    ubuntu: "di-ubuntu-linux.svg",
    udemy: "di-udemy.svg",
    upwork: "di-upwork.svg",
  },
  cloud: {
    aws: "aws.svg",
    azure: "azure.svg",
    gcp: "google-cloud.svg",
    alibaba: "alibaba.svg",
  },
  model: {
    v0: "v0.svg",
    openai: "openai.svg",
    anthropic: "anthropic.svg",
    claude: "claude.svg",
    "claude-code": "claude-code.svg",
    gemini: "gemini.svg",
    gemma: "gemma.svg",
    meta: "meta.svg",
    ollama: "ollama.svg",
    deepseek: "deepseek.svg",
    qwen: "qwen-color.svg",
    grok: "grok.svg",
    mistral: "mistral.svg",
    elevenlabs: "elevenlabs.svg",
    huggingface: "huggingface.svg",
    stability: "stability.svg",
    midjourney: "midjourney.svg",
    dalle: "dalle.svg",
    copilot: "copilot.svg",
    "github-copilot": "github-copilot.svg",
    bing: "bing.svg",
    nvidia: "nvidia.svg",
    bytedance: "bytedance.svg",
    assemblyai: "assemblyai.svg",
    llamaindex: "llamaindex.svg",
    langgraph: "langgraph.svg",
    llava: "llava.svg",
    lovable: "lovable.svg",
    minimax: "minimax.svg",
    krea: "krea.svg",
    dreammachine: "dreammachine.svg",
    hermes: "hermes.svg",
    openclaw: "openclaw.svg",
    searchapi: "searchapi.svg",
    nanobanana: "nanobanana.svg",
    perplexity: "perplexity.svg",
  },
}

/**
 * Logos that render white/light in SVG and need a dark tile for contrast.
 * Everything else defaults to a white tile (dark/currentColor marks, full-color logos).
 */
const LIGHT_MARK_KEYS = new Set([
  "v0",
  "vercel",
])

/** Extra SVG paths tried when the primary asset fails to load. */
const ICON_FALLBACKS: Partial<Record<string, string[]>> = {
  spotify: ["/assets/icons/apps/Spotify.svg", "/assets/icons/apps/spotify.svg"],
  ollama: ["/assets/icons/models/ollama-dark.svg"],
  anthropic: ["/assets/icons/models/anthropic1.svg"],
  claude: ["/assets/icons/models/anthropic.svg"],
  gemini: ["/assets/icons/models/gemini-color.svg"],
  meta: ["/assets/icons/models/meta-color.svg"],
  deepseek: ["/assets/icons/models/deepseek-color.svg"],
  mistral: ["/assets/icons/models/mistral-color.svg"],
  grok: ["/assets/icons/models/grok.svg"],
  vercel: ["/assets/icons/apps/vercel.svg"],
  v0: ["/assets/icons/models/v0.svg"],
  figma: ["/assets/icons/apps/Figma.svg"],
  slack: ["/assets/icons/apps/Slack.svg"],
  discord: ["/assets/icons/apps/Discord.svg"],
  notion: ["/assets/icons/apps/Notion.svg"],
}

/** LobeHub fallback when no local SVG is registered. */
export const LOBEHUB_MODEL_KEYS = new Set([
  "cohere",
  "xai",
  "qwen",
])

const LOBEHUB_APP_KEYS = new Set<string>()

const BRAND_RULES: BrandRule[] = [
  // Sites matched on their own domain. Anchored to the hostname rather than a
  // loose word so an unrelated entry that merely mentions the name in its
  // title does not steal the icon.
  { key: "paypal", category: "app", label: "PayPal", patterns: [/paypal\.(com|me)/i] },
  { key: "linkedin", category: "app", label: "LinkedIn", patterns: [/linkedin\.com/i] },
  { key: "stripe", category: "app", label: "Stripe", patterns: [/stripe\.com/i] },
  { key: "supabase", category: "app", label: "Supabase", patterns: [/supabase\.(com|io)/i] },
  { key: "digitalocean", category: "app", label: "DigitalOcean", patterns: [/digitalocean\.com/i] },
  { key: "linode", category: "app", label: "Linode", patterns: [/linode\.com/i] },
  { key: "hostinger", category: "app", label: "Hostinger", patterns: [/hostinger\.(com|co\.uk)/i, /hpanel\.hostinger/i] },
  { key: "godaddy", category: "app", label: "GoDaddy", patterns: [/godaddy\.com/i] },
  { key: "docker", category: "app", label: "Docker", patterns: [/docker\.(com|io)/i, /hub\.docker/i] },
  { key: "ngrok", category: "app", label: "ngrok", patterns: [/ngrok\.(com|io|app)/i] },
  { key: "n8n", category: "app", label: "n8n", patterns: [/n8n\.(io|cloud)/i] },
  { key: "postman", category: "app", label: "Postman", patterns: [/postman\.com/i, /getpostman\.com/i] },
  { key: "atlassian", category: "app", label: "Atlassian", patterns: [/atlassian\.(com|net)/i] },
  { key: "leetcode", category: "app", label: "LeetCode", patterns: [/leetcode\.com/i] },
  { key: "udemy", category: "app", label: "Udemy", patterns: [/udemy\.com/i] },
  { key: "upwork", category: "app", label: "Upwork", patterns: [/upwork\.com/i] },
  { key: "arduino", category: "app", label: "Arduino", patterns: [/arduino\.cc/i] },
  { key: "raspberry-pi", category: "app", label: "Raspberry Pi", patterns: [/raspberrypi\.(com|org)/i] },
  { key: "ubuntu", category: "app", label: "Ubuntu", patterns: [/ubuntu\.com/i] },
  { key: "ibm", category: "app", label: "IBM", patterns: [/ibm\.com/i] },
  { key: "att", category: "app", label: "AT&T", patterns: [/\batt\.com/i, /att\.net/i] },
  { key: "tmdb", category: "app", label: "TMDB", patterns: [/themoviedb\.org/i, /\btmdb\b/i] },
  { key: "chatgpt", category: "app", label: "ChatGPT", patterns: [/chatgpt\.com/i] },

  // Models — specific patterns before generic app matches
  { key: "v0", category: "model", label: "v0", patterns: [/\bv0\b/i, /v0\.dev/i, /v0\.app/i] },
  { key: "claude-code", category: "model", label: "Claude Code", patterns: [/claude code/i] },
  { key: "github-copilot", category: "model", label: "GitHub Copilot", patterns: [/github copilot/i, /copilot\.github/i] },
  { key: "openai", category: "model", label: "OpenAI", patterns: [/openai/i, /chatgpt/i, /sora/i] },
  { key: "anthropic", category: "model", label: "Anthropic", patterns: [/anthropic/i] },
  { key: "claude", category: "model", label: "Claude", patterns: [/claude/i] },
  { key: "gemini", category: "model", label: "Gemini", patterns: [/gemini/i, /bard/i] },
  { key: "gemma", category: "model", label: "Gemma", patterns: [/gemma/i] },
  { key: "meta", category: "model", label: "Meta AI", patterns: [/meta ai/i, /\bllama\b/i] },
  { key: "ollama", category: "model", label: "Ollama", patterns: [/ollama/i] },
  { key: "mistral", category: "model", label: "Mistral", patterns: [/mistral/i] },
  { key: "deepseek", category: "model", label: "DeepSeek", patterns: [/deepseek/i] },
  { key: "qwen", category: "model", label: "Qwen", patterns: [/qwen/i] },
  { key: "grok", category: "model", label: "Grok", patterns: [/grok/i, /\bx\.ai\b/i] },
  { key: "elevenlabs", category: "model", label: "ElevenLabs", patterns: [/elevenlabs/i, /eleven labs/i] },
  { key: "huggingface", category: "model", label: "Hugging Face", patterns: [/huggingface/i, /hugging face/i] },
  { key: "stability", category: "model", label: "Stability AI", patterns: [/stability/i, /stable diffusion/i] },
  { key: "midjourney", category: "model", label: "Midjourney", patterns: [/midjourney/i] },
  { key: "dalle", category: "model", label: "DALL·E", patterns: [/dall-?e/i] },
  { key: "copilot", category: "model", label: "Copilot", patterns: [/microsoft copilot/i, /bing chat/i] },
  { key: "bing", category: "model", label: "Bing", patterns: [/bing\.com/i, /\bbing\b/i] },
  { key: "nvidia", category: "model", label: "NVIDIA", patterns: [/nvidia/i, /\bnim\b/i] },
  { key: "bytedance", category: "model", label: "ByteDance", patterns: [/bytedance/i, /doubao/i] },
  { key: "assemblyai", category: "model", label: "AssemblyAI", patterns: [/assemblyai/i] },
  { key: "llamaindex", category: "model", label: "LlamaIndex", patterns: [/llamaindex/i, /llama index/i] },
  { key: "langgraph", category: "model", label: "LangGraph", patterns: [/langgraph/i] },
  { key: "llava", category: "model", label: "LLaVA", patterns: [/llava/i] },
  { key: "lovable", category: "model", label: "Lovable", patterns: [/lovable/i] },
  { key: "minimax", category: "model", label: "MiniMax", patterns: [/minimax/i] },
  { key: "krea", category: "model", label: "Krea", patterns: [/krea\.ai/i, /\bkrea\b/i] },
  { key: "dreammachine", category: "model", label: "Dream Machine", patterns: [/dream machine/i, /dreammachine/i] },
  { key: "hermes", category: "model", label: "Hermes", patterns: [/hermes/i] },
  { key: "openclaw", category: "model", label: "OpenClaw", patterns: [/openclaw/i] },
  { key: "searchapi", category: "model", label: "SearchAPI", patterns: [/searchapi/i] },
  { key: "nanobanana", category: "model", label: "Nano Banana", patterns: [/nanobanana/i, /nano banana/i] },
  { key: "perplexity", category: "model", label: "Perplexity", patterns: [/perplexity/i] },
  { key: "cohere", category: "model", label: "Cohere", patterns: [/cohere/i] },
  { key: "xai", category: "model", label: "xAI", patterns: [/\bxai\b/i] },
  // Cloud
  { key: "aws", category: "cloud", label: "AWS", patterns: [/aws/i, /amazon web services/i, /aws\.amazon/i] },
  { key: "azure", category: "cloud", label: "Azure", patterns: [/azure/i] },
  { key: "gcp", category: "cloud", label: "Google Cloud", patterns: [/cloud\.google/i, /google cloud/i, /googlecloud/i] },
  { key: "alibaba", category: "cloud", label: "Alibaba Cloud", patterns: [/alibaba cloud/i, /aliyun/i] },
  // Apps & streaming
  { key: "spotify", category: "app", label: "Spotify", patterns: [/spotify/i] },
  { key: "netflix", category: "app", label: "Netflix", patterns: [/netflix/i] },
  { key: "hulu", category: "app", label: "Hulu", patterns: [/hulu/i] },
  { key: "disney-plus", category: "app", label: "Disney+", patterns: [/disney\+?/i, /disneyplus/i] },
  { key: "amazon-prime", category: "app", label: "Prime Video", patterns: [/prime video/i, /amazon prime/i] },
  { key: "alexa", category: "app", label: "Alexa", patterns: [/alexa/i, /alexa\.amazon/i] },
  { key: "amazon", category: "app", label: "Amazon", patterns: [/amazon(?!aws| prime)/i, /amzn/i] },
  { key: "apple-tv", category: "app", label: "Apple TV+", patterns: [/apple tv/i] },
  { key: "plex", category: "app", label: "Plex", patterns: [/plex/i] },
  { key: "walmart", category: "app", label: "Walmart", patterns: [/walmart/i] },
  { key: "vercel", category: "app", label: "Vercel", patterns: [/vercel/i] },
  { key: "adobe", category: "app", label: "Adobe", patterns: [/adobe/i, /creative cloud/i] },
  { key: "capcut", category: "app", label: "CapCut", patterns: [/capcut/i] },
  { key: "github", category: "app", label: "GitHub", patterns: [/github(?! copilot)/i] },
  { key: "google-drive", category: "app", label: "Google Drive", patterns: [/drive\.google/i, /google drive/i] },
  { key: "onedrive", category: "app", label: "OneDrive", patterns: [/onedrive/i, /1drv\.ms/i] },
  { key: "google", category: "app", label: "Google", patterns: [/google(?! gemini| cloud| drive)/i, /gmail/i] },
  { key: "microsoft", category: "app", label: "Microsoft", patterns: [/microsoft/i, /office365/i, /outlook\.com/i, /live\.com/i] },
  { key: "apple", category: "app", label: "Apple", patterns: [/apple\.com/i, /icloud/i] },
  { key: "discord", category: "app", label: "Discord", patterns: [/discord/i] },
  { key: "instagram", category: "app", label: "Instagram", patterns: [/instagram/i, /instagr\.am/i] },
  { key: "jetbrains", category: "app", label: "JetBrains", patterns: [/jetbrains/i, /intellij/i, /toolbox\.jetbrains/i] },
  { key: "tuya", category: "app", label: "Tuya", patterns: [/tuya/i, /smart life/i] },
  { key: "slack", category: "app", label: "Slack", patterns: [/slack/i] },
  { key: "notion", category: "app", label: "Notion", patterns: [/notion/i] },
  { key: "figma", category: "app", label: "Figma", patterns: [/figma/i] },
  { key: "mcp", category: "app", label: "MCP", patterns: [/\bmcp\b/i] },
]

/**
 * Only the site identifies the brand — the name and the URL.
 *
 * Username, category and notes used to be in here, and that was badly wrong:
 * a vault where every login is the same `you@gmail.com` matched /gmail/ on
 * every single entry, so all 187 of them rendered the Google logo no matter
 * which site they belonged to. Notes are free text and just as prone to it.
 * The account is not the service.
 */
function haystackForEntry(entry: Pick<PasswordVaultEntry, "name" | "url" | "username" | "category" | "notes">) {
  return [entry.name, entry.url].filter(Boolean).join(" ")
}

function hostnameHints(url: string | null | undefined) {
  if (!url?.trim()) return ""
  try {
    const host = new URL(url.startsWith("http") ? url : `https://${url}`).hostname.toLowerCase()
    return host.replace(/^www\./, "")
  } catch {
    return url.toLowerCase()
  }
}

export function resolveVaultBrand(
  entry: Pick<PasswordVaultEntry, "name" | "url" | "username" | "category" | "notes">,
): VaultBrandMatch | null {
  const haystack = `${haystackForEntry(entry)} ${hostnameHints(entry.url)}`.toLowerCase()

  for (const rule of BRAND_RULES) {
    if (rule.patterns.some((p) => p.test(haystack))) {
      return { key: rule.key, category: rule.category, label: rule.label }
    }
  }

  return null
}

export function vaultBrandIconSrc(match: VaultBrandMatch): string | null {
  const candidates = vaultBrandIconCandidates(match)
  return candidates[0] ?? null
}

export function vaultBrandIconCandidates(match: VaultBrandMatch): string[] {
  const file = LOCAL_ICON_FILES[match.category][match.key]
  const folder =
    match.category === "cloud" ? "cloud" : match.category === "model" ? "models" : "apps"
  const primary = file ? `/assets/icons/${folder}/${file}` : null
  const fallbacks = ICON_FALLBACKS[match.key] ?? []
  return [...new Set([primary, ...fallbacks].filter(Boolean))] as string[]
}

export function vaultBrandUsesLobeHub(match: VaultBrandMatch): boolean {
  if (LOBEHUB_APP_KEYS.has(match.key)) {
    return !vaultBrandIconCandidates(match).length
  }
  return match.category === "model" && LOBEHUB_MODEL_KEYS.has(match.key) && !vaultBrandIconSrc(match)
}

/**
 * One neutral tile for every brand.
 *
 * Per-brand fills (Spotify black, Discord blurple, Adobe red, Plex gold,
 * Instagram pink…) turned the list into a patchwork where every row looked
 * like it belonged to a different design. The logo should be the only thing
 * that varies. The single exception is marks that are drawn white, which are
 * invisible on a light tile and get a uniform dark one instead.
 */
export function vaultBrandTileBg(match: VaultBrandMatch | null): string {
  if (!match) return "#18181b"
  if (LIGHT_MARK_KEYS.has(match.key)) return "#09090b"
  return "#ffffff"
}

export function vaultBrandTileFg(match: VaultBrandMatch | null): string | undefined {
  if (!match) return "#fafafa"
  if (LIGHT_MARK_KEYS.has(match.key)) return "#fafafa"
  return undefined
}

export function vaultBrandInitials(match: VaultBrandMatch | null, fallbackName: string): string {
  if (match?.label) {
    const parts = match.label.replace(/[^a-zA-Z0-9 ]/g, "").split(/\s+/).filter(Boolean)
    if (parts.length >= 2) return `${parts[0]![0]}${parts[1]![0]}`.toUpperCase()
    return match.label.slice(0, 2).toUpperCase()
  }
  const name = fallbackName.trim()
  if (!name) return "?"
  const words = name.split(/\s+/).filter(Boolean)
  if (words.length >= 2) return `${words[0]![0]}${words[1]![0]}`.toUpperCase()
  return name.slice(0, 2).toUpperCase()
}

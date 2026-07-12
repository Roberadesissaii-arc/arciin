import { ACCENT_CACHE_KEY } from "@/lib/preferences/accent-tokens"

/**
 * Inline <head> script (see app/layout.tsx) — applies the last-known accent
 * color synchronously, before React hydrates. Without this, every hard
 * refresh briefly paints the CSS default (#ff4f12) and then snaps to the
 * saved accent once the preferences fetch resolves and the provider effect
 * runs. Mirrors the derived color-mix() tokens in accent-tokens.ts so the
 * two never disagree once the real preferences load.
 */
export function accentFlashGuardScript() {
  return `(function(){try{var a=localStorage.getItem(${JSON.stringify(ACCENT_CACHE_KEY)});if(!a)return;var r=document.documentElement.style;r.setProperty("--arciin-accent",a);r.setProperty("--arciin-accent-hover","color-mix(in srgb, "+a+" 88%, white)");r.setProperty("--arciin-accent-muted","color-mix(in srgb, "+a+" 12%, transparent)");r.setProperty("--arciin-accent-soft","color-mix(in srgb, "+a+" 10%, white)");r.setProperty("--arciin-accent-surface","color-mix(in srgb, "+a+" 14%, #fafafa)");r.setProperty("--arciin-accent-ring","color-mix(in srgb, "+a+" 32%, transparent)");r.setProperty("--arciin-accent-glow","color-mix(in srgb, "+a+" 40%, transparent)");r.setProperty("--arciin-accent-wash","color-mix(in srgb, "+a+" 16%, transparent)");r.setProperty("--arciin-accent-icon-bg","color-mix(in srgb, "+a+" 8%, transparent)");r.setProperty("--arciin-accent-icon-border","color-mix(in srgb, "+a+" 18%, transparent)");r.setProperty("--arciin-accent-icon-ring","color-mix(in srgb, "+a+" 15%, transparent)");r.setProperty("--arciin-accent-badge-bg","color-mix(in srgb, "+a+" 10%, transparent)");r.setProperty("--arciin-accent-badge-border","color-mix(in srgb, "+a+" 22%, transparent)");r.setProperty("--primary",a);r.setProperty("--chart-1",a);}catch(e){}})();`
}

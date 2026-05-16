/** Minimal SVG used when sharp cannot process an image file. */
export const IMAGE_THUMBNAIL_PLACEHOLDER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#18181b"/>
      <stop offset="100%" stop-color="#27272a"/>
    </linearGradient>
  </defs>
  <rect width="640" height="360" fill="url(#bg)"/>
  <rect x="256" y="132" width="128" height="96" rx="10" ry="10" fill="none" stroke="rgba(255,79,18,0.45)" stroke-width="2"/>
  <circle cx="292" cy="162" r="12" fill="rgba(255,79,18,0.35)"/>
  <polygon points="256,228 296,172 330,204 358,172 384,228" fill="rgba(255,79,18,0.2)"/>
</svg>`

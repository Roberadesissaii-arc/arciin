/** Minimal SVG used when ffmpeg cannot extract a video frame (still shows a clear “video” preview). */
export const VIDEO_THUMBNAIL_PLACEHOLDER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#18181b"/>
      <stop offset="100%" stop-color="#27272a"/>
    </linearGradient>
  </defs>
  <rect width="640" height="360" fill="url(#bg)"/>
  <circle cx="320" cy="180" r="52" fill="rgba(255,79,18,0.15)" stroke="rgba(255,79,18,0.55)" stroke-width="2"/>
  <polygon points="302,148 302,212 368,180" fill="#ff4f12"/>
</svg>`

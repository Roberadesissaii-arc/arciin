/**
 * A drawn birthday scene — cake, lit candles, party hats, balloons, confetti —
 * with no words in it, so a caption can only come from what the picture shows.
 * Used by the opt-in live test to run the real caption → embed → search path.
 */
export const BIRTHDAY_SCENE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480" viewBox="0 0 640 480">
  <rect width="640" height="480" fill="#fdf1e6"/>
  <rect y="360" width="640" height="120" fill="#c98b5a"/>
  <g stroke="#555" stroke-width="2">
    <line x1="90" y1="60" x2="110" y2="250"/><line x1="560" y1="70" x2="530" y2="250"/><line x1="170" y1="40" x2="175" y2="220"/>
  </g>
  <ellipse cx="90" cy="60" rx="38" ry="48" fill="#e63946"/>
  <ellipse cx="170" cy="40" rx="34" ry="44" fill="#457b9d"/>
  <ellipse cx="560" cy="70" rx="38" ry="48" fill="#f4a261"/>
  <ellipse cx="320" cy="372" rx="190" ry="26" fill="#ffffff" stroke="#ddd"/>
  <rect x="190" y="270" width="260" height="100" rx="12" fill="#f7c6d9"/>
  <rect x="190" y="300" width="260" height="14" fill="#ffffff"/>
  <rect x="225" y="210" width="190" height="70" rx="10" fill="#fbe3ec"/>
  <rect x="225" y="232" width="190" height="10" fill="#ffffff"/>
  <g fill="#8ecae6">
    <rect x="250" y="150" width="10" height="62"/><rect x="285" y="150" width="10" height="62"/>
    <rect x="320" y="150" width="10" height="62"/><rect x="355" y="150" width="10" height="62"/><rect x="390" y="150" width="10" height="62"/>
  </g>
  <g fill="#ffb703">
    <ellipse cx="255" cy="138" rx="8" ry="14"/><ellipse cx="290" cy="138" rx="8" ry="14"/><ellipse cx="325" cy="138" rx="8" ry="14"/>
    <ellipse cx="360" cy="138" rx="8" ry="14"/><ellipse cx="395" cy="138" rx="8" ry="14"/>
  </g>
  <g fill="#fb8500"><ellipse cx="255" cy="142" rx="4" ry="7"/><ellipse cx="290" cy="142" rx="4" ry="7"/><ellipse cx="325" cy="142" rx="4" ry="7"/><ellipse cx="360" cy="142" rx="4" ry="7"/><ellipse cx="395" cy="142" rx="4" ry="7"/></g>
  <circle cx="80" cy="330" r="40" fill="#e9c46a"/><polygon points="50,300 110,300 80,220" fill="#2a9d8f"/><circle cx="80" cy="218" r="8" fill="#e76f51"/>
  <circle cx="560" cy="330" r="40" fill="#e9c46a"/><polygon points="530,300 590,300 560,220" fill="#e76f51"/><circle cx="560" cy="218" r="8" fill="#2a9d8f"/>
  <g fill="#e63946"><rect x="140" y="120" width="8" height="8" transform="rotate(20 144 124)"/><rect x="480" y="160" width="8" height="8"/><rect x="430" y="60" width="8" height="8" transform="rotate(40 434 64)"/></g>
  <g fill="#457b9d"><rect x="220" y="80" width="8" height="8"/><rect x="500" y="250" width="8" height="8" transform="rotate(30 504 254)"/><rect x="120" y="190" width="8" height="8"/></g>
</svg>`

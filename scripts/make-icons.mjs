// Rasterises the brand mark into PNG icons and the social card.
// Run: node scripts/make-icons.mjs   (needs sharp: npm i --no-save sharp; and fonts Instrument Serif + Geist visible to fontconfig)
import sharp from "sharp";

const mark = (ink, dot, scale = 1, x = 0, y = 0) => `
  <g transform="translate(${x} ${y}) scale(${scale})">
    <path d="M5 7 L16 24 L27 7" fill="none" stroke="${ink}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="16" cy="24" r="3.1" fill="${dot}"/>
  </g>`;

const icon = (size) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="#0c1220"/>
  ${mark("#e8ecf5", "#8ea2ff", size / 52, size * 0.115, size * 0.135)}
</svg>`;

for (const s of [192, 512]) await sharp(Buffer.from(icon(s))).png().toFile(`public/icon-${s}.png`);

const card = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#eef0f3"/>
  <path d="M0 400 L1200 400" stroke="#d3d9e3" stroke-width="2"/>
  <path d="M0 400 C 120 400 160 330 260 330 S 380 470 480 470 S 600 340 700 340 S 820 450 920 450 S 1040 400 1200 400" fill="none" stroke="#2b4bff" stroke-width="3.5" stroke-linecap="round"/>
  ${mark("#101a2e", "#2b4bff", 3.4, 96, 82)}
  <text x="224" y="176" font-family="Instrument Serif" font-size="88" fill="#101a2e">VolTune</text>
  <text x="96" y="270" font-family="Instrument Serif" font-size="56" fill="#101a2e">Natural speech, spoken privately</text>
  <text x="96" y="318" font-family="Instrument Serif" font-size="56" fill="#566176">in your browser.</text>
  <text x="96" y="560" font-family="Geist" font-size="26" fill="#566176">Text and dialogue to voice. Nothing is uploaded.</text>
</svg>`;
await sharp(Buffer.from(card)).png().toFile("public/og.png");
console.log("icons written");

// Writes legacy (pre-Android 8) launcher PNGs from the VolTune mark.
// Run: node scripts/make-android-icons.mjs   (needs sharp: npm i --no-save sharp)
import sharp from "sharp";
import { rmSync } from "node:fs";

const densities = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };

const svg = (size, round) => {
  const r = round ? size / 2 : size * 0.22;
  const k = size / 64; // mark drawn on a 64 grid
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <rect width="${size}" height="${size}" rx="${r}" fill="#0c1220"/>
    <g transform="scale(${k})">
      <path d="M19 20 L32 41 L45 20" fill="none" stroke="#e8ecf5" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="32" cy="41" r="5.4" fill="#8ea2ff"/>
    </g>
  </svg>`;
};

for (const [name, size] of Object.entries(densities)) {
  const dir = `android/app/src/main/res/mipmap-${name}`;
  await sharp(Buffer.from(svg(size, false))).png().toFile(`${dir}/ic_launcher.png`);
  await sharp(Buffer.from(svg(size, true))).png().toFile(`${dir}/ic_launcher_round.png`);
  // Adaptive icons use the vector foreground in drawable-v24; the stock raster foregrounds are unused.
  rmSync(`${dir}/ic_launcher_foreground.png`, { force: true });
}
console.log("android icons written");

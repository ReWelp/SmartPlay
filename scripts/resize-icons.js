// scripts/resize-icons.js
// Generates icon16.png and icon48.png from icon128.png using sharp.
// Run once: node scripts/resize-icons.js

const sharp = require('sharp');
const path = require('path');

const SRC  = path.resolve(__dirname, '../icons/icon128.png');
const DEST = path.resolve(__dirname, '../icons');

const sizes = [16, 48];

Promise.all(
  sizes.map(size =>
    sharp(SRC)
      .resize(size, size, { kernel: sharp.kernel.lanczos3 })
      .png()
      .toFile(path.join(DEST, `icon${size}.png`))
      .then(() => console.log(`✓ icon${size}.png written`))
  )
).catch(err => { console.error(err); process.exit(1); });

import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, '..');
const publicDir = path.join(rootDir, 'public');
const distDir = path.join(rootDir, 'dist');

// Primary source: User-provided 3D TZ Shopping Bag Logo
const srcLogo = path.join(publicDir, 'assets', 'aistudio', '3D_TZ_Shopping_Bag_Logo-Picsart-AiImageEnhancer_57618c1d.png');

if (!fs.existsSync(srcLogo)) {
  console.error('Source logo not found at:', srcLogo);
  process.exit(1);
}

// Function to generate image with professional rounded squircle corners
async function createRoundedImage(sourcePath, size, cornerRadius) {
  const maskSvg = Buffer.from(
    `<svg width="${size}" height="${size}">
      <rect x="0" y="0" width="${size}" height="${size}" rx="${cornerRadius}" ry="${cornerRadius}" fill="#ffffff"/>
    </svg>`
  );

  return await sharp(sourcePath)
    .resize(size, size, { fit: 'cover' })
    .composite([{
      input: maskSvg,
      blend: 'dest-in'
    }])
    .png()
    .toBuffer();
}

async function generateAllIcons() {
  console.log('[IconGenerator] Generating professional rounded 3D TZ icons...');

  // 1. Full-size rounded logo (1024x1024, radius 180)
  const logo1024 = await createRoundedImage(srcLogo, 1024, 180);
  fs.writeFileSync(path.join(publicDir, 'logo.png'), logo1024);
  if (fs.existsSync(distDir)) fs.writeFileSync(path.join(distDir, 'logo.png'), logo1024);
  console.log('✓ Created public/logo.png (1024x1024 rounded)');

  // 2. PWA 512x512 Standard Icon (radius 96 ~18.75%)
  const pwa512 = await createRoundedImage(srcLogo, 512, 96);
  fs.writeFileSync(path.join(publicDir, 'pwa-512x512.png'), pwa512);
  if (fs.existsSync(distDir)) fs.writeFileSync(path.join(distDir, 'pwa-512x512.png'), pwa512);
  console.log('✓ Created pwa-512x512.png (rounded)');

  // 3. PWA 192x192 Standard Icon (radius 36)
  const pwa192 = await createRoundedImage(srcLogo, 192, 36);
  fs.writeFileSync(path.join(publicDir, 'pwa-192x192.png'), pwa192);
  if (fs.existsSync(distDir)) fs.writeFileSync(path.join(distDir, 'pwa-192x192.png'), pwa192);
  console.log('✓ Created pwa-192x192.png (rounded)');

  // 4. Apple Touch Icon 180x180 (radius 34)
  const appleTouch = await createRoundedImage(srcLogo, 180, 34);
  fs.writeFileSync(path.join(publicDir, 'apple-touch-icon.png'), appleTouch);
  if (fs.existsSync(distDir)) fs.writeFileSync(path.join(distDir, 'apple-touch-icon.png'), appleTouch);
  console.log('✓ Created apple-touch-icon.png (rounded)');

  // 5. Favicon PNG 48x48 (radius 10)
  const fav48 = await createRoundedImage(srcLogo, 48, 10);
  fs.writeFileSync(path.join(publicDir, 'favicon.png'), fav48);
  if (fs.existsSync(distDir)) fs.writeFileSync(path.join(distDir, 'favicon.png'), fav48);
  console.log('✓ Created favicon.png (48x48 rounded)');

  // 6. Favicon ICO 32x32 (radius 7)
  const fav32 = await createRoundedImage(srcLogo, 32, 7);
  fs.writeFileSync(path.join(publicDir, 'favicon.ico'), fav32);
  if (fs.existsSync(distDir)) fs.writeFileSync(path.join(distDir, 'favicon.ico'), fav32);
  console.log('✓ Created favicon.ico (32x32 rounded)');

  // 7. PWA Maskable 512x512 with safe-zone margin (inner 78% for adaptive icons)
  const innerSize = Math.round(512 * 0.78);
  const resizedInner = await sharp(srcLogo)
    .resize(innerSize, innerSize, { fit: 'cover' })
    .png()
    .toBuffer();

  // Vibrant brand gradient/dark green background matching the 3D logo
  const maskable512 = await sharp({
    create: {
      width: 512,
      height: 512,
      channels: 4,
      background: { r: 1, g: 60, b: 24, alpha: 1 }
    }
  })
    .composite([{ input: resizedInner, gravity: 'center' }])
    .png()
    .toBuffer();

  fs.writeFileSync(path.join(publicDir, 'pwa-maskable-512x512.png'), maskable512);
  if (fs.existsSync(distDir)) fs.writeFileSync(path.join(distDir, 'pwa-maskable-512x512.png'), maskable512);
  console.log('✓ Created pwa-maskable-512x512.png (safe-zone maskable)');

  // 8. Generate SVG Icon embedding the rounded 512x512 logo so Chrome tab always displays the new 3D logo
  const base64Png512 = pwa512.toString('base64');
  const svgContent = `<svg width="512" height="512" viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
  <defs>
    <clipPath id="squircle">
      <rect width="512" height="512" rx="96" ry="96" fill="#ffffff" />
    </clipPath>
  </defs>
  <g clip-path="url(#squircle)">
    <image width="512" height="512" preserveAspectRatio="xMidYMid slice" xlink:href="data:image/png;base64,${base64Png512}" />
  </g>
</svg>
`;

  fs.writeFileSync(path.join(publicDir, 'icon.svg'), svgContent, 'utf-8');
  if (fs.existsSync(distDir)) fs.writeFileSync(path.join(distDir, 'icon.svg'), svgContent, 'utf-8');
  console.log('✓ Created public/icon.svg (SVG wrapper with embedded 3D TZ rounded logo)');

  console.log('\n[IconGenerator] All 3D TZ rounded icons successfully generated!');
}

generateAllIcons().catch((err) => {
  console.error('[IconGenerator] Failed:', err);
  process.exit(1);
});

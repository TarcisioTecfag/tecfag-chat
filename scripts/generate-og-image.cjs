const sharp = require('sharp');
const path = require('path');

async function createOgImage() {
  const publicDir = path.join(__dirname, '..', 'public');
  const logoPath = path.join(publicDir, 'logo_t_preto.png');

  // Redimensiona a logo preta da empresa mantendo transparência dos recortes
  const logoSize = 440;
  const logoBuf = await sharp(logoPath)
    .resize(logoSize, logoSize, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();

  const logoBase64 = logoBuf.toString('base64');

  // Banner 1200x630 com a logo preta centralizada (100% visível em cortes 16:9, 4:3 do Teams e 1:1 do WhatsApp)
  const svgBanner = `
  <svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <radialGradient id="bg" cx="50%" cy="50%" r="60%">
        <stop offset="0%" stop-color="#1e1e22"/>
        <stop offset="100%" stop-color="#09090b"/>
      </radialGradient>
      <filter id="logoShadow" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0" dy="0" stdDeviation="1.5" flood-color="#ffffff" flood-opacity="0.18"/>
        <feDropShadow dx="0" dy="12" stdDeviation="20" flood-color="#000000" flood-opacity="0.8"/>
      </filter>
    </defs>

    <!-- Background escuro destacando a silhueta da logo preta -->
    <rect width="1200" height="630" fill="url(#bg)"/>

    <!-- Logo Preta Oficial Tecfag Group Centralizada -->
    <g filter="url(#logoShadow)">
      <image href="data:image/png;base64,${logoBase64}" x="380" y="95" width="${logoSize}" height="${logoSize}"/>
    </g>
  </svg>
  `;

  await sharp(Buffer.from(svgBanner))
    .png({ quality: 95 })
    .toFile(path.join(publicDir, 'og-image.png'));

  console.log('✅ og-image.png (Tecfag Group - Logo Preta) criado em public/');

  // Versão quadrada 512x512 para crawlers que preferem imagem 1:1
  const squareLogoBuf = await sharp(logoPath)
    .resize(400, 400, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();

  const squareBase64 = squareLogoBuf.toString('base64');
  const svgSquare = `
  <svg width="512" height="512" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <radialGradient id="bgSq" cx="50%" cy="50%" r="65%">
        <stop offset="0%" stop-color="#1e1e22"/>
        <stop offset="100%" stop-color="#09090b"/>
      </radialGradient>
      <filter id="sqShadow" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0" dy="0" stdDeviation="1.5" flood-color="#ffffff" flood-opacity="0.18"/>
        <feDropShadow dx="0" dy="10" stdDeviation="18" flood-color="#000000" flood-opacity="0.8"/>
      </filter>
    </defs>
    <rect width="512" height="512" fill="url(#bgSq)"/>
    <g filter="url(#sqShadow)">
      <image href="data:image/png;base64,${squareBase64}" x="56" y="56" width="400" height="400"/>
    </g>
  </svg>
  `;

  await sharp(Buffer.from(svgSquare))
    .png({ quality: 95 })
    .toFile(path.join(publicDir, 'og-logo-square.png'));

  console.log('✅ og-logo-square.png (Tecfag Group - Logo Preta) criado em public/');
}

createOgImage().catch(console.error);
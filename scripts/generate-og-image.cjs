const sharp = require('sharp');
const path = require('path');

async function createOgImage() {
  const publicDir = path.join(__dirname, '..', 'public');
  const logoPath = path.join(publicDir, 'logo_valem.jpg');

  // Resize and round logo
  const logoBuf = await sharp(logoPath)
    .resize(240, 240, { fit: 'cover' })
    .composite([{
      input: Buffer.from('<svg><rect x="0" y="0" width="240" height="240" rx="36" ry="36" fill="#fff"/></svg>'),
      blend: 'dest-in'
    }])
    .png()
    .toBuffer();

  const logoBase64 = logoBuf.toString('base64');

  const svgBanner = `
  <svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#090d16"/>
        <stop offset="50%" stop-color="#0f172a"/>
        <stop offset="100%" stop-color="#061a1a"/>
      </linearGradient>
      <radialGradient id="glow" cx="25%" cy="50%" r="60%">
        <stop offset="0%" stop-color="#2dc4a0" stop-opacity="0.22"/>
        <stop offset="100%" stop-color="#2dc4a0" stop-opacity="0"/>
      </radialGradient>
      <radialGradient id="glow2" cx="85%" cy="20%" r="50%">
        <stop offset="0%" stop-color="#0ea5e9" stop-opacity="0.15"/>
        <stop offset="100%" stop-color="#0ea5e9" stop-opacity="0"/>
      </radialGradient>
      <linearGradient id="cardBorder" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#2dc4a0" stop-opacity="0.5"/>
        <stop offset="100%" stop-color="#38bdf8" stop-opacity="0.2"/>
      </linearGradient>
      <linearGradient id="titleGrad" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stop-color="#ffffff"/>
        <stop offset="100%" stop-color="#a7f3d0"/>
      </linearGradient>
      <filter id="shadow" x="-10%" y="-10%" width="120%" height="120%">
        <feDropShadow dx="0" dy="12" stdDeviation="20" flood-color="#000" flood-opacity="0.6"/>
      </filter>
    </defs>

    <!-- Background -->
    <rect width="1200" height="630" fill="url(#bg)"/>
    <rect width="1200" height="630" fill="url(#glow)"/>
    <rect width="1200" height="630" fill="url(#glow2)"/>

    <!-- Decorative grid / lines -->
    <g stroke="#ffffff" stroke-opacity="0.03" stroke-width="1">
      <line x1="0" y1="105" x2="1200" y2="105"/>
      <line x1="0" y1="210" x2="1200" y2="210"/>
      <line x1="0" y1="315" x2="1200" y2="315"/>
      <line x1="0" y1="420" x2="1200" y2="420"/>
      <line x1="0" y1="525" x2="1200" y2="525"/>
      <line x1="200" y1="0" x2="200" y2="630"/>
      <line x1="400" y1="0" x2="400" y2="630"/>
      <line x1="600" y1="0" x2="600" y2="630"/>
      <line x1="800" y1="0" x2="800" y2="630"/>
      <line x1="1000" y1="0" x2="1000" y2="630"/>
    </g>

    <!-- Main Container Card -->
    <rect x="80" y="80" width="1040" height="470" rx="28" fill="#1e293b" fill-opacity="0.65" stroke="url(#cardBorder)" stroke-width="1.5" filter="url(#shadow)"/>

    <!-- Logo Box -->
    <g transform="translate(140, 155)">
      <rect x="-10" y="-10" width="260" height="260" rx="42" fill="#2dc4a0" fill-opacity="0.15"/>
      <rect x="-2" y="-2" width="244" height="244" rx="38" fill="none" stroke="#2dc4a0" stroke-opacity="0.4" stroke-width="2"/>
      <image href="data:image/png;base64,${logoBase64}" x="0" y="0" width="240" height="240"/>
    </g>

    <!-- Content Right Side -->
    <g transform="translate(440, 160)">
      <!-- Badge Category -->
      <g>
        <rect x="0" y="0" width="230" height="36" rx="18" fill="#2dc4a0" fill-opacity="0.18" stroke="#2dc4a0" stroke-opacity="0.4" stroke-width="1"/>
        <circle cx="18" cy="18" r="5" fill="#2dc4a0"/>
        <text x="32" y="23" font-family="system-ui, -apple-system, sans-serif" font-size="13" font-weight="700" fill="#2dd4bf" letter-spacing="1.5">PLATAFORMA OFICIAL</text>
      </g>

      <!-- Main Title -->
      <text x="0" y="100" font-family="system-ui, -apple-system, sans-serif" font-size="56" font-weight="800" fill="url(#titleGrad)" letter-spacing="-1">
        Valem Chat
      </text>

      <!-- Subtitle -->
      <text x="0" y="145" font-family="system-ui, -apple-system, sans-serif" font-size="24" font-weight="600" fill="#94a3b8">
        Central de Atendimento &amp; Gestão Comercial
      </text>

      <!-- Description paragraph -->
      <text x="0" y="190" font-family="system-ui, -apple-system, sans-serif" font-size="17" font-weight="400" fill="#cbd5e1">
        Atendimento multicanal inteligente com IA Valentina,
      </text>
      <text x="0" y="216" font-family="system-ui, -apple-system, sans-serif" font-size="17" font-weight="400" fill="#cbd5e1">
        integração WhatsApp, Live Chat e sincronização com RD Station CRM.
      </text>

      <!-- Feature Pills -->
      <g transform="translate(0, 255)">
        <!-- Pill 1 -->
        <g transform="translate(0, 0)">
          <rect x="0" y="0" width="135" height="34" rx="8" fill="#334155" fill-opacity="0.8" stroke="#475569" stroke-width="1"/>
          <text x="16" y="22" font-family="system-ui, -apple-system, sans-serif" font-size="13" font-weight="600" fill="#f1f5f9">WhatsApp</text>
        </g>
        <!-- Pill 2 -->
        <g transform="translate(145, 0)">
          <rect x="0" y="0" width="145" height="34" rx="8" fill="#334155" fill-opacity="0.8" stroke="#475569" stroke-width="1"/>
          <text x="16" y="22" font-family="system-ui, -apple-system, sans-serif" font-size="13" font-weight="600" fill="#f1f5f9">IA Valentina</text>
        </g>
        <!-- Pill 3 -->
        <g transform="translate(300, 0)">
          <rect x="0" y="0" width="165" height="34" rx="8" fill="#334155" fill-opacity="0.8" stroke="#475569" stroke-width="1"/>
          <text x="16" y="22" font-family="system-ui, -apple-system, sans-serif" font-size="13" font-weight="600" fill="#f1f5f9">RD Station CRM</text>
        </g>
      </g>
    </g>

    <!-- Footer brand -->
    <g transform="translate(80, 580)">
      <text x="0" y="0" font-family="system-ui, -apple-system, sans-serif" font-size="14" font-weight="500" fill="#64748b">
        Valem Válvulas e Embalagens • tecfagchat.up.railway.app
      </text>
    </g>
  </svg>
  `;

  await sharp(Buffer.from(svgBanner))
    .png({ quality: 95 })
    .toFile(path.join(publicDir, 'og-image.png'));

  console.log('✅ og-image.png criado em public/');

  // High quality square image for square preview crawlers
  await sharp(logoPath)
    .resize(512, 512, { fit: 'cover' })
    .png()
    .toFile(path.join(publicDir, 'og-logo-square.png'));

  console.log('✅ og-logo-square.png criado em public/');

  // Generate a dedicated rounded 192x192 and 512x512 app icon
  await sharp(logoPath)
    .resize(192, 192, { fit: 'cover' })
    .png()
    .toFile(path.join(publicDir, 'logo192.png'));

  await sharp(logoPath)
    .resize(512, 512, { fit: 'cover' })
    .png()
    .toFile(path.join(publicDir, 'logo512.png'));

  console.log('✅ logo192.png e logo512.png criados em public/');
}

createOgImage().catch(console.error);
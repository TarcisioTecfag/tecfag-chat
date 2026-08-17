import os
import base64
import subprocess

# Paths
base_dir = r"c:\Users\TEC FAG\Music\PROGRAMAÇÃO\PROJETOS\LOCAL\VALEM CHAT"
md_path = os.path.join(base_dir, "valempack_catalogo_base_conhecimento.md")
logo_path = os.path.join(base_dir, "public", "logo_valem.jpg")
valentina_path = os.path.join(base_dir, "public", "valentina.png")

output_html = os.path.join(base_dir, "scratch", "catalogo_valem.html")
output_pdf_1 = os.path.join(base_dir, "valempack_catalogo_base_conhecimento.pdf")
output_pdf_2 = r"C:\Users\TEC FAG\Downloads\VALENTINA DOCS\valempack_catalogo_base_conhecimento.pdf"
output_pdf_3 = r"C:\Users\TEC FAG\Documents\TEC FAG VAULT\06 - PROJETOS\Valem Chat\valempack_catalogo_base_conhecimento.pdf"

os.makedirs(os.path.join(base_dir, "scratch"), exist_ok=True)
os.makedirs(r"C:\Users\TEC FAG\Downloads\VALENTINA DOCS", exist_ok=True)
os.makedirs(r"C:\Users\TEC FAG\Documents\TEC FAG VAULT\06 - PROJETOS\Valem Chat", exist_ok=True)

# Encode logo
logo_b64 = ""
if os.path.exists(logo_path):
    with open(logo_path, "rb") as f:
        logo_b64 = "data:image/jpeg;base64," + base64.b64encode(f.read()).decode("utf-8")

val_b64 = ""
if os.path.exists(valentina_path):
    with open(valentina_path, "rb") as f:
        val_b64 = "data:image/png;base64," + base64.b64encode(f.read()).decode("utf-8")

html_content = f"""<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<title>Catálogo e Base de Conhecimento Oficial — Valem Válvulas e Embalagens</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
  @page {{
    size: A4 portrait;
    margin: 16mm 14mm 16mm 14mm;
  }}

  * {{
    box-sizing: border-box;
    margin: 0;
    padding: 0;
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }}

  body {{
    font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    color: #1e293b;
    background: #ffffff;
    font-size: 9.5pt;
    line-height: 1.5;
  }}

  /* Cover / Header */
  .doc-header {{
    border-bottom: 2.5px solid #0d9488;
    padding-bottom: 12px;
    margin-bottom: 18px;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }}

  .header-left {{
    display: flex;
    align-items: center;
    gap: 14px;
  }}

  .header-logo {{
    height: 48px;
    object-fit: contain;
    border-radius: 6px;
  }}

  .header-title-box h1 {{
    font-size: 14pt;
    font-weight: 800;
    color: #0f172a;
    letter-spacing: -0.3px;
    text-transform: uppercase;
  }}

  .header-title-box p {{
    font-size: 8.5pt;
    color: #0d9488;
    font-weight: 600;
    letter-spacing: 0.2px;
  }}

  .header-badge {{
    background: linear-gradient(135deg, #0d9488, #0f766e);
    color: white;
    font-size: 7.5pt;
    font-weight: 700;
    padding: 6px 12px;
    border-radius: 20px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    text-align: right;
    box-shadow: 0 2px 4px rgba(13, 148, 136, 0.2);
  }}

  /* Section Styles */
  .section {{
    margin-bottom: 16px;
    page-break-inside: avoid;
  }}

  .section-title {{
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 11pt;
    font-weight: 700;
    color: #0f172a;
    background: #f0fdfa;
    border-left: 4px solid #0d9488;
    padding: 6px 10px;
    border-radius: 0 6px 6px 0;
    margin-bottom: 10px;
  }}

  .section-icon {{
    font-size: 12pt;
  }}

  .card-grid-2 {{
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }}

  .card-grid-3 {{
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 9px;
  }}

  .card-grid-4 {{
    display: grid;
    grid-template-columns: 1fr 1fr 1fr 1fr;
    gap: 8px;
  }}

  .card {{
    background: #ffffff;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    padding: 9px 12px;
    box-shadow: 0 1px 2px rgba(0,0,0,0.02);
  }}

  .card.highlight {{
    background: #f8fafc;
    border-color: #cbd5e1;
  }}

  .card-title {{
    font-size: 9pt;
    font-weight: 700;
    color: #0f766e;
    margin-bottom: 4px;
    display: flex;
    align-items: center;
    gap: 5px;
  }}

  .card-body {{
    font-size: 8.5pt;
    color: #334155;
    line-height: 1.45;
  }}

  /* Material tags */
  .badge-tag {{
    display: inline-block;
    background: #e0f2fe;
    color: #0369a1;
    font-size: 7.5pt;
    font-weight: 600;
    padding: 2px 6px;
    border-radius: 4px;
    margin-right: 4px;
    margin-bottom: 4px;
  }}

  .badge-tag.teal {{
    background: #ccfbf1;
    color: #0f766e;
  }}

  .badge-tag.amber {{
    background: #fef3c7;
    color: #92400e;
  }}

  .badge-tag.purple {{
    background: #f3e8ff;
    color: #6b21a8;
  }}

  /* Table styling */
  table.custom-table {{
    width: 100%;
    border-collapse: collapse;
    margin: 8px 0;
    font-size: 8.5pt;
  }}

  table.custom-table th {{
    background: #0f172a;
    color: #ffffff;
    font-weight: 600;
    text-align: left;
    padding: 7px 10px;
    border: 1px solid #0f172a;
  }}

  table.custom-table td {{
    padding: 6px 10px;
    border: 1px solid #e2e8f0;
    color: #334155;
  }}

  table.custom-table tr:nth-child(even) {{
    background: #f8fafc;
  }}

  /* Directives Box */
  .directive-box {{
    background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
    color: #f8fafc;
    border-radius: 8px;
    padding: 12px 14px;
    margin-top: 10px;
    page-break-inside: avoid;
    box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1);
  }}

  .directive-box h3 {{
    color: #2dd4bf;
    font-size: 10pt;
    font-weight: 700;
    margin-bottom: 8px;
    display: flex;
    align-items: center;
    gap: 6px;
  }}

  .directive-item {{
    display: flex;
    align-items: flex-start;
    gap: 8px;
    margin-bottom: 6px;
    font-size: 8.5pt;
    line-height: 1.4;
    color: #e2e8f0;
  }}

  .directive-num {{
    background: #0d9488;
    color: white;
    font-weight: 700;
    font-size: 7.5pt;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    margin-top: 1px;
  }}

  /* Page Footer */
  .doc-footer {{
    margin-top: 16px;
    padding-top: 8px;
    border-top: 1px solid #e2e8f0;
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 7.5pt;
    color: #64748b;
  }}

  .page-break {{
    page-break-after: always;
  }}
</style>
</head>
<body>

  <!-- HEADER -->
  <header class="doc-header">
    <div class="header-left">
      {"<img src='" + logo_b64 + "' class='header-logo' alt='Valem'>" if logo_b64 else ""}
      <div class="header-title-box">
        <h1>Catálogo & Base de Conhecimento</h1>
        <p>Valem Válvulas e Embalagens — Especificação Técnica Oficial para IA Valentina</p>
      </div>
    </div>
    <div class="header-badge">
      Doc Técnico Oficial<br>
      <span style="font-weight:400; opacity: 0.9;">Versão 2.1 • Multi-Tenant</span>
    </div>
  </header>

  <!-- 1. VISÃO GERAL -->
  <section class="section">
    <div class="section-title">
      <span class="section-icon">🏢</span>
      <span>1. Visão Geral da Empresa</span>
    </div>
    <div class="card highlight">
      <p class="card-body">
        A <strong>Valem Válvulas e Embalagens</strong> é especialista no fornecimento de soluções completas em embalagens, válvulas dosadoras, frascos, potes e acessórios para indústrias, farmácias de manipulação, marcas de cosméticos, perfumaria, higiene e limpeza.
      </p>
      <p class="card-body" style="margin-top: 6px;">
        <strong>Modelo de Fornecimento:</strong> Oferecemos conjuntos completos (frasco + válvula/tampa) ou itens avulsos. Atendemos desde pequenos lotes até grandes volumes industriais com fornecimento recorrente e pronta-entrega.
      </p>
    </div>
  </section>

  <!-- 2. LINHA DE FRASCOS E RECIPIENTES -->
  <section class="section">
    <div class="section-title">
      <span class="section-icon">🧴</span>
      <span>2. Linha de Frascos e Recipientes</span>
    </div>

    <h4 style="font-size: 9pt; font-weight: 700; color: #334155; margin-bottom: 6px;">2.1 Materiais Disponíveis</h4>
    <div class="card-grid-3" style="margin-bottom: 10px;">
      <div class="card">
        <div class="card-title"><span class="badge-tag teal">PET</span> Polietileno Tereftalato</div>
        <div class="card-body">Leve, transparente, alta resistência a impactos e excelente apresentação visual. Ideal para cosméticos, sabonetes, aromatizadores e bebidas.</div>
      </div>
      <div class="card">
        <div class="card-title"><span class="badge-tag teal">PEAD</span> Alta Densidade</div>
        <div class="card-body">Opaco/Translúcido, altamente resistente a químicos, solventes e óleos. Utilizado em linhas de limpeza, agro, automotivo e farmacêutico.</div>
      </div>
      <div class="card">
        <div class="card-title"><span class="badge-tag amber">Vidro</span> Linha Nobre</div>
        <div class="card-body">Perfumaria fina, óleos essenciais, séruns e farmácia de manipulação. Alta barreira contra oxidação e acabamento luxuoso.</div>
      </div>
      <div class="card">
        <div class="card-title"><span class="badge-tag">Alumínio</span> Linha Premium</div>
        <div class="card-body">Ecológico, 100% reciclável e leve. Ideal para desodorantes, aromatizadores, cosméticos e produtos sustentáveis.</div>
      </div>
      <div class="card">
        <div class="card-title"><span class="badge-tag purple">Acrílico</span> Alto Padrão</div>
        <div class="card-body">Design com parede espessa e visual sofisticado imitando cristal para cosméticos de luxo e cremes faciais.</div>
      </div>
      <div class="card">
        <div class="card-title"><span class="badge-tag">PP</span> Polipropileno</div>
        <div class="card-body">Resistência térmica e mecânica. Muito utilizado para potes de cremes, máscaras capilares e tampas com rosca.</div>
      </div>
    </div>

    <h4 style="font-size: 9pt; font-weight: 700; color: #334155; margin-bottom: 6px;">2.2 Formatos, Capacidades e Cores</h4>
    <div class="card-grid-3">
      <div class="card">
        <div class="card-title">📦 Formatos e Modelos</div>
        <div class="card-body">
          • <strong>Cilíndricos e Ovais:</strong> Universal p/ loções e sabonetes.<br>
          • <strong>Conta-Gotas:</strong> Frascos p/ séruns e óleos.<br>
          • <strong>Airless:</strong> Vácuo sem canudo, 100% aproveitamento.<br>
          • <strong>Potes:</strong> Cosméticos e industriais (PET/PP/Vidro).<br>
          • <strong>Bisnagas:</strong> Plásticas e de alumínio flexíveis.
        </div>
      </div>
      <div class="card">
        <div class="card-title">📏 Capacidades / Volumetrias</div>
        <div class="card-body">
          • <strong>Pequenas:</strong> 10ml, 15ml, 30ml, 50ml, 60ml.<br>
          • <strong>Médias:</strong> 100ml, 120ml, 150ml, 200ml, 250ml, 300ml.<br>
          • <strong>Grandes:</strong> 500ml, 750ml, 1000ml (1 Litro).<br>
          <span style="font-size: 7.5pt; color: #0d9488; font-weight: 600;">Ampla variedade de moldes prontos.</span>
        </div>
      </div>
      <div class="card">
        <div class="card-title">🎨 Cores Disponíveis</div>
        <div class="card-body">
          • <strong>Transparente / Cristal:</strong> Máxima visibilidade.<br>
          • <strong>Âmbar:</strong> Proteção UV p/ fotossensíveis.<br>
          • <strong>Branco Leitoso & Preto Fosco/Opaco.</strong><br>
          • <strong>Cobalto (Azul) & Verde:</strong> Sob consulta.
        </div>
      </div>
    </div>
  </section>

  <!-- 3. LINHA DE VÁLVULAS E DISPENSADORES -->
  <section class="section">
    <div class="section-title">
      <span class="section-icon">🎛️</span>
      <span>3. Linha de Válvulas e Dispensadores</span>
    </div>

    <div class="card-grid-2">
      <div class="card">
        <div class="card-title">🧴 Válvulas Pump (Creme / Loção / Sabonete)</div>
        <div class="card-body">
          <strong>Aplicação:</strong> Dosagem precisa de líquidos viscosos, cremes, sabonete líquido, álcool em gel e loções.<br>
          <strong>Modelos:</strong> Pump Gota, Pump Creme, Pump Trava no Bico (Open/Close).<br>
          <strong>Roscas Padrão:</strong> <code>20/410</code>, <code>24/410</code>, <code>28/410</code>.
        </div>
      </div>
      <div class="card">
        <div class="card-title">💨 Válvulas Spray & Borrifadores</div>
        <div class="card-body">
          <strong>Spray Fino:</strong> Pulverização em névoa fina e uniforme (perfumes, água termal, body splash, aromatizadores).<br>
          <strong>Borrifador Contínuo (Flairosol):</strong> Névoa contínua ultra-fina sem gás propelente.<br>
          <strong>Mini Gatilho (Trigger):</strong> Trava de segurança lateral, ideal para limpeza, pet e automotivo.
        </div>
      </div>
      <div class="card">
        <div class="card-title">🫧 Válvulas Espumadoras (Foamer)</div>
        <div class="card-body">
          <strong>Aplicação:</strong> Transforma sabonetes e soluções aquosas em espuma rica e aveludada instantaneamente sem propulsores.<br>
          <strong>Uso típico:</strong> Higienizadores faciais, sabonete para mãos e espumas de barbear.
        </div>
      </div>
      <div class="card">
        <div class="card-title">🧪 Válvulas Especiais & Farmacêuticas</div>
        <div class="card-body">
          <strong>Válvula Recrave:</strong> Alumínio recravado em vidro para perfumaria fina.<br>
          <strong>Nasal / Sublingual:</strong> Pulverização direcionada para medicamentos líquidos.<br>
          <strong>Tampas Conta-Gotas:</strong> Bulbo silicone + cânula de vidro para dosagem gota a gota.
        </div>
      </div>
    </div>
  </section>

  <!-- 4 & 5. TAMPAS E ACABAMENTOS -->
  <section class="section">
    <div class="card-grid-2">
      <div>
        <div class="section-title">
          <span class="section-icon">🔘</span>
          <span>4. Tampas & Fechamento</span>
        </div>
        <div class="card">
          <div class="card-body">
            • <strong>Flip Top:</strong> Tampa com dobradiça prática para dosagem rápida.<br>
            • <strong>Disc Top:</strong> Pressione de um lado para abrir a fenda.<br>
            • <strong>Rosca Simples:</strong> Plástico (PP) ou alumínio vedante.<br>
            • <strong>Lacre de Segurança:</strong> Garantia total de inviolabilidade.
          </div>
        </div>
      </div>

      <div>
        <div class="section-title">
          <span class="section-icon">✨</span>
          <span>5. Linhas Especiais & Luxo</span>
        </div>
        <div class="card">
          <div class="card-body">
            • <strong>Linha Bamboo (Eco-Friendly):</strong> Revestimento em bambu natural para sustentabilidade e elegância natural.<br>
            • <strong>Linha Luxo Metalizada:</strong> Acabamento dourado polido/fosco, prateado e rosê gold com padrão estético premium.
          </div>
        </div>
      </div>
    </div>
  </section>

  <!-- 6. SEGMENTOS ATENDIDOS -->
  <section class="section">
    <div class="section-title">
      <span class="section-icon">🎯</span>
      <span>6. Segmentos de Mercado Atendidos</span>
    </div>
    <div class="card-grid-4">
      <div class="card">
        <div class="card-title">💄 Cosméticos & Skin Care</div>
        <div class="card-body">Séruns, cremes, tônicos faciais, hidratantes, sabonetes e xampus.</div>
      </div>
      <div class="card">
        <div class="card-title">🌸 Perfumaria & Aromas</div>
        <div class="card-body">Perfumaria fina, home spray, difusores e óleos essenciais.</div>
      </div>
      <div class="card">
        <div class="card-title">🏥 Higiene & Hospitalar</div>
        <div class="card-body">Álcool em gel, sabonetes cirúrgicos e saneantes hospitalares.</div>
      </div>
      <div class="card">
        <div class="card-title">🐾 Agro, Pet & Auto</div>
        <div class="card-body">Banho e tosa pet, fertilizantes foliares, cera líquida e limpa-vidros.</div>
      </div>
    </div>
  </section>

  <!-- 7. DIRETRIZES DA IA VALENTINA -->
  <section class="section">
    <div class="directive-box">
      <h3>
        <span>🤖</span>
        <span>7. Diretrizes Operacionais de Atendimento da IA Valentina</span>
      </h3>
      <div class="directive-item">
        <div class="directive-num">1</div>
        <div><strong>Reconhecimento Ativo de Produtos:</strong> Quando o cliente perguntar se a Valem possui determinado frasco, tampa, válvula ou enviar uma foto/vídeo, confirme expressamente e com entusiasmo que a Valem trabalha com essa linha e tem pronta disponibilidade.</div>
      </div>
      <div class="directive-item">
        <div class="directive-num">2</div>
        <div><strong>Identificação Visual de Fotos:</strong> Ao receber foto de um frasco ou válvula, a IA identifica o modelo técnico exato (ex: <em>"Frasco PET cilíndrico com Válvula Pump Creme"</em>) e já informa as opções de cores e volumetrias disponíveis.</div>
      </div>
      <div class="directive-item">
        <div class="directive-num">3</div>
        <div><strong>Condução Comercial Objetiva:</strong> Sempre colete a volumetria desejada (ex: 100ml, 250ml, 500ml), a quantidade aproximada e o CNPJ da empresa para gerar a proposta comercial e realizar a transição fluida para ligação ou vendedor sênior.</div>
      </div>
    </div>
  </section>

  <!-- FOOTER -->
  <footer class="doc-footer">
    <div><strong>Valem Válvulas e Embalagens</strong> • Documento de Conhecimento Técnico & SDR</div>
    <div>Plataforma Valem Chat • Gerado em Alta Definição</div>
  </footer>

</body>
</html>
"""

with open(output_html, "w", encoding="utf-8") as f:
    f.write(html_content)

print(f"HTML salvo em: {output_html}")

# Executable search
edge_exe = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
chrome_exe = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
browser_exe = chrome_exe if os.path.exists(chrome_exe) else edge_exe

cmd = [
    browser_exe,
    "--headless=new",
    "--disable-gpu",
    "--no-pdf-header-footer",
    f"--print-to-pdf={output_pdf_1}",
    output_html
]

print(f"Executando comando de renderizacao de PDF...")
res = subprocess.run(cmd, capture_output=True, text=True)
print(f"Status: {res.returncode}")

if os.path.exists(output_pdf_1):
    print(f"PDF 1 gerado com sucesso: {output_pdf_1} ({os.path.getsize(output_pdf_1)} bytes)")
    
    # Copy to the other target directories
    import shutil
    shutil.copy2(output_pdf_1, output_pdf_2)
    print(f"Copiado para: {output_pdf_2}")
    
    shutil.copy2(output_pdf_1, output_pdf_3)
    print(f"Copiado para: {output_pdf_3}")
else:
    print("Falha ao gerar o PDF.")
    print("Stderr:", res.stderr)

import { getAiPersona } from "../ai-persona";
import { MARKETING_SECTOR_LABELS } from "./crm-attribution";

export type ApiEntryKind = "rest" | "mcp" | "webhook";
export type ApiHttpMethod = "GET" | "POST" | "MCP" | "WS";

export interface ApiParamDoc {
  name: string;
  location: "query" | "header" | "body" | "path" | "argument";
  type: string;
  required?: boolean;
  defaultValue?: string;
  description: string;
  example?: string;
}

export interface ApiFieldDoc {
  name: string;
  type: string;
  description: string;
}

export interface ApiPlaygroundDefaultParam {
  key: string;
  label: string;
  placeholder: string;
  defaultValue: string;
}

export interface ApiCatalogEntry {
  id: string;
  kind: ApiEntryKind;
  categoryLabel: string;
  method: ApiHttpMethod;
  pathOrTool: string;
  title: string;
  shortSummary: string;
  detailedExplanation: string;
  useCases: string[];
  businessRules?: string[];
  params: ApiParamDoc[];
  responseFields: ApiFieldDoc[];
  sampleRequestPayload?: Record<string, unknown> | null;
  sampleResponsePayload: Record<string, unknown>;
  supportsLivePlayground: boolean;
  playgroundParams?: ApiPlaygroundDefaultParam[];
  mcpToolName?: string;
  mcpDefaultArgs?: Record<string, unknown>;
}

export function maskApiToken(token: string): string {
  if (!token || token.length <= 14) return "••••••••••••";
  return `${token.slice(0, 10)}••••••••••••••••${token.slice(-4)}`;
}

export function buildEnvSnippet(params: {
  tenantId: string;
  baseUrl: string;
  token: string;
}): string {
  const prefix = params.tenantId === "valem" ? "VALEM" : "TECFAG";
  return [
    `# Arquivo .env local (NUNCA versionar em config.json ou Git)`,
    `${prefix}_CRM_API_URL=${params.baseUrl.replace(/\/+$/, "")}`,
    `${prefix}_CRM_API_TOKEN=${params.token}`,
  ].join("\n");
}

export function buildCurlSnippet(params: {
  entry: ApiCatalogEntry;
  baseUrl: string;
  token: string;
  queryString?: string;
}): string {
  const cleanBase = params.baseUrl.replace(/\/+$/, "");

  if (params.entry.kind === "rest") {
    const qs = params.queryString ? `?${params.queryString}` : "";
    return [
      `curl -X GET "${cleanBase}${params.entry.pathOrTool}${qs}" \\`,
      `  -H "Authorization: Bearer ${params.token}" \\`,
      `  -H "Accept: application/json"`,
    ].join("\n");
  }

  if (params.entry.kind === "mcp") {
    const rpcBody = JSON.stringify(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: params.entry.mcpToolName || params.entry.pathOrTool,
          arguments: params.entry.mcpDefaultArgs || {},
        },
      },
      null,
      2,
    );
    return [
      `curl -X POST "${cleanBase}/api/mcp" \\`,
      `  -H "Authorization: Bearer ${params.token}" \\`,
      `  -H "Content-Type: application/json" \\`,
      `  -d '${rpcBody}'`,
    ].join("\n");
  }

  // Webhook
  const sampleBody = JSON.stringify(params.entry.sampleRequestPayload || {}, null, 2);
  if (params.entry.method === "WS") {
    return `# Conexão WebSocket do Widget do Site:\nwscat -c "${cleanBase.replace(/^http/, "ws")}${params.entry.pathOrTool}?tenantId=${encodeURIComponent("seu_tenant")}&cookieId=vis_12345"`;
  }
  return [
    `curl -X POST "${cleanBase}${params.entry.pathOrTool}" \\`,
    `  -H "Content-Type: application/json" \\`,
    `  -d '${sampleBody}'`,
  ].join("\n");
}

export function buildPythonSnippet(params: {
  entry: ApiCatalogEntry;
  tenantId: string;
  baseUrl: string;
  token: string;
  useEnvVars?: boolean;
}): string {
  const prefix = params.tenantId === "valem" ? "VALEM" : "TECFAG";
  const cleanBase = params.baseUrl.replace(/\/+$/, "");

  const authBlock = params.useEnvVars
    ? [
        `import os`,
        `import requests`,
        ``,
        `BASE_URL = os.environ["${prefix}_CRM_API_URL"].rstrip("/")`,
        `TOKEN = os.environ["${prefix}_CRM_API_TOKEN"]`,
        `HEADERS = {"Authorization": f"Bearer {TOKEN}", "Accept": "application/json"}`,
      ].join("\n")
    : [
        `import requests`,
        ``,
        `BASE_URL = "${cleanBase}"`,
        `HEADERS = {"Authorization": "Bearer ${params.token}", "Accept": "application/json"}`,
      ].join("\n");

  if (params.entry.kind === "rest") {
    const isPaginated = params.entry.params.some((p) => p.name === "cursor");
    if (!isPaginated) {
      return [
        authBlock,
        ``,
        `resp = requests.get(f"{BASE_URL}${params.entry.pathOrTool}", headers=HEADERS, timeout=30)`,
        `resp.raise_for_status()`,
        `dados = resp.json()`,
        `print("Total retornado:", len(dados.get("items", dados.get("endpoints", []))))`,
      ].join("\n");
    }

    return [
      authBlock,
      ``,
      `def puxar_todas_paginas(params_iniciais: dict | None = None) -> list[dict]:`,
      `    itens: list[dict] = []`,
      `    query = {"limit": 1000, **(params_iniciais or {})}`,
      `    while True:`,
      `        resp = requests.get(`,
      `            f"{BASE_URL}${params.entry.pathOrTool}",`,
      `            headers=HEADERS,`,
      `            params=query,`,
      `            timeout=60,`,
      `        )`,
      `        resp.raise_for_status()`,
      `        payload = resp.json()`,
      `        itens.extend(payload.get("items", []))`,
      `        pag = payload.get("pagination", {})`,
      `        if not pag.get("has_more") or not pag.get("next_cursor"):`,
      `            break`,
      `        query["cursor"] = pag["next_cursor"]`,
      `    return itens`,
      ``,
      `registros = puxar_todas_paginas({"updated_since": "2026-11-01"})`,
      `print(f"Total extraído: {len(registros)} registros")`,
    ].join("\n");
  }

  if (params.entry.kind === "mcp") {
    const toolName = params.entry.mcpToolName || params.entry.pathOrTool;
    const argsJson = JSON.stringify(params.entry.mcpDefaultArgs || {}, null, 8);
    return [
      authBlock,
      `import json`,
      ``,
      `payload = {`,
      `    "jsonrpc": "2.0",`,
      `    "id": 1,`,
      `    "method": "tools/call",`,
      `    "params": {`,
      `        "name": "${toolName}",`,
      `        "arguments": ${argsJson}`,
      `    }`,
      `}`,
      `resp = requests.post(f"{BASE_URL}/api/mcp", headers=HEADERS, json=payload, timeout=30)`,
      `resp.raise_for_status()`,
      `conteudo = resp.json()["result"]["content"][0]["text"]`,
      `print(json.loads(conteudo))`,
    ].join("\n");
  }

  return [
    `import requests`,
    ``,
    `# Exemplo de envio de evento Webhook`,
    `url = "${cleanBase}${params.entry.pathOrTool}"`,
    `payload = ${JSON.stringify(params.entry.sampleRequestPayload || {}, null, 4)}`,
    `resp = requests.post(url, json=payload, timeout=15)`,
    `print(resp.status_code, resp.text)`,
  ].join("\n");
}

export function buildNodeSnippet(params: {
  entry: ApiCatalogEntry;
  tenantId: string;
  baseUrl: string;
  token: string;
}): string {
  const prefix = params.tenantId === "valem" ? "VALEM" : "TECFAG";
  const cleanBase = params.baseUrl.replace(/\/+$/, "");

  if (params.entry.kind === "rest") {
    return [
      `const BASE_URL = process.env.${prefix}_CRM_API_URL ?? "${cleanBase}";`,
      `const TOKEN = process.env.${prefix}_CRM_API_TOKEN ?? "${params.token}";`,
      ``,
      `const res = await fetch(\`\${BASE_URL}${params.entry.pathOrTool}?limit=200\`, {`,
      `  method: "GET",`,
      `  headers: {`,
      `    Authorization: \`Bearer \${TOKEN}\`,`,
      `    Accept: "application/json",`,
      `  },`,
      `});`,
      `if (!res.ok) throw new Error(\`HTTP \${res.status}: \${await res.text()}\`);`,
      `const data = await res.json();`,
      `console.log("Registros:", data.items?.length ?? data);`,
    ].join("\n");
  }

  if (params.entry.kind === "mcp") {
    const toolName = params.entry.mcpToolName || params.entry.pathOrTool;
    return [
      `const BASE_URL = process.env.${prefix}_CRM_API_URL ?? "${cleanBase}";`,
      `const TOKEN = process.env.${prefix}_CRM_API_TOKEN ?? "${params.token}";`,
      ``,
      `const res = await fetch(\`\${BASE_URL}/api/mcp\`, {`,
      `  method: "POST",`,
      `  headers: {`,
      `    Authorization: \`Bearer \${TOKEN}\`,`,
      `    "Content-Type": "application/json",`,
      `  },`,
      `  body: JSON.stringify({`,
      `    jsonrpc: "2.0",`,
      `    id: 1,`,
      `    method: "tools/call",`,
      `    params: {`,
      `      name: "${toolName}",`,
      `      arguments: ${JSON.stringify(params.entry.mcpDefaultArgs || {})},`,
      `    },`,
      `  }),`,
      `});`,
      `const rpc = await res.json();`,
      `console.log(JSON.parse(rpc.result.content[0].text));`,
    ].join("\n");
  }

  return [
    `// Envio HTTP POST para o Webhook`,
    `const res = await fetch("${cleanBase}${params.entry.pathOrTool}", {`,
    `  method: "POST",`,
    `  headers: { "Content-Type": "application/json" },`,
    `  body: JSON.stringify(${JSON.stringify(params.entry.sampleRequestPayload || {}, null, 2)}),`,
    `});`,
    `console.log(res.status, await res.json());`,
  ].join("\n");
}

/**
 * Constrói o catálogo completo da Biblioteca de API contextualizado dinamicamente
 * para o `tenantId` logado (nunca mistura personas ou exemplos entre tenants).
 */
export function getApiLibraryCatalog(tenantId: string): ApiCatalogEntry[] {
  const persona = getAiPersona(tenantId);
  const isValem = tenantId === "valem";
  const sampleProduct = isValem ? "Válvula Spray 24/410 Preta" : "Envasadora Pastosa Automática";
  const sampleCompany = isValem ? "Cosméticos Bela Vida LTDA" : "Indústria Alimentícia Alfa LTDA";
  const sampleFunnel = isValem ? "FUNIL COMERCIAL" : "FUNIL CWR";
  const sampleForm = isValem
    ? "LP | Cotação Atacado Válvulas"
    : "CRM | Form Meta - Envasadora";

  const commonPaginationParams: ApiParamDoc[] = [
    {
      name: "limit",
      location: "query",
      type: "integer (1..1000)",
      defaultValue: "200",
      description: "Quantidade máxima de registros por página (use 1000 em rotinas Python em lote).",
      example: "1000",
    },
    {
      name: "cursor",
      location: "query",
      type: "string (base64url)",
      description: "Cursor opaco retornado em `pagination.next_cursor` para avançar sem pular ou duplicar linhas.",
      example: "eyJ0IjoiMjAyNi0xMS0xNlQxMjowMDowMC4wMDBaIiwiaWQiOiJkZWFsLTEyMyJ9",
    },
    {
      name: "updated_since",
      location: "query",
      type: "ISO 8601 | YYYY-MM-DD",
      description: "Extração incremental: retorna apenas registros criados ou atualizados a partir desta data/hora.",
      example: "2026-11-01",
    },
  ];

  return [
    // ═══════════════════════════════════════════════════════════════════════════
    // 1. API REST (/api/v1/marketing/*)
    // ═══════════════════════════════════════════════════════════════════════════
    {
      id: "rest-index",
      kind: "rest",
      categoryLabel: "API REST · Dados & Relatórios",
      method: "GET",
      pathOrTool: "/api/v1/marketing/",
      title: "Catálogo & Health-Check da API",
      shortSummary: "Valida o token Bearer ativo, confirma o tenant isolado e retorna o dicionário oficial de setores e rotas.",
      detailedExplanation:
        "Ideal para ser chamado no início de scripts automatizados (health-check) antes de iniciar extrações pesadas. Confirma qual chave individual autenticou a requisição, o `tenant_id` vinculado no servidor e a tabela fechada de setores oficiais.",
      useCases: [
        "Validar se a variável de ambiente do `.env` está autenticando com `200 OK`",
        "Obter dinamicamente a lista oficial de setores (`sectors_dictionary`) e limites padrão",
      ],
      params: [
        {
          name: "Authorization",
          location: "header",
          type: "Bearer <TOKEN>",
          required: true,
          description: "Token de integração escopado na empresa atual.",
        },
      ],
      responseFields: [
        { name: "service", type: "string", description: "Identificador fixo do serviço (`crm-marketing-api`)." },
        { name: "tenant_id", type: "string", description: "Empresa autenticada pelo token." },
        { name: "authenticated_key", type: "string", description: "Nome da chave individual utilizada." },
        { name: "sectors_dictionary", type: "object", description: "Mapa código -> rótulo legível dos setores oficiais." },
        { name: "endpoints", type: "array", description: "Lista de todas as rotas REST disponíveis." },
      ],
      sampleResponsePayload: {
        service: "crm-marketing-api",
        version: "1.0.0",
        tenant_id: tenantId,
        authenticated_key: "Marketing - Scripts 09h",
        sectors_dictionary: MARKETING_SECTOR_LABELS,
        defaults: {
          include_tests: false,
          include_legacy: true,
          messages_metadata_only: true,
          default_limit: 200,
          max_limit: 1000,
        },
      },
      supportsLivePlayground: true,
      playgroundParams: [],
    },
    {
      id: "rest-deals",
      kind: "rest",
      categoryLabel: "API REST · Dados & Relatórios",
      method: "GET",
      pathOrTool: "/api/v1/marketing/deals",
      title: "Negociações (Cards, Vendas, UTMs & Setores)",
      shortSummary: "Base completa de negociações compatível com colunas do RD/Kondado, chaves de cruzamento, UTMs e regra única de venda.",
      detailedExplanation:
        "Entrega todas as negociações da empresa para cálculo de CPL, Taxa de Qualificação, ROAS por campanha, faturamento por setor e cruzamento com o ERP. Já exclui automaticamente cards de teste (`is_test = false`) e preserva os cards históricos migrados (`is_legacy = true`) com `id_rd` preenchido.",
      useCases: [
        "Dashboard executivo diário, relatório semanal/mensal e cruzamento Investimento × Faturamento (ROAS)",
        "Conciliação de notas fiscais do ERP via `id_rd` ('Link CRM'), `organization_cnpj`, `contacts_emails` ou `contacts_phones_last9`",
        "Análise de origem de mídia (`deal_source_name`) separada do ponto de conversão (`campaign_name`) e da campanha paga (`utm_campaign`)",
      ],
      businessRules: [
        "Regra Única de Venda (`win = true`): considera tanto `status = 'won'` quanto cards com `status = 'open'` posicionados nas etapas comerciais `FECHAMENTO` ou `VENDA CONCLUÍDA` (excluindo etapas administrativas de Suporte/Financeiro).",
        "Setor Imutável (`sector_origin`) vs. Atual (`sector_current`): nasce `pre_venda` no SDR e trava permanentemente no 1º setor comercial definitivo (`semi_industrial`, `personnalite`, `projetos`, `pecas`).",
        "Taxonomia `deal_source_name`: padronizada igual ao RD (`Busca Paga | Google`, `Busca Paga | Meta`, `Busca Paga | Mercado Livre`, etc.); rótulos operacionais (`manual`, `whatsapp`) ficam isolados em `entry_channel`.",
      ],
      params: [
        ...commonPaginationParams,
        { name: "created_from / created_to", location: "query", type: "YYYY-MM-DD | ISO", description: "Filtra pela data de criação do card (fuso America/Sao_Paulo).", example: "2026-11-01" },
        { name: "won_from / won_to", location: "query", type: "YYYY-MM-DD | ISO", description: "Filtra pela data de ganho/fechamento (`win_at`).", example: "2026-11-01" },
        { name: "win", location: "query", type: "boolean", description: "Se `true`, retorna apenas vendas efetivas (regra única de venda).", example: "true" },
        { name: "sector_origin", location: "query", type: "string", description: "Filtra pelo setor de origem travado (`semi_industrial`, `personnalite`, `projetos`, `pecas`, `pre_venda`)." },
        { name: "sector_current", location: "query", type: "string", description: "Filtra pelo setor atual da negociação." },
        { name: "source", location: "query", type: "string", description: "Busca parcial em `deal_source_name` / `utm_source` (ex.: `Busca Paga | Meta`)." },
        { name: "campaign", location: "query", type: "string", description: "Busca parcial no ponto de conversão (`campaign_name`)." },
        { name: "utm_campaign", location: "query", type: "string", description: "Busca parcial na campanha da mídia (`utm_campaign`)." },
        { name: "id_rd", location: "query", type: "string", description: "Busca exata pelo ID legado do RD Station CRM." },
        { name: "include_tests", location: "query", type: "boolean", defaultValue: "false", description: "Quando `false` (padrão), exclui automaticamente cards de teste." },
        { name: "include_legacy", location: "query", type: "boolean", defaultValue: "true", description: "Quando `true` (padrão), mantém o arquivo histórico do RD para batimento Jan–Out." },
      ],
      responseFields: [
        { name: "id / id_rd", type: "string | null", description: "ID interno do card e ID original do RD Station CRM (`id_rd`)." },
        { name: "name / amount_total", type: "string / number", description: "Título da negociação e valor total numérico em BRL." },
        { name: "deal_stage_pipeline_name / deal_stage_name", type: "string", description: "Nome do funil atual e etapa atual (ex.: `FUNIL CWR` / `FECHAMENTO`)." },
        { name: "original_pipeline_name", type: "string", description: "Funil em que o card nasceu antes de qualquer transferência." },
        { name: "win / win_at / lost_at", type: "boolean / ISO | null", description: "Indicador canônico de venda ganha e datas exatas de ganho/perda." },
        { name: "deal_source_name", type: "string | null", description: "Origem de mídia no padrão RD (`Busca Paga | Google`, `Busca Paga | Meta`, etc.)." },
        { name: "campaign_name", type: "string | null", description: "Ponto de conversão (formulário/LP/CTWA), separado de `utm_campaign`." },
        { name: "entry_channel", type: "string | null", description: "Porta técnica de entrada (`rd_webhook`, `whatsapp`, `whatsapp_sdr`, `site_chat`, `manual`, `import_rd`)." },
        { name: "utm_source..utm_term / click_id", type: "string | null", description: "Parâmetros UTM brutos e ID de clique (`gclid`, `fbclid`, `ctwa_clid`)." },
        { name: "sector_origin / sector_current", type: "string", description: "Setor imutável de origem comercial e setor atual." },
        { name: "organization_name / organization_cnpj", type: "string | null", description: "Razão social e CNPJ/CPF apenas dígitos para cruzamento direto com o ERP." },
        { name: "contacts_emails / contacts_phones_last9", type: "string[]", description: "E-mails deduplicados e últimos 9 dígitos dos telefones para match com Base RD e WhatsApp." },
        { name: "cliente_novo / products / custom_fields", type: "any / array / object", description: "Campo 'Cliente novo?', itens orçados e campos personalizados traduzidos pelo nome." },
      ],
      sampleResponsePayload: {
        tenant_id: tenantId,
        items: [
          {
            id: "deal-1794840012-x9k2",
            id_rd: null,
            name: `${sampleProduct} - ${sampleCompany}`,
            created_at: "2026-11-16T12:10:00.000Z",
            updated_at: "2026-11-16T15:30:00.000Z",
            amount_total: 148500.0,
            currency: "BRL",
            organization_name: sampleCompany,
            organization_cnpj: "12345678000199",
            deal_stage_pipeline_name: sampleFunnel,
            deal_stage_name: "FECHAMENTO",
            status: "open",
            win: true,
            win_at: "2026-11-16T15:30:00.000Z",
            lost: false,
            lost_at: null,
            deal_source_name: "Busca Paga | Meta",
            campaign_name: sampleForm,
            entry_channel: "rd_webhook",
            utm_source: "ig",
            utm_medium: "paid_social",
            utm_campaign: "meta_q4_conversao",
            sector_origin: "semi_industrial",
            sector_current: "semi_industrial",
            contacts_emails: ["compras@empresaexemplo.com.br"],
            contacts_phones_last9: ["991234567"],
            is_legacy: false,
            is_test: false,
          },
        ],
        pagination: {
          limit: 200,
          returned_count: 1,
          has_more: false,
          next_cursor: null,
        },
      },
      supportsLivePlayground: true,
      playgroundParams: [
        { key: "limit", label: "Limite (limit)", placeholder: "5", defaultValue: "5" },
        { key: "order", label: "Ordem (asc / desc)", placeholder: "desc", defaultValue: "desc" },
        { key: "win", label: "Apenas vendas (win)", placeholder: "true ou vazio", defaultValue: "" },
        { key: "sector_current", label: "Setor atual", placeholder: "ex: semi_industrial", defaultValue: "" },
        { key: "updated_since", label: "Atualizado desde", placeholder: "YYYY-MM-DD", defaultValue: "" },
      ],
    },
    {
      id: "rest-stage-history",
      kind: "rest",
      categoryLabel: "API REST · Dados & Relatórios",
      method: "GET",
      pathOrTool: "/api/v1/marketing/deal-stage-history",
      title: "Histórico Linear de Etapas (Funil)",
      shortSummary: "Linha do tempo contínua (start_date, end_date, duration_seconds) de cada etapa percorrida por cada card.",
      detailedExplanation:
        "Reconstrói todos os intervalos de permanência em cada etapa e funil desde `deal.created_at` até o momento atual (ou data de fechamento), filtrando apenas eventos reais de transição de etapa/funil — totalmente imune ao volume de eventos `conversation_action` do chat.",
      useCases: [
        "Diagnóstico de gargalos do funil (tempo médio parado em Qualificação, Proposta ou Negociação)",
        "Cálculo de taxa de passagem etapa a etapa por coorte ou campanha",
      ],
      params: [
        ...commonPaginationParams,
        { name: "deal_id", location: "query", type: "string", description: "Filtra o histórico de uma negociação específica." },
        { name: "pipeline_id", location: "query", type: "string", description: "Filtra negociações atualmente em um funil específico." },
        { name: "sector_origin / sector_current", location: "query", type: "string", description: "Filtra por setor de origem ou atual." },
      ],
      responseFields: [
        { name: "deal_id / id_rd", type: "string | null", description: "ID da negociação e ID original no RD." },
        { name: "sequence", type: "integer", description: "Ordem cronológica da passagem (1, 2, 3...)." },
        { name: "pipeline_name / stage_name", type: "string", description: "Nome do funil e nome da etapa naquele intervalo." },
        { name: "start_date / end_date", type: "ISO | null", description: "Início e fim exatos da permanência na etapa." },
        { name: "duration_seconds", type: "integer", description: "Tempo total em segundos dentro da etapa." },
        { name: "is_current", type: "boolean", description: "Indica se o card ainda está aberto nesta etapa." },
      ],
      sampleResponsePayload: {
        tenant_id: tenantId,
        items: [
          {
            id: "hist:deal-1794840012-x9k2:0",
            sequence: 1,
            deal_id: "deal-1794840012-x9k2",
            id_rd: null,
            pipeline_name: "FUNIL SDR",
            stage_name: "EM TRIAGEM",
            sector: "pre_venda",
            start_date: "2026-11-16T12:10:00.000Z",
            end_date: "2026-11-16T12:25:00.000Z",
            duration_seconds: 900,
            is_current: false,
          },
        ],
        pagination: { limit: 250, returned_count: 1, has_more: false, next_cursor: null },
      },
      supportsLivePlayground: true,
      playgroundParams: [
        { key: "limit", label: "Limite de cards", placeholder: "5", defaultValue: "5" },
        { key: "deal_id", label: "ID da Negociação (opcional)", placeholder: "deal-...", defaultValue: "" },
      ],
    },
    {
      id: "rest-contacts",
      kind: "rest",
      categoryLabel: "API REST · Dados & Relatórios",
      method: "GET",
      pathOrTool: "/api/v1/marketing/contacts",
      title: "Contatos (Leads & Chaves de Cruzamento)",
      shortSummary: "Base de leads com e-mails, múltiplos telefones (últimos 9 dígitos), CPF/CNPJ e atribuição imutável de 1º toque.",
      detailedExplanation:
        "Retorna todos os contatos cadastrados com suas chaves prontas para cruzamento com a Base RD Station Marketing (e-mail ou últimos 9 dígitos do WhatsApp em `phones_last9`) e com o ERP (`cnpj_cpf`), além da primeira origem capturada na entrada do lead (`first_source`, `first_campaign`, `utm_*`).",
      useCases: [
        "Cruzamento de leads gerados em formulários/anúncios com conversas de WhatsApp e vendas no ERP",
        "Auditoria de primeiro toque (`first_source`) e setor inicial (`sector_origin`) de cada lead",
      ],
      params: [
        ...commonPaginationParams,
        { name: "email", location: "query", type: "string", description: "Busca exata por endereço de e-mail." },
        { name: "phone", location: "query", type: "string", description: "Busca pelos últimos 9 dígitos em `contacts` e `contact_phones`." },
        { name: "document", location: "query", type: "string", description: "Busca por CPF ou CNPJ (com ou sem pontuação)." },
        { name: "q", location: "query", type: "string", description: "Busca textual livre por nome, e-mail, telefone ou empresa." },
      ],
      responseFields: [
        { name: "id / name", type: "string", description: "Identificador e nome do contato." },
        { name: "email / emails", type: "string | string[]", description: "E-mail principal normalizado em minúsculas." },
        { name: "phones / phones_last9", type: "string[]", description: "Todos os telefones do contato e sufixos de 9 dígitos para pareamento WhatsApp." },
        { name: "cnpj_cpf", type: "string | null", description: "Documento consolidado (CNPJ ou CPF apenas números)." },
        { name: "first_source / first_campaign", type: "string | null", description: "Origem padrão RD e ponto de conversão do 1º toque." },
        { name: "deal_ids / conversation_ids", type: "string[]", description: "IDs das negociações e conversas ligadas a este contato." },
      ],
      sampleResponsePayload: {
        tenant_id: tenantId,
        items: [
          {
            id: "cnt-998877",
            name: "Carlos Comprador",
            email: "carlos@empresaexemplo.com.br",
            emails: ["carlos@empresaexemplo.com.br"],
            phones: ["5516991234567"],
            phones_last9: ["991234567"],
            cnpj_cpf: "12345678000199",
            first_source: "Busca Paga | Google",
            first_campaign: sampleForm,
            sector_origin: "semi_industrial",
            deal_ids: ["deal-1794840012-x9k2"],
            conversation_ids: ["conv-abc123"],
          },
        ],
        pagination: { limit: 200, returned_count: 1, has_more: false, next_cursor: null },
      },
      supportsLivePlayground: true,
      playgroundParams: [
        { key: "limit", label: "Limite", placeholder: "5", defaultValue: "5" },
        { key: "q", label: "Busca (nome/email/tel)", placeholder: "Ex: ind", defaultValue: "" },
      ],
    },
    {
      id: "rest-conversations",
      kind: "rest",
      categoryLabel: "API REST · Dados & Relatórios",
      method: "GET",
      pathOrTool: "/api/v1/marketing/conversations",
      title: "Conversas & Indicadores de SLA em Massa",
      shortSummary: "Métricas prontas do mês inteiro: tempo de 1ª resposta do bot e humana, % sem resposta, % só bot e vínculo com cards.",
      detailedExplanation:
        "Consolida para cada conversa a contagem de mensagens por autor (`client`, `bot`, `human`), os carimbos e tempos em segundos da 1ª resposta automática e da 1ª resposta humana, além das flags `only_bot` e `is_unanswered` para diagnósticos mensais de atendimento sem precisar baixar o texto das mensagens.",
      useCases: [
        "Cálculo mensal de Tempo Médio de 1ª Resposta Humana, % de leads sem resposta e % atendidos apenas pelo bot",
        "Identificação de leads parados sem retorno com `hours_since_last_client_message`",
      ],
      params: [
        ...commonPaginationParams,
        { name: "queue_state", location: "query", type: "string", description: "Filtra pela fila atual (`automacao`, `fila`, `meus`, `finalizados`)." },
        { name: "operator_id / sector_id", location: "query", type: "string", description: "Filtra por operador responsável ou setor." },
        { name: "created_from / created_to", location: "query", type: "YYYY-MM-DD", description: "Filtra pela data de abertura da conversa." },
      ],
      responseFields: [
        { name: "first_bot_response_seconds", type: "integer | null", description: "Segundos entre a 1ª mensagem do cliente e a 1ª resposta da IA." },
        { name: "first_human_response_seconds", type: "integer | null", description: "Segundos entre a 1ª mensagem do cliente e a 1ª resposta de um operador humano." },
        { name: "only_bot", type: "boolean", description: "`true` quando houve interação do cliente e do bot, mas 0 mensagens humanas." },
        { name: "is_unanswered", type: "boolean", description: "`true` quando o cliente enviou mensagem e não recebeu resposta nem do bot nem humana." },
        { name: "linked_deal_ids", type: "string[]", description: "Cards do CRM vinculados a esta conversa." },
      ],
      sampleResponsePayload: {
        tenant_id: tenantId,
        items: [
          {
            id: "conv-abc123",
            contact_name: "Carlos Comprador",
            contact_phone_last9: "991234567",
            operator_name: "Consultor Comercial",
            queue_state: "meus",
            linked_deal_ids: ["deal-1794840012-x9k2"],
            client_msg_count: 6,
            bot_msg_count: 4,
            human_msg_count: 8,
            first_bot_response_seconds: 12,
            first_human_response_seconds: 185,
            only_bot: false,
            is_unanswered: false,
          },
        ],
        pagination: { limit: 200, returned_count: 1, has_more: false, next_cursor: null },
      },
      supportsLivePlayground: true,
      playgroundParams: [
        { key: "limit", label: "Limite", placeholder: "5", defaultValue: "5" },
        { key: "queue_state", label: "Fila (queue_state)", placeholder: "meus, fila, automacao...", defaultValue: "" },
      ],
    },
    {
      id: "rest-messages",
      kind: "rest",
      categoryLabel: "API REST · Dados & Relatórios",
      method: "GET",
      pathOrTool: "/api/v1/marketing/messages",
      title: "Mensagens em Massa (Metadados por Padrão)",
      shortSummary: "Extração rápida de eventos de mensagem sem corpo de texto por padrão (metadata_only=true), ideal para volumetria e curvas de SLA.",
      detailedExplanation:
        "Para permitir que scripts automatizados puxem dezenas de milhares de mensagens de um mês inteiro em poucos segundos, esta rota omite o texto (`content`) por padrão e devolve apenas metadados (`sent_at`, `sender_type`, `direction`, `char_length`, `has_media`, `marketing_attribution`). Se precisar do texto completo, passe `?include_content=true`.",
      useCases: [
        "Cálculo de tempo de resposta turno a turno e volume diário/horário de mensagens",
        "Extração de atribuição de anúncios Click-to-WhatsApp (`marketing_attribution`) por mensagem",
      ],
      params: [
        ...commonPaginationParams,
        { name: "conversation_id", location: "query", type: "string", description: "Filtra mensagens de uma conversa específica." },
        { name: "sent_from / sent_to", location: "query", type: "YYYY-MM-DD | ISO", description: "Janela de envio da mensagem." },
        { name: "sender_type", location: "query", type: "string", description: "Filtra por autor (`client`, `bot`, `operator`, `system`)." },
        { name: "include_content", location: "query", type: "boolean", defaultValue: "false", description: "Passe `true` somente quando precisar do texto das mensagens." },
      ],
      responseFields: [
        { name: "metadata_only", type: "boolean", description: "Confirma se o corpo de texto foi omitido (`true` por padrão)." },
        { name: "sent_at / sender_type / direction", type: "ISO / string", description: "Data/hora exata, tipo do remetente e direção (`inbound`/`outbound`)." },
        { name: "char_length / has_media / media_type", type: "int / bool / string", description: "Tamanho do texto e tipo de mídia anexada (`audio`, `image`, `document`, `video`)." },
        { name: "marketing_attribution", type: "object | null", description: "Dados de anúncio CTWA ou UTM do site quando presentes na mensagem de entrada." },
      ],
      sampleResponsePayload: {
        tenant_id: tenantId,
        metadata_only: true,
        items: [
          {
            id: "msg-001",
            conversation_id: "conv-abc123",
            contact_id: "cnt-998877",
            linked_deal_ids: ["deal-1794840012-x9k2"],
            sent_at: "2026-11-16T12:09:10.000Z",
            sender_type: "client",
            direction: "inbound",
            provider: "meta",
            has_media: false,
            char_length: 42,
            marketing_attribution: {
              source: "Busca Paga | Meta",
              campaign: "CTWA | Campanha Industrial",
            },
          },
        ],
        pagination: { limit: 500, returned_count: 1, has_more: false, next_cursor: null },
      },
      supportsLivePlayground: true,
      playgroundParams: [
        { key: "limit", label: "Limite", placeholder: "5", defaultValue: "5" },
        { key: "include_content", label: "Incluir texto (true/false)", placeholder: "false", defaultValue: "false" },
      ],
    },
    {
      id: "rest-activities",
      kind: "rest",
      categoryLabel: "API REST · Dados & Relatórios",
      method: "GET",
      pathOrTool: "/api/v1/marketing/activities",
      title: "Atividades Comerciais (Tarefas, Ligações & Notas)",
      shortSummary: "Lista em massa todas as tarefas agendadas, ligações, reuniões e anotações comerciais com flag automática de atraso (`is_overdue`).",
      detailedExplanation:
        "Antes visível apenas pelo navegador, agora disponível em massa via API paginada. Permite auditar disciplina comercial de follow-up, tarefas vencidas por consultor/setor e histórico de anotações e conclusões.",
      useCases: [
        "Monitoramento de follow-ups parados ou tarefas atrasadas (`is_overdue = true`) por vendedor",
        "Auditoria de quantidade de toques comerciais (ligações, reuniões e notas) antes de ganhar ou perder um card",
      ],
      params: [
        ...commonPaginationParams,
        { name: "type", location: "query", type: "string", description: "Filtra por tipo (`task`, `call`, `meeting`, `note`)." },
        { name: "status", location: "query", type: "string", description: "Filtra por status (`pending`, `completed`, `cancelled`)." },
        { name: "deal_id / operator_id", location: "query", type: "string", description: "Filtra por card ou por operador responsável." },
      ],
      responseFields: [
        { name: "type / status", type: "string", description: "Tipo da atividade e estado atual." },
        { name: "due_date / completed_at / is_overdue", type: "ISO | bool", description: "Prazo agendado, data de conclusão e indicador se está vencida." },
        { name: "description / completion_note", type: "string | null", description: "Descrição da atividade/nota e observação registrada ao concluir." },
      ],
      sampleResponsePayload: {
        tenant_id: tenantId,
        items: [
          {
            id: "act-8812",
            deal_id: "deal-1794840012-x9k2",
            type: "task",
            title: "Retornar sobre aprovação da proposta",
            status: "pending",
            due_date: "2026-11-15T14:00:00.000Z",
            is_overdue: true,
            assigned_to_name: "Consultor Comercial",
          },
        ],
        pagination: { limit: 250, returned_count: 1, has_more: false, next_cursor: null },
      },
      supportsLivePlayground: true,
      playgroundParams: [
        { key: "limit", label: "Limite", placeholder: "5", defaultValue: "5" },
        { key: "status", label: "Status (pending/completed)", placeholder: "pending", defaultValue: "" },
      ],
    },
    {
      id: "rest-triages",
      kind: "rest",
      categoryLabel: "API REST · Dados & Relatórios",
      method: "GET",
      pathOrTool: "/api/v1/marketing/triages",
      title: `Triagens da IA SDR (${persona.name})`,
      shortSummary: `Ciclos estruturados de qualificação automática do assistente ${persona.name}: etapa, desfecho, funil recomendado, vendedor sorteado e dados coletados.`,
      detailedExplanation: `Entrega os ciclos da tabela \`agent_flow_states\` para medir taxa de conclusão da triagem automática (${persona.name}), tempo de qualificação, distribuição por subfluxo/funil de destino e respostas coletadas do lead.`,
      useCases: [
        `Medir quantos leads concluíram a triagem com ${persona.name} vs. pararam sem responder`,
        "Cruzar dados coletados na triagem (equipamento/produto, perfil do cliente) com a conversão em vendas",
      ],
      params: [
        ...commonPaginationParams,
        { name: "outcome", location: "query", type: "string", description: "Filtra pelo desfecho (`transferred`, `completed`, `abandoned`)." },
        { name: "started_from / started_to", location: "query", type: "YYYY-MM-DD", description: "Filtra pela data de início da triagem." },
      ],
      responseFields: [
        { name: "monitoring_state / outcome", type: "string | null", description: "Estado operacional consolidado e desfecho da triagem." },
        { name: "target_funnel / allocated_operator_name", type: "string | null", description: "Funil decidido pela triagem e consultor que recebeu o handoff." },
        { name: "duration_seconds / collected_data", type: "int / object", description: "Duração da triagem e objeto JSON com as respostas extraídas." },
      ],
      sampleResponsePayload: {
        tenant_id: tenantId,
        items: [
          {
            id: "afs-1029",
            conversation_id: "conv-abc123",
            contact_name: "Carlos Comprador",
            monitoring_state: "transferred",
            outcome: "transferred",
            target_funnel: sampleFunnel,
            allocated_operator_name: "Consultor Comercial",
            duration_seconds: 145,
            collected_data: { interest: sampleProduct },
          },
        ],
        pagination: { limit: 200, returned_count: 1, has_more: false, next_cursor: null },
      },
      supportsLivePlayground: true,
      playgroundParams: [
        { key: "limit", label: "Limite", placeholder: "5", defaultValue: "5" },
      ],
    },
    {
      id: "rest-goals",
      kind: "rest",
      categoryLabel: "API REST · Dados & Relatórios",
      method: "GET",
      pathOrTool: "/api/v1/marketing/goals",
      title: "Metas Mensais por Consultor & Dias Úteis",
      shortSummary: "Metas de faturamento e taxa de conversão por vendedor/setor + calendário oficial de dias úteis e pacing do mês.",
      detailedExplanation:
        "Fornece aos dashboards diários e mensais a meta individual de cada consultor (`target_value`), a soma consolidada por setor (`totals_by_sector`) e o cálculo exato de dias úteis corridos e restantes considerando feriados cadastrados em `commercial_calendar_days`.",
      useCases: [
        "Comparar faturamento realizado × meta mensal e meta proporcional ao dia útil (`pacing_ratio`)",
      ],
      params: [
        { name: "month", location: "query", type: "YYYY-MM | 'all'", defaultValue: "Mês atual (BRT)", description: "Mês de competência (ex.: `2026-11`) ou `all` para histórico completo.", example: "2026-11" },
        { name: "division", location: "query", type: "string", description: "Filtra pela divisão comercial (`maquinas`, `personnalite`)." },
      ],
      responseFields: [
        { name: "total_target_value / totals_by_sector", type: "number / object", description: "Soma geral das metas do mês e subtotal por setor." },
        { name: "business_calendar", type: "object", description: "`total_business_days`, `elapsed_business_days`, `remaining_business_days` e `pacing_ratio`." },
        { name: "items", type: "array", description: "Lista de metas individuais por consultor (`user_id`, `user_name`, `sector`, `target_value`)." },
      ],
      sampleResponsePayload: {
        tenant_id: tenantId,
        month: "2026-11",
        total_target_value: 2500000,
        totals_by_sector: { semi_industrial: 1400000, personnalite: 1100000 },
        business_calendar: {
          month: "2026-11",
          total_business_days: 19,
          elapsed_business_days: 10,
          remaining_business_days: 9,
          pacing_ratio: 0.5263,
        },
        items: [
          {
            user_name: "Consultor Comercial",
            sector: "semi_industrial",
            target_value: 350000,
            conversion_rate_target: 12,
          },
        ],
      },
      supportsLivePlayground: true,
      playgroundParams: [
        { key: "month", label: "Mês (YYYY-MM)", placeholder: "2026-11", defaultValue: "2026-11" },
      ],
    },
    {
      id: "rest-audit-batch",
      kind: "rest",
      categoryLabel: "API REST · Dados & Relatórios",
      method: "GET",
      pathOrTool: "/api/v1/marketing/audit-batch",
      title: "Auditoria Qualitativa em Lote (15–50 Leads)",
      shortSummary: "Atalho completo para auditoria de campanhas: traz em 1 chamada o card, histórico de etapas, atividades, triagem e transcrição do chat.",
      detailedExplanation:
        "Projetado especificamente para auditorias qualitativas de atendimento (lotes de 15 a 50 leads por campanha, formulário ou período). Evita dezenas de chamadas sequenciais ao entregar o dossiê completo de cada lead pronto para análise humana ou por IA.",
      useCases: [
        "Auditar 20 leads de um formulário específico (`campaign`) para entender por que qualificaram ou perderam",
        "Avaliar aderência de discurso comercial e velocidade de abordagem em campanhas de tráfego pago",
      ],
      params: [
        { name: "limit", location: "query", type: "integer (1..50)", defaultValue: "20", description: "Quantidade de negociações no lote (máximo 50)." },
        { name: "campaign", location: "query", type: "string", description: "Filtra pelo ponto de conversão (`campaign_name`)." },
        { name: "utm_campaign", location: "query", type: "string", description: "Filtra pela campanha de mídia (`utm_campaign`)." },
        { name: "source", location: "query", type: "string", description: "Filtra pela origem (`deal_source_name`)." },
        { name: "deal_ids", location: "query", type: "csv string", description: "Lista opcional de IDs separados por vírgula (`deal-1,deal-2`)." },
        { name: "created_from / created_to", location: "query", type: "YYYY-MM-DD", description: "Janela de criação dos leads." },
      ],
      responseFields: [
        { name: "batch_size", type: "integer", description: "Quantidade de dossiês retornados no lote." },
        { name: "items[].deal", type: "object", description: "Objeto completo da negociação (mesmo formato de `/deals`)." },
        { name: "items[].stage_history", type: "array", description: "Linha do tempo de etapas da negociação." },
        { name: "items[].activities", type: "array", description: "Tarefas, ligações e notas registradas no card." },
        { name: "items[].conversations", type: "array", description: "Conversas vinculadas contendo `triages` e transcrição `messages`." },
      ],
      sampleResponsePayload: {
        tenant_id: tenantId,
        batch_size: 1,
        items: [
          {
            deal: { id: "deal-1794840012-x9k2", name: sampleProduct, deal_source_name: "Busca Paga | Meta" },
            stage_history: [{ sequence: 1, stage_name: "QUALIFICANDO", duration_seconds: 900 }],
            activities: [],
            conversations: [
              {
                conversation_id: "conv-abc123",
                triages: [{ outcome: "transferred" }],
                messages: [{ sender_type: "client", content: `Olá, gostaria de cotar ${sampleProduct}` }],
              },
            ],
          },
        ],
      },
      supportsLivePlayground: true,
      playgroundParams: [
        { key: "limit", label: "Tamanho do lote (máx 50)", placeholder: "3", defaultValue: "3" },
        { key: "source", label: "Origem (source)", placeholder: "Ex: Busca Paga", defaultValue: "" },
      ],
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // 2. CONECTOR MCP (/api/mcp — JSON-RPC 2.0 / SSE)
    // ═══════════════════════════════════════════════════════════════════════════
    {
      id: "mcp-search-deals",
      kind: "mcp",
      categoryLabel: "Conector MCP · Ferramentas de IA",
      method: "MCP",
      pathOrTool: "search_crm_deals",
      mcpToolName: "search_crm_deals",
      mcpDefaultArgs: { limit: 5, status: "closed_won_effective" },
      title: "MCP · search_crm_deals",
      shortSummary: "Pesquisa interativa de negociações para assistentes de IA (Claude, Antigravity, Cursor, ChatGPT) com 100% de paridade com `/api/v1/marketing/deals`.",
      detailedExplanation:
        "Ferramenta chamada pela IA via protocolo MCP (`POST /api/mcp` `tools/call`) para responder perguntas pontuais sobre vendas, funis, origens, setores ou carteira de vendedores. Compartilha exatamente a mesma regra única de venda e ocultação de testes da API REST.",
      useCases: [
        "Perguntar à IA: 'Quais foram as maiores vendas de Busca Paga | Google nesta semana?'",
        "Localizar rapidamente cards por CNPJ, nome da empresa, `id_rd` ou motivo de perda",
      ],
      params: [
        { name: "query", location: "argument", type: "string", description: "Texto livre (título, empresa, CNPJ, `id_rd` ou motivo de perda)." },
        { name: "status", location: "argument", type: "enum", description: "`open`, `won`, `lost`, `paused` ou `closed_won_effective` (vendas efetivas)." },
        { name: "sectorOrigin / sectorCurrent", location: "argument", type: "string", description: "Filtra por setor de origem ou atual." },
        { name: "source / campaign / utmCampaign", location: "argument", type: "string", description: "Filtra por origem de mídia, ponto de conversão ou campanha UTM." },
        { name: "createdFrom / createdTo / wonFrom / wonTo", location: "argument", type: "YYYY-MM-DD", description: "Filtros de período de criação ou fechamento." },
        { name: "limit", location: "argument", type: "number (1..100)", defaultValue: "25", description: "Máximo de cards retornados." },
      ],
      responseFields: [
        { name: "returnedCount", type: "integer", description: "Total de cards retornados na chamada." },
        { name: "deals", type: "array", description: "Lista de cards com `id`, `id_rd`, `win`, `winAt`, `sectorOrigin`, `sectorCurrent`, `deal_source_name`, `campaign_name` e `account`." },
      ],
      sampleResponsePayload: {
        tenantId,
        returnedCount: 1,
        deals: [
          {
            id: "deal-1794840012-x9k2",
            title: `${sampleProduct} - ${sampleCompany}`,
            value: 148500,
            win: true,
            sectorOrigin: "semi_industrial",
            deal_source_name: "Busca Paga | Meta",
          },
        ],
      },
      supportsLivePlayground: true,
      playgroundParams: [
        { key: "limit", label: "limit", placeholder: "5", defaultValue: "5" },
        { key: "status", label: "status", placeholder: "closed_won_effective, open...", defaultValue: "closed_won_effective" },
        { key: "query", label: "query", placeholder: "Busca opcional", defaultValue: "" },
      ],
    },
    {
      id: "mcp-deal-details",
      kind: "mcp",
      categoryLabel: "Conector MCP · Ferramentas de IA",
      method: "MCP",
      pathOrTool: "get_crm_deal_details",
      mcpToolName: "get_crm_deal_details",
      mcpDefaultArgs: { dealId: "informe_um_deal_id" },
      title: "MCP · get_crm_deal_details",
      shortSummary: "Ficha 360º completa de uma negociação: card, UTMs, Receita Federal da empresa, contatos, produtos, propostas, `stageHistory` limpo e conversas.",
      detailedExplanation:
        "Inspeciona profundamente um único card pelo seu `dealId`. Inclui o array dedicado `stageHistory` (reconstruído sem interferência de `conversation_action`), campos personalizados traduzidos e todos os contatos e conversas associados.",
      useCases: [
        "Pedir para a IA: 'Abra o card deal-xyz e resuma quanto tempo ele levou em cada etapa e o que foi orçado'",
      ],
      params: [
        { name: "dealId", location: "argument", type: "string", required: true, description: "ID da negociação (`crm_deals.id`)." },
      ],
      responseFields: [
        { name: "deal / account / contacts", type: "object / array", description: "Dados completos do card, empresa (com quadro Receita Federal) e contatos." },
        { name: "stageHistory", type: "array", description: "Histórico linear completo de etapas com `start_date`, `end_date` e `duration_seconds`." },
        { name: "products / proposals / recentActivities / linkedConversations", type: "array", description: "Itens de produto, propostas comerciais, atividades e chats vinculados." },
      ],
      sampleResponsePayload: {
        tenantId,
        deal: { id: "deal-1794840012-x9k2", title: sampleProduct, win: true, sectorOrigin: "semi_industrial" },
        stageHistory: [{ sequence: 1, stage_name: "PROPOSTA", duration_seconds: 86400 }],
        contacts: [],
        products: [],
      },
      supportsLivePlayground: true,
      playgroundParams: [
        { key: "dealId", label: "dealId (obrigatório)", placeholder: "Ex: deal-...", defaultValue: "" },
      ],
    },
    {
      id: "mcp-audit-batch",
      kind: "mcp",
      categoryLabel: "Conector MCP · Ferramentas de IA",
      method: "MCP",
      pathOrTool: "get_marketing_audit_batch",
      mcpToolName: "get_marketing_audit_batch",
      mcpDefaultArgs: { limit: 3 },
      title: "MCP · get_marketing_audit_batch",
      shortSummary: "Auditoria em lote (15–50 leads) direto no cliente MCP da IA com card + etapas + triagem + mensagens.",
      detailedExplanation:
        "Versão MCP espelhada sobre o mesmo motor de `GET /api/v1/marketing/audit-batch`, permitindo que a IA audite um lote inteiro de leads de uma campanha em uma única chamada de ferramenta.",
      useCases: [
        "Pedir no Claude/Antigravity: 'Audite os últimos 15 leads da campanha Form Meta - Envasadora e classifique a qualidade do atendimento'",
      ],
      params: [
        { name: "campaign / utmCampaign / source", location: "argument", type: "string", description: "Filtros de ponto de conversão, campanha de mídia ou origem." },
        { name: "createdFrom / createdTo", location: "argument", type: "YYYY-MM-DD", description: "Período de entrada dos leads." },
        { name: "limit", location: "argument", type: "number (1..50)", defaultValue: "20", description: "Quantidade de leads no lote." },
      ],
      responseFields: [
        { name: "batch_size / items", type: "int / array", description: "Lote consolidado de negociações com `stage_history`, `activities` e `conversations`." },
      ],
      sampleResponsePayload: {
        tenant_id: tenantId,
        batch_size: 3,
        items: [{ deal: { id: "deal-1" }, stage_history: [], conversations: [] }],
      },
      supportsLivePlayground: true,
      playgroundParams: [
        { key: "limit", label: "limit", placeholder: "2", defaultValue: "2" },
        { key: "source", label: "source", placeholder: "Opcional", defaultValue: "" },
      ],
    },
    {
      id: "mcp-sales-metrics",
      kind: "mcp",
      categoryLabel: "Conector MCP · Ferramentas de IA",
      method: "MCP",
      pathOrTool: "get_sales_and_commercial_metrics",
      mcpToolName: "get_sales_and_commercial_metrics",
      mcpDefaultArgs: {},
      title: "MCP · get_sales_and_commercial_metrics",
      shortSummary: "Consolidado executivo em tempo real de Vendas, Metas, Pacing, Funis e Motivos de Perda (War Room).",
      detailedExplanation:
        "Retorna o retrato executivo consolidado do mês: receita ganha, pacing por dia útil, ranking de consultores, distribuição por funil e categorização de motivos de perda (já filtrando `is_test = false`).",
      useCases: [
        "Perguntar à IA: 'Como está o atingimento de meta e pacing comercial deste mês por divisão?'",
      ],
      params: [
        { name: "month", location: "argument", type: "YYYY-MM", defaultValue: "Mês atual", description: "Mês de referência." },
        { name: "division", location: "argument", type: "enum", defaultValue: "all", description: "`maquinas`, `personnalite` ou `all`." },
      ],
      responseFields: [
        { name: "summary / pacing / consultants / pipelines / lossReasons", type: "object / array", description: "Indicadores consolidados de vendas, metas e funil." },
      ],
      sampleResponsePayload: {
        tenantId,
        month: "2026-11",
        summary: { wonCount: 88, wonValue: 1361828.61 },
      },
      supportsLivePlayground: true,
      playgroundParams: [
        { key: "month", label: "month (YYYY-MM)", placeholder: "2026-11", defaultValue: "" },
      ],
    },
    {
      id: "mcp-triage-and-chat",
      kind: "mcp",
      categoryLabel: "Conector MCP · Ferramentas de IA",
      method: "MCP",
      pathOrTool: "get_fagner_triage_overview",
      mcpToolName: "get_fagner_triage_overview",
      mcpDefaultArgs: { limit: 10 },
      title: `MCP · Triagem (${persona.name}), Conversas & Rodízio`,
      shortSummary: `Conjunto de ferramentas MCP para inspecionar conversas (\`search_conversations\`, \`get_conversation_messages\`), triagens (\`get_fagner_triage_overview\`, \`get_fagner_triage_history\`), empresas/contatos e escala do rodízio (\`get_rodizio_and_operators_status\`).`,
      detailedExplanation: `Além das ferramentas de CRM, o mesmo endpoint \`/api/mcp\` expõe consulta em tempo real às filas de WhatsApp/Site, transcrição de conversas específicas, auditoria passo a passo do jornal de triagem de ${persona.name} e status online/folga dos operadores no rodízio.`,
      useCases: [
        "Verificar quem está parado na fila ou em triagem neste instante",
        "Ler a conversa completa de um cliente ou auditar por que o rodízio encaminhou um lead para determinado vendedor",
      ],
      params: [
        { name: "stateFilter", location: "argument", type: "string", description: "Filtro opcional (`collecting`, `ready`, `transferred`, `no_response`)." },
        { name: "limit", location: "argument", type: "number", defaultValue: "30", description: "Quantidade máxima de sessões." },
      ],
      responseFields: [
        { name: "summary / activeFlows", type: "object / array", description: "Resumo por estado operacional e lista detalhada de triagens recentes." },
      ],
      sampleResponsePayload: {
        tenantId,
        summary: { totalFlows: 42, transferred: 31, collecting: 4 },
      },
      supportsLivePlayground: true,
      playgroundParams: [
        { key: "limit", label: "limit", placeholder: "5", defaultValue: "5" },
      ],
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // 3. WEBHOOKS DE ENTRADA (POST / WS)
    // ═══════════════════════════════════════════════════════════════════════════
    {
      id: "webhook-rd-marketing",
      kind: "webhook",
      categoryLabel: "Webhooks de Entrada · Tempo Real",
      method: "POST",
      pathOrTool: "/api/webhooks/rd-marketing/:token",
      title: "Webhook · RD Station Marketing (Conversões & Fluxos)",
      shortSummary: "Recebe leads convertidos em formulários/LPs do RD Station Marketing, cria/vincula Contato + Empresa + Card no CRM com idempotência e separa Ponto de Conversão de UTMs.",
      detailedExplanation:
        "Cada fluxo configurado na aba 'RD Station' das Configurações possui seu próprio `:token` secreto na URL. Ao receber um POST do RD Station (formato clássico `leads[]` ou webhook v2 de Automação), o sistema deduplica por evento/lead, extrai `deal_source_name` no padrão RD, grava o Ponto de Conversão em `campaign` e salva `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`, `click_id` e `landing_page` tanto no Contato (1º toque) quanto no Card.",
      useCases: [
        "Entrada automática de formulários Meta Lead Ads, Google Ads Landing Pages e Pop-ups integrados ao RD Marketing",
      ],
      params: [
        { name: "token", location: "path", type: "string", required: true, description: "Token único gerado ao criar um Fluxo na aba Configurações -> RD Station." },
        { name: "leads", location: "body", type: "array", required: true, description: "Array de leads enviado pelo webhook do RD Station Marketing." },
      ],
      responseFields: [
        { name: "status", type: "string", description: "`processed` quando processado, `duplicate` quando já recebido anteriormente." },
        { name: "results", type: "array", description: "Status individual de cada lead do lote (`created`, `duplicate`, `dealId`)." },
      ],
      sampleRequestPayload: {
        leads: [
          {
            uuid: "8f14e45f-ceea-467a-a8e5-000000000001",
            name: "Mariana Diretora",
            email: "mariana@industriaexemplo.com.br",
            mobile_phone: "+55 16 99234-5678",
            company: sampleCompany,
            last_conversion: {
              content: {
                identificador: sampleForm,
                traffic_source: "utm_source=google&utm_medium=cpc&utm_campaign=search_q4",
              },
              conversion_origin: {
                source: "Google",
                medium: "cpc",
                campaign: "search_q4",
              },
            },
          },
        ],
      },
      sampleResponsePayload: {
        status: "processed",
        results: [{ status: "created", dealId: "deal-1794849900-ab12" }],
      },
      supportsLivePlayground: false,
    },
    {
      id: "webhook-meta-whatsapp",
      kind: "webhook",
      categoryLabel: "Webhooks de Entrada · Tempo Real",
      method: "POST",
      pathOrTool: "/api/webhooks/meta",
      title: "Webhook · Meta Cloud API (WhatsApp Oficial & CTWA Ads)",
      shortSummary: "Recebe mensagens, mídias, recibos de entrega e cliques de anúncios Click-to-WhatsApp (`referral` / `ctwa_clid`) da Meta.",
      detailedExplanation:
        "Validado criptograficamente pelo header `X-Hub-Signature-256` (`App Secret`). Processa todas as `entry[]` e `changes[]` do lote oficial da Meta. Quando a mensagem de entrada contém o objeto `referral` de um anúncio Click-to-WhatsApp, extrai automaticamente `ctwa_clid`, `headline` e UTMs da `source_url`, gravando `Busca Paga | Meta` no primeiro toque do contato e propagando para qualquer negociação criada a partir da conversa.",
      useCases: [
        "Recepção oficial de WhatsApp Business Cloud API e rastreamento automático de campanhas Click-to-WhatsApp (Meta Ads)",
      ],
      params: [
        { name: "X-Hub-Signature-256", location: "header", type: "sha256=<hex>", required: true, description: "Assinatura HMAC-SHA256 gerada pela Meta com o App Secret." },
        { name: "entry[].changes[]", location: "body", type: "array", required: true, description: "Envelope padrão `whatsapp_business_account` da Meta Graph API." },
      ],
      responseFields: [
        { name: "received", type: "boolean", description: "Confirmação `200 OK` imediata para a fila da Meta." },
      ],
      sampleRequestPayload: {
        object: "whatsapp_business_account",
        entry: [
          {
            id: "WABA_ID",
            changes: [
              {
                field: "messages",
                value: {
                  metadata: { phone_number_id: "PHONE_NUMBER_ID" },
                  messages: [
                    {
                      id: "wamid.HBgNNTUxNjk5MTIzNDU2NxUCABIYFDNB",
                      from: "5516991234567",
                      type: "text",
                      text: { body: `Olá! Vi o anúncio sobre ${sampleProduct}` },
                      referral: {
                        source_type: "ad",
                        source_id: "12021099887766",
                        ctwa_clid: "ARAkLk998877",
                        headline: sampleProduct,
                        source_url: "https://site.exemplo.com.br?utm_source=ig&utm_medium=paid_social&utm_campaign=ctwa_nov",
                      },
                    },
                  ],
                },
              },
            ],
          },
        ],
      },
      sampleResponsePayload: { received: true },
      supportsLivePlayground: false,
    },
    {
      id: "webhook-livechat-ws",
      kind: "webhook",
      categoryLabel: "Webhooks de Entrada · Tempo Real",
      method: "WS",
      pathOrTool: "/ws/livechat",
      title: "WebSocket · Widget do Site / Loja Online (siteContext & UTMs)",
      shortSummary: "Canal bidirecional em tempo real do widget web com captura automática de URL de entrada, UTMs, `gclid`/`fbclid` e produto visualizado.",
      detailedExplanation:
        "Conecta o visitante da loja virtual / site institucional diretamente ao atendimento e à triagem automática. No primeiro envio (`siteContext`), extrai os parâmetros UTM e IDs de clique (`gclid` / `fbclid`) da página de entrada do visitante e grava o primeiro toque no contato para atribuição automática no CRM.",
      useCases: [
        "Atendimento online no site/e-commerce com captura nativa de produto consultado e campanha Google/Meta de entrada",
      ],
      params: [
        { name: "tenantId", location: "query", type: "string", required: true, description: "Identificador da empresa no snippet do widget." },
        { name: "cookieId", location: "query", type: "string", required: true, description: "Identificador persistente da sessão do visitante no navegador." },
      ],
      responseFields: [
        { name: "type", type: "string", description: "Eventos em tempo real (`CONNECTED`, `CHAT_REPLY`, `pageview_recorded`)." },
      ],
      sampleRequestPayload: {
        type: "PRODUCT_INQUIRY",
        messageId: "inq_1794849900",
        siteContext: {
          entry: {
            url: "https://loja.exemplo.com.br/produto?utm_source=google&utm_medium=cpc&utm_campaign=shopping_nov&gclid=Cj0KCQ",
            referrer: "https://www.google.com/",
          },
          product: {
            name: sampleProduct,
            url: "https://loja.exemplo.com.br/produto",
          },
        },
      },
      sampleResponsePayload: {
        type: "CONNECTED",
        visitorId: "vis_991122",
        chatId: "chat_334455",
      },
      supportsLivePlayground: false,
    },
  ];
}

/**
 * sdr-crm-auto.ts
 * Automação de Criação e Vínculo de Card no RD Station CRM quando a SDR Valentina conclui uma triagem.
 * Replicando a arquitetura robusta de buscas do Tecfag I.A Faggner (rdCrmService.ts):
 * - Busca de Empresa por Nome exato, primeira palavra e CNPJ
 * - Busca de Contato por CPF/CNPJ e 4 variantes de Telefone (com/sem DDI, com/sem 9º dígito)
 * - Busca de Deal existente no RD CRM por Contact ID antes de tentar criar novo (evita duplicados)
 * - Envio de Nota na Timeline do Card (POST /deals/:id/notes)
 */

import { db } from "../../db";
import { contacts, conversations } from "../../db/schema";
import { eq } from "drizzle-orm";
import { rdRequest, isRdCrmConfigured, buildPhoneSearchTerms, getCachedUsers } from "../rdCrmService";

interface CreateCrmDealFromTriageOptions {
  tenantId: string;
  conversationId: string;
  contactPhone: string;
  collectedData: Record<string, any>;
  allocatedOperator?: {
    id?: string;
    name?: string;
    email?: string;
  };
}

const VALEM_FIELD_IDS = {
  qualificadoSdr: "696ba913a1aef400136910f7",
  projetosDesenvolvimento: "696bb0eb4d002d0014b3cd3e",
  tipoProduto: "696ba80ed2dcbf001474aaf9",
  infoComplementar: "696bd749b44b6d00179417a0",
  feitoPor: "69b1638eb0e1180014224ca3",
};

// ─── HELPER: Limpeza e Normalização de Nomes de Empresa ──────────────────────────────
function cleanName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, "")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .trim();
}

// ─── HELPER 1: Busca ou Criação Robusta de Organização no RD CRM ─────────────────────
async function findOrCreateOrganizationInCrm(
  tenantId: string,
  companyName: string,
  docDigits: string,
  ownerId?: string
): Promise<string | null> {
  if (!companyName || companyName.trim() === "" || companyName.startsWith("Cliente ")) {
    return null;
  }

  const targetClean = cleanName(companyName);

  // 1. Busca por Nome Exato
  try {
    const byFilterName = await rdRequest<any>(tenantId, "GET", `/organizations?filter=name:${encodeURIComponent(`"${companyName}"`)}&page[size]=20`);
    const listExato: any[] = Array.isArray(byFilterName) ? byFilterName : (Array.isArray(byFilterName?.data) ? byFilterName.data : []);
    const matchExato = listExato.find((o: any) => cleanName(o.name || "") === targetClean);
    if (matchExato) {
      console.log(`[RD CRM Auto] ✅ Organização existente encontrada (por nome exato): ${matchExato.id || matchExato._id} "${matchExato.name}"`);
      return matchExato.id || matchExato._id;
    }
  } catch (e: any) {
    console.warn(`[RD CRM Auto] Aviso ao buscar organização por nome exato:`, e.message);
  }

  // 2. Busca por Primeira Palavra
  const primeiraPalavra = companyName.split(" ")[0];
  if (primeiraPalavra && primeiraPalavra.length > 3) {
    try {
      const byFilterSub = await rdRequest<any>(tenantId, "GET", `/organizations?filter=name:~${encodeURIComponent(`"${primeiraPalavra}"`)}&page[size]=50`);
      const listSub: any[] = Array.isArray(byFilterSub) ? byFilterSub : (Array.isArray(byFilterSub?.data) ? byFilterSub.data : []);
      const matchSub = listSub.find((o: any) => cleanName(o.name || "") === targetClean);
      if (matchSub) {
        console.log(`[RD CRM Auto] ✅ Organização existente encontrada (por primeira palavra): ${matchSub.id || matchSub._id} "${matchSub.name}"`);
        return matchSub.id || matchSub._id;
      }
    } catch {}
  }

  // 3. Busca por CNPJ/CPF se houver documento
  if (docDigits) {
    try {
      const byCnpj = await rdRequest<any>(tenantId, "GET", `/organizations?filter=@cpf:${encodeURIComponent(`"${docDigits}"`)}&page[size]=20`);
      const cnpjList: any[] = Array.isArray(byCnpj) ? byCnpj : (Array.isArray(byCnpj?.data) ? byCnpj.data : []);
      if (cnpjList.length > 0) {
        console.log(`[RD CRM Auto] ✅ Organização existente encontrada (por CNPJ): ${cnpjList[0].id || cnpjList[0]._id} "${cnpjList[0].name}"`);
        return cnpjList[0].id || cnpjList[0]._id;
      }
    } catch {}
  }

  // 4. Se não existe, cria a nova Organização
  try {
    const createPayload: Record<string, any> = { name: companyName };
    if (ownerId) createPayload.user_id = ownerId;
    if (docDigits) createPayload.custom_fields = { cpf: docDigits };

    const orgRes = await rdRequest<any>(tenantId, "POST", "/organizations", createPayload);
    const orgId = orgRes?.id || orgRes?._id;
    if (orgId) {
      console.log(`[RD CRM Auto] ✅ Nova Organização criada no RD CRM: ${orgId} ("${companyName}")`);
      return orgId;
    }
  } catch (createErr: any) {
    console.warn(`[RD CRM Auto] ⚠️ Falha ao criar organização "${companyName}": ${createErr?.message || createErr}`);
    if (createErr?.message?.includes("cadastrad") || createErr?.message?.includes("422")) {
      try {
        const byFilterName = await rdRequest<any>(tenantId, "GET", `/organizations?filter=name:${encodeURIComponent(`"${companyName}"`)}&page[size]=20`);
        const list: any[] = Array.isArray(byFilterName) ? byFilterName : (Array.isArray(byFilterName?.data) ? byFilterName.data : []);
        if (list.length > 0) return list[0].id || list[0]._id;
      } catch {}
    }
  }

  return null;
}

// ─── HELPER 2: Upsert Robusto de Contato no RD CRM (Busca por CPF/CNPJ e 4 Variantes de Telefone) ───
async function upsertContactInCrm(
  tenantId: string,
  clientName: string,
  contactPhone: string,
  docDigits: string,
  organizationId?: string | null
): Promise<string | null> {
  const cleanPhone = contactPhone.replace(/\D/g, "");
  const hasDoc = docDigits.length === 11 || docDigits.length === 14;

  // 1. Buscar no CRM por CPF/CNPJ
  if (hasDoc) {
    try {
      const byDoc = await rdRequest<any[]>(tenantId, "GET", `/contacts?filter=@cpf_cnpj:${encodeURIComponent(docDigits)}`);
      const listDoc = Array.isArray(byDoc) ? byDoc : (Array.isArray((byDoc as any)?.data) ? (byDoc as any).data : []);
      if (listDoc.length > 0) {
        const existingId = listDoc[0].id || listDoc[0]._id;
        console.log(`[RD CRM Auto] ✅ Contato existente no CRM (por CPF/CNPJ ${docDigits}): ${existingId}`);
        const updatePayload: Record<string, any> = { name: clientName };
        if (organizationId) updatePayload.organization_id = organizationId;
        await rdRequest(tenantId, "PUT", `/contacts/${existingId}`, updatePayload).catch(() => null);
        return existingId;
      }
    } catch {}
  }

  // 2. Buscar no CRM por Telefone usando 4 variantes (com/sem DDI, com/sem 9º dígito)
  if (cleanPhone) {
    const phoneTerms = buildPhoneSearchTerms(cleanPhone);
    for (const term of phoneTerms) {
      try {
        const byPhone = await rdRequest<any[]>(tenantId, "GET", `/contacts?filter=phone:${encodeURIComponent(term)}`);
        const listPhone = Array.isArray(byPhone) ? byPhone : (Array.isArray((byPhone as any)?.data) ? (byPhone as any).data : []);
        if (listPhone.length > 0) {
          const existingId = listPhone[0].id || listPhone[0]._id;
          console.log(`[RD CRM Auto] ✅ Contato existente no CRM (por telefone variante "${term}"): ${existingId}`);
          const updatePayload: Record<string, any> = { name: clientName };
          if (organizationId) updatePayload.organization_id = organizationId;
          await rdRequest(tenantId, "PUT", `/contacts/${existingId}`, updatePayload).catch(() => null);
          return existingId;
        }
      } catch {}
    }
  }

  // 3. Criar Contato no CRM se não existir
  try {
    const contactPayload: Record<string, any> = {
      name: clientName,
      phones: cleanPhone ? [{ phone: cleanPhone }] : [],
    };
    if (hasDoc) contactPayload.custom_fields = { cpf_cnpj: docDigits };
    if (organizationId) contactPayload.organization_id = organizationId;

    const created = await rdRequest<any>(tenantId, "POST", "/contacts", contactPayload);
    const newContactId = created?.id || created?._id;
    if (newContactId) {
      console.log(`[RD CRM Auto] ✅ Novo Contato criado no RD CRM: ${newContactId}`);
      return newContactId;
    }
  } catch (cErr: any) {
    console.warn(`[RD CRM Auto] ⚠️ Falha ao criar contato no RD CRM:`, cErr?.message || cErr);
  }

  return null;
}

// ─── HELPER 3: Busca de Deal Ativo no CRM por Contact ID ─────────────────────────────
async function findExistingDealInCrm(
  tenantId: string,
  crmContactId: string
): Promise<string | null> {
  if (!crmContactId) return null;
  try {
    const rDeals = await rdRequest<any[]>(tenantId, "GET", `/deals?filter=contact_id:${crmContactId}`);
    const dealsList: any[] = Array.isArray(rDeals) ? rDeals : (Array.isArray((rDeals as any)?.data) ? (rDeals as any).data : []);
    if (dealsList.length > 0) {
      const ongoingDeal = dealsList.find((d: any) => d.status === "ongoing");
      const chosen = ongoingDeal || dealsList[0];
      const chosenId = chosen.id || chosen._id;
      console.log(`[RD CRM Auto] 🔍 Card ativo existente localizado no RD CRM para contato ${crmContactId}: ${chosenId}`);
      return chosenId;
    }
  } catch (e: any) {
    console.warn(`[RD CRM Auto] Aviso ao buscar deals por contact_id ${crmContactId}:`, e.message);
  }
  return null;
}

export async function autoCreateOrUpdateRdCrmDeal({
  tenantId,
  conversationId,
  contactPhone,
  collectedData,
  allocatedOperator,
}: CreateCrmDealFromTriageOptions): Promise<boolean> {
  console.log(`\n================================================================================`);
  console.log(`[RD CRM Auto] 🚀 INICIANDO AUTOMAÇÃO DE CRIAÇÃO/ATUALIZAÇÃO DE CARD NO RD CRM`);
  console.log(`[RD CRM Auto] Tenant: "${tenantId}" | ConversationId: "${conversationId}" | Phone: "${contactPhone}"`);
  console.log(`[RD CRM Auto] 📋 Dados Coletados na Triagem:`, JSON.stringify(collectedData, null, 2));

  try {
    // 1. Verificar se a integração com o RD CRM está configurada para este tenant
    console.log(`[RD CRM Auto] 🔑 Checando credenciais/tokens do RD CRM para tenant "${tenantId}"...`);
    const isConfigured = await isRdCrmConfigured(tenantId).catch((err) => {
      console.error(`[RD CRM Auto] ❌ Erro ao verificar se RD CRM está configurado:`, err?.message || err);
      return false;
    });

    console.log(`[RD CRM Auto] STATUS DA INTEGRAÇÃO: ${isConfigured ? "✅ CONFIGURADO E ATIVO" : "❌ NÃO CONFIGURADO (ou sem tokens de acesso)"}`);

    if (!isConfigured) {
      console.warn(`[RD CRM Auto] ⚠️ RD CRM não está configurado para o tenant "${tenantId}". Abortando criação de card.`);
      return false;
    }

    // 2. Buscar a conversa e o contato correspondente no banco local
    console.log(`[RD CRM Auto] 🔍 Buscando conversa "${conversationId}" no banco de dados local...`);
    const conv = await db.query.conversations.findFirst({
      where: (t, { eq: dEq }) => dEq(t.id, conversationId),
    });

    let contact: any = null;
    if (conv?.contactId) {
      const [foundContact] = await db
        .select()
        .from(contacts)
        .where(eq(contacts.id, conv.contactId));
      contact = foundContact;
    }

    if (!contact) {
      const cleanPhone = contactPhone.replace(/\D/g, "");
      const allContacts = await db
        .select()
        .from(contacts)
        .where(eq(contacts.tenantId, tenantId));

      contact = allContacts.find(
        (c) =>
          c.id === `c-${cleanPhone}` ||
          c.phone === contactPhone ||
          c.phone === cleanPhone ||
          (c.phone && c.phone.replace(/\D/g, "") === cleanPhone)
      );
    }

    if (!contact) {
      console.warn(`[RD CRM Auto] ⚠️ Nenhum contato encontrado no DB local para "${contactPhone}". Criando contato local...`);
      const cleanPhone = contactPhone.replace(/\D/g, "");
      const newContactId = `c-${cleanPhone}`;
      const timeNow = new Date();

      try {
        await db
          .insert(contacts)
          .values({
            id: newContactId,
            tenantId,
            name: collectedData["NOME COMPLETO"]?.value || `Cliente ${contactPhone}`,
            phone: contactPhone,
            createdAt: timeNow,
          })
          .onConflictDoNothing();

        const [created] = await db
          .select()
          .from(contacts)
          .where(eq(contacts.id, newContactId));

        contact = created;

        if (conv) {
          await db
            .update(conversations)
            .set({ contactId: newContactId })
            .where(eq(conversations.id, conversationId));
        }
      } catch (cErr: any) {
        console.error("[RD CRM Auto] Erro ao criar contato automaticamente:", cErr?.message);
      }
    }

    if (!contact) {
      console.error(`[RD CRM Auto] ❌ ERRO CRÍTICO: Não foi possível obter nem criar contato para "${contactPhone}". Abortando.`);
      return false;
    }

    // Sincronizar dados do contato local
    const nameVal = collectedData["NOME COMPLETO"]?.value;
    const cnpjCpfVal = collectedData["CNPJ OU CPF"]?.value;
    const contactUpdates: Record<string, any> = {};

    if (nameVal && typeof nameVal === "string" && nameVal.trim() !== "" && !nameVal.includes("Aguardando") && nameVal.trim() !== contact.name) {
      contactUpdates.name = nameVal.trim();
      contact.name = nameVal.trim();
    }

    if (cnpjCpfVal && typeof cnpjCpfVal === "string" && cnpjCpfVal.trim() !== "" && !cnpjCpfVal.includes("Aguardando") && !cnpjCpfVal.includes("Invalido")) {
      const cleanDigits = cnpjCpfVal.replace(/\D/g, "");
      if (cleanDigits.length === 14 && contact.cnpj !== cnpjCpfVal.trim()) {
        contactUpdates.cnpj = cnpjCpfVal.trim();
        contact.cnpj = cnpjCpfVal.trim();
      } else if (cleanDigits.length === 11 && contact.cpf !== cnpjCpfVal.trim()) {
        contactUpdates.cpf = cnpjCpfVal.trim();
        contact.cpf = cnpjCpfVal.trim();
      }
    }

    if (Object.keys(contactUpdates).length > 0) {
      await db.update(contacts).set(contactUpdates).where(eq(contacts.id, contact.id));
    }

    const docDigits = (contact.cnpj || contact.cpf || cnpjCpfVal || "").replace(/\D/g, "");

    // 3. Buscar os campos customizados oficiais do RD CRM via API
    const rawFieldsRes = await rdRequest<any>(tenantId, "GET", "/custom_fields?limit=100").catch((err) => {
      console.error("[RD CRM Auto] ❌ Erro ao buscar /custom_fields no RD CRM:", err?.message || err);
      return [];
    });

    const allCrmFields: any[] = Array.isArray(rawFieldsRes)
      ? rawFieldsRes
      : (rawFieldsRes && Array.isArray(rawFieldsRes.custom_fields)
          ? rawFieldsRes.custom_fields
          : (rawFieldsRes && Array.isArray(rawFieldsRes.data) ? rawFieldsRes.data : []));

    const normalizeStr = (str: string) =>
      str
        ? str
            .toLowerCase()
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .replace(/[^a-z0-9]/g, "")
        : "";

    const findField = (configuredId: string, labelPattern: string) => {
      const foundById = allCrmFields.find((f) => f.id === configuredId || f._id === configuredId);
      if (foundById) return foundById;

      const target = normalizeStr(labelPattern);
      return allCrmFields.find((f) => {
        const normLabel = normalizeStr(f.label || f.name || f.api_identifier || f.slug || "");
        return normLabel === target || normLabel.includes(target) || target.includes(normLabel);
      });
    };

    const resolvedFields = {
      qualificadoSdr: findField(VALEM_FIELD_IDS.qualificadoSdr, "QUALIFICADO POR SDR (VALEM)"),
      projetosDesenvolvimento: findField(VALEM_FIELD_IDS.projetosDesenvolvimento, "PROJETOS / DESENVOLVIMENTO"),
      tipoProduto: findField(VALEM_FIELD_IDS.tipoProduto, "QUAL O TIPO DE PRODUTO (VALEM)"),
      infoComplementar: findField(VALEM_FIELD_IDS.infoComplementar, "INFORMAÇÕES COMPLEMENTARES"),
      feitoPor: findField(VALEM_FIELD_IDS.feitoPor, "FEITO POR"),
    };

    // 4. Buscar Funil "Válvulas" / "Valvulas" no RD CRM
    let dealStageId: string | undefined = undefined;
    let dealPipelineId: string | undefined = undefined;

    try {
      let pipelinesRes = await rdRequest<any>(tenantId, "GET", "/pipelines").catch(() => null);
      if (!pipelinesRes) {
        pipelinesRes = await rdRequest<any>(tenantId, "GET", "/deal_pipelines").catch(() => null);
      }

      const pipelines: any[] = Array.isArray(pipelinesRes)
        ? pipelinesRes
        : (pipelinesRes && Array.isArray(pipelinesRes.pipelines)
            ? pipelinesRes.pipelines
            : (pipelinesRes && Array.isArray(pipelinesRes.deal_pipelines)
                ? pipelinesRes.deal_pipelines
                : (pipelinesRes && Array.isArray(pipelinesRes.data) ? pipelinesRes.data : [])));

      const valvulasPipeline = pipelines.find((p) => {
        const norm = normalizeStr(p.name || "");
        return norm.includes("valvula") || norm.includes("valvulas");
      });

      if (valvulasPipeline) {
        dealPipelineId = valvulasPipeline.id || valvulasPipeline._id;
        const stages = valvulasPipeline.deal_stages || valvulasPipeline.stages || [];
        if (Array.isArray(stages) && stages.length > 0) {
          dealStageId = stages[0].id || stages[0]._id;
          console.log(`[RD CRM Auto] 🎯 Funil Válvulas encontrado! Pipeline: ${dealPipelineId}, Stage: ${dealStageId}`);
        }
      }

      if (!dealStageId && pipelines.length > 0) {
        const firstPipe = pipelines[0];
        dealPipelineId = firstPipe.id || firstPipe._id;
        const stages = firstPipe.deal_stages || firstPipe.stages || [];
        if (Array.isArray(stages) && stages.length > 0) {
          dealStageId = stages[0].id || stages[0]._id;
          console.log(`[RD CRM Auto] ⚠️ Funil Válvulas não encontrado, usando primeiro pipeline: ${dealPipelineId}`);
        }
      }
    } catch {}

    // 5. Extrair os valores coletados pela Valentina na triagem
    const clientName = collectedData["NOME COMPLETO"]?.value || contact.name || `Cliente ${contactPhone}`;
    const companyName = collectedData["EMPRESA"]?.value || contact.name || clientName;
    const cnpjVal = collectedData["CNPJ OU CPF"]?.value || contact.cnpj || contact.cpf || "";
    const productVal = collectedData["QUAL O TIPO DE PRODUTO?"]?.value || 
                       collectedData["QUAL O TIPO DE PRODUTO (VALEM)"]?.value || 
                       collectedData["PRODUTO DE INTERESSE"]?.value || "";
    const projetosVal = collectedData["PROJETOS / DESENVOLVIMENTO"]?.value || "NAO";
    const qualificadoVal = collectedData["QUALIFICADO POR SDR (VALEM)"]?.value || "Industrial - Recorrência: Lead Qualificado via Valentina SDR";

    const dealTitle = productVal
      ? `${companyName} - ${productVal}`
      : `${companyName} - Triagem Valentina`;

    // Matcher de Opção do Dropdown
    const matchBestOption = (fieldObj: any, rawValue: string): string => {
      if (!rawValue || !rawValue.trim()) return "";
      const options = fieldObj?.options || fieldObj?.custom_field_options || [];
      if (!Array.isArray(options) || options.length === 0) return rawValue.trim();

      const rawNorm = normalizeStr(rawValue);
      for (const opt of options) {
        const optVal = typeof opt === "string" ? opt : (opt.value || opt.name || opt.label || "");
        if (normalizeStr(optVal) === rawNorm) return optVal;
      }
      for (const opt of options) {
        const optVal = typeof opt === "string" ? opt : (opt.value || opt.name || opt.label || "");
        const optNorm = normalizeStr(optVal);
        if (optNorm && (optNorm.includes(rawNorm) || rawNorm.includes(optNorm))) return optVal;
      }
      const firstOpt = options[0];
      return typeof firstOpt === "string" ? firstOpt : (firstOpt?.value || firstOpt?.label || rawValue);
    };

    const formatValue = (fieldObj: any, val: any) => {
      if (!val) return [];
      const type = fieldObj?.type || "";
      const hasOptions = (Array.isArray(fieldObj?.options) && fieldObj.options.length > 0) ||
                        (Array.isArray(fieldObj?.custom_field_options) && fieldObj.custom_field_options.length > 0);
      const isSelection = type === "multiple_choice" || type === "option" || type === "select" || hasOptions;

      if (isSelection) {
        const rawStr = Array.isArray(val) ? val[0] : String(val);
        const matched = matchBestOption(fieldObj, rawStr);
        return matched ? [matched] : [];
      }
      return val;
    };

    const dealCustomFields: any[] = [];
    if (resolvedFields.qualificadoSdr) {
      dealCustomFields.push({
        custom_field_id: resolvedFields.qualificadoSdr.id || resolvedFields.qualificadoSdr._id,
        value: formatValue(resolvedFields.qualificadoSdr, qualificadoVal),
      });
    }
    if (resolvedFields.projetosDesenvolvimento) {
      dealCustomFields.push({
        custom_field_id: resolvedFields.projetosDesenvolvimento.id || resolvedFields.projetosDesenvolvimento._id,
        value: formatValue(resolvedFields.projetosDesenvolvimento, projetosVal),
      });
    }
    if (resolvedFields.tipoProduto && productVal) {
      dealCustomFields.push({
        custom_field_id: resolvedFields.tipoProduto.id || resolvedFields.tipoProduto._id,
        value: formatValue(resolvedFields.tipoProduto, productVal),
      });
    }
    if (resolvedFields.feitoPor) {
      dealCustomFields.push({
        custom_field_id: resolvedFields.feitoPor.id || resolvedFields.feitoPor._id,
        value: formatValue(resolvedFields.feitoPor, "VALENTINA"),
      });
    }

    // Monta o resumo formatado
    const infoLines = [
      `📋 TRIAGEM FINALIZADA POR VALENTINA (SDR)`,
      `----------------------------------------`,
      `• Nome do Cliente: ${clientName}`,
      `• Razão Social / Empresa: ${companyName}`,
      cnpjVal ? `• CNPJ/CPF: ${cnpjVal}` : null,
      productVal ? `• Produto de Interesse: ${productVal}` : null,
      `• Projetos/Desenvolvimento: ${projetosVal}`,
      `• Telefone WhatsApp: ${contactPhone}`,
      `• Data da Conclusão: ${new Date().toLocaleString("pt-BR")}`,
      ``,
      `💬 RESPOSTAS COLETADAS NA TRIAGEM:`,
    ];
    for (const [k, v] of Object.entries(collectedData)) {
      const valStr = typeof v === "object" ? v?.value : v;
      if (valStr && String(valStr).trim() !== "") {
        infoLines.push(`- ${k}: ${valStr}`);
      }
    }
    const infoComplementarText = infoLines.filter((l) => l !== null).join("\n");
    const infoComplementarHtml = infoLines.filter((l) => l !== null).join("<br>");

    if (resolvedFields.infoComplementar) {
      dealCustomFields.push({
        custom_field_id: resolvedFields.infoComplementar.id || resolvedFields.infoComplementar._id,
        value: infoComplementarText,
      });
    }

    // 6. Resoluções de Vendedor / Vínculo com Usuário do CRM
    let crmUserId: string | undefined = undefined;
    if (allocatedOperator?.name || allocatedOperator?.email) {
      try {
        const users = await getCachedUsers(tenantId);
        const opName = (allocatedOperator.name || "").toLowerCase().trim();
        const opEmail = (allocatedOperator.email || "").toLowerCase().trim();

        const matchedUser = users.find((u: any) => {
          const uName = (u.name || "").toLowerCase().trim();
          const uEmail = (u.email || "").toLowerCase().trim();
          if (opEmail && uEmail === opEmail) return true;
          if (opName && uName) {
            const firstOp = opName.split(" ")[0];
            const firstU = uName.split(" ")[0];
            return uName.includes(opName) || opName.includes(uName) || (firstOp.length > 2 && firstOp === firstU);
          }
          return false;
        });

        if (matchedUser) {
          crmUserId = matchedUser.id || matchedUser._id;
          console.log(`[RD CRM Auto] 👤 Vendedor do RD CRM associado: "${matchedUser.name}" (ID: ${crmUserId})`);
        }
      } catch (uErr: any) {
        console.warn("[RD CRM Auto] Aviso ao vincular vendedor no RD CRM:", uErr?.message || uErr);
      }
    }

    // 7. Busca/Criação Robusta da Organização no RD CRM
    const organizationId = await findOrCreateOrganizationInCrm(tenantId, companyName, docDigits, crmUserId);

    // 8. Busca/Criação Robusta do Contato no RD CRM
    const crmContactId = await upsertContactInCrm(tenantId, clientName, contactPhone, docDigits, organizationId);

    // 9. Verificar se o Card já existe localmente ou no RD CRM
    let dealId = contact.rdCrmDealId;
    if (!dealId && crmContactId) {
      dealId = await findExistingDealInCrm(tenantId, crmContactId);
    }

    let dealLink = contact.rdCrmDealLink;

    if (dealId) {
      console.log(`[RD CRM Auto] 🔄 Atualizando Card existente no RD CRM (ID: ${dealId})...`);
      const updatePayload: Record<string, any> = {
        name: dealTitle,
        custom_fields: dealCustomFields,
      };
      if (organizationId) updatePayload.organization_id = organizationId;
      if (dealPipelineId) updatePayload.pipeline_id = dealPipelineId;
      if (dealStageId) updatePayload.stage_id = dealStageId;
      if (crmUserId) updatePayload.owner_id = crmUserId;

      await rdRequest(tenantId, "PUT", `/deals/${dealId}`, updatePayload);
      console.log(`[RD CRM Auto] ✅ Card ${dealId} atualizado no RD CRM.`);
    } else {
      console.log(`[RD CRM Auto] ➕ Criando NOVO Card no RD CRM para o cliente "${clientName}" (${companyName})...`);
      const dealPayload: Record<string, any> = {
        name: dealTitle,
        custom_fields: dealCustomFields,
        status: "ongoing",
      };

      if (crmContactId) {
        dealPayload.contact_ids = [crmContactId];
      }

      if (organizationId) dealPayload.organization_id = organizationId;
      if (dealPipelineId) dealPayload.pipeline_id = dealPipelineId;
      if (dealStageId) dealPayload.stage_id = dealStageId;
      if (crmUserId) dealPayload.owner_id = crmUserId;

      const newDeal = await rdRequest<any>(tenantId, "POST", "/deals", dealPayload);
      dealId = newDeal?.id || newDeal?._id;

      if (dealId) {
        dealLink = `https://crm.rdstation.com/app/deals/${dealId}`;
        console.log(`[RD CRM Auto] 🎉 CARD CRIADO COM SUCESSO NO RD CRM! Deal ID: ${dealId}`);
      } else {
        console.error("[RD CRM Auto] ❌ API do RD CRM não retornou o ID do novo deal criado!", newDeal);
      }
    }

    if (dealId) {
      dealLink = `https://crm.rdstation.com/app/deals/${dealId}`;

      // 10. Enviar Nota na Timeline do Card no RD CRM
      try {
        console.log(`[RD CRM Auto] 📝 Enviando nota de relatório de triagem para timeline do deal ${dealId}...`);
        await rdRequest(tenantId, "POST", `/deals/${dealId}/notes`, {
          description: `[Triagem Valentina SDR]<br><br>${infoComplementarHtml}`,
        });
        console.log(`[RD CRM Auto] ✅ Nota adicionada com sucesso na timeline do CRM.`);
      } catch (noteErr: any) {
        console.warn(`[RD CRM Auto] Aviso ao adicionar nota na timeline do CRM:`, noteErr?.message);
      }

      // Persistir no DB local
      await db
        .update(contacts)
        .set({
          rdCrmDealId: dealId,
          rdCrmDealLink: dealLink,
        })
        .where(eq(contacts.id, contact.id));

      // Emitir evento SSE real-time
      try {
        const { SessionManager } = await import("../baileys/session-manager");
        SessionManager.getInstance().notifyPublic(tenantId, {
          type: "contact_updated",
          contact: {
            id: contact.id,
            rdCrmDealId: dealId,
            rdCrmDealLink: dealLink,
          },
        });
      } catch (sseErr: any) {
        console.warn("[RD CRM Auto] Erro ao emitir SSE contact_updated:", sseErr?.message);
      }
    }

    return true;
  } catch (err: any) {
    console.error("[RD CRM Auto] ❌ ERRO EXCEPCIONAL na automação de criação/atualização de card no RD CRM:", err?.stack || err?.message || err);
    return false;
  }
}

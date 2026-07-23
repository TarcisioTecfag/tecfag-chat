/**
 * sdr-crm-auto.ts
 * Automação de Criação e Vínculo de Card no RD Station CRM quando a SDR Valentina conclui uma triagem.
 */

import { db } from "../../db";
import { contacts, conversations } from "../../db/schema";
import { eq } from "drizzle-orm";
import { rdRequest, isRdCrmConfigured } from "../rdCrmService";

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
      console.log(`[RD CRM Auto] Conversa localizada. ID do Contato associado: "${conv.contactId}"`);
      const [foundContact] = await db
        .select()
        .from(contacts)
        .where(eq(contacts.id, conv.contactId));
      contact = foundContact;
    }

    if (!contact) {
      console.log(`[RD CRM Auto] Contato não encontrado por conv.contactId. Buscando por variantes do telefone "${contactPhone}"...`);
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
      console.warn(`[RD CRM Auto] ⚠️ Nenhum contato encontrado no DB para o telefone "${contactPhone}" ou conversa "${conversationId}". Criando contato automaticamente...`);
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

    // Garantir que o nome e CNPJ/CPF do contato no DB local reflitam os dados coletados na triagem
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
      console.log(`[RD CRM Auto] 🔄 Dados do Contato ${contact.id} sincronizados no DB antes do envio ao CRM:`, contactUpdates);
    }

    console.log(`[RD CRM Auto] ✅ Contato local obtido: ID="${contact.id}", Nome="${contact.name}", Telefone="${contact.phone}", Card Existente ID="${contact.rdCrmDealId || "NENHUM"}"`);

    // 3. Buscar os campos customizados oficiais do RD CRM via API
    console.log(`[RD CRM Auto] 📋 Solicitando campos customizados da API do RD CRM (GET /custom_fields?limit=100)...`);
    const rawFieldsRes = await rdRequest<any>(tenantId, "GET", "/custom_fields?limit=100").catch((err) => {
      console.error("[RD CRM Auto] ❌ Erro ao buscar /custom_fields no RD CRM:", err?.message || err);
      return [];
    });

    const allCrmFields: any[] = Array.isArray(rawFieldsRes)
      ? rawFieldsRes
      : (rawFieldsRes && Array.isArray(rawFieldsRes.custom_fields)
          ? rawFieldsRes.custom_fields
          : (rawFieldsRes && Array.isArray(rawFieldsRes.data) ? rawFieldsRes.data : []));

    console.log(`[RD CRM Auto] 📊 Total de custom_fields retornados do RD CRM: ${allCrmFields.length}`);

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

    console.log(`[RD CRM Auto] 🎯 Mapeamento de Campos Customizados Resolvidos:`, {
      qualificadoSdr: resolvedFields.qualificadoSdr ? `${resolvedFields.qualificadoSdr.label || resolvedFields.qualificadoSdr.name} (ID: ${resolvedFields.qualificadoSdr.id || resolvedFields.qualificadoSdr._id})` : "❌ NÃO ENCONTRADO",
      projetosDesenvolvimento: resolvedFields.projetosDesenvolvimento ? `${resolvedFields.projetosDesenvolvimento.label || resolvedFields.projetosDesenvolvimento.name} (ID: ${resolvedFields.projetosDesenvolvimento.id || resolvedFields.projetosDesenvolvimento._id})` : "❌ NÃO ENCONTRADO",
      tipoProduto: resolvedFields.tipoProduto ? `${resolvedFields.tipoProduto.label || resolvedFields.tipoProduto.name} (ID: ${resolvedFields.tipoProduto.id || resolvedFields.tipoProduto._id})` : "❌ NÃO ENCONTRADO",
      infoComplementar: resolvedFields.infoComplementar ? `${resolvedFields.infoComplementar.label || resolvedFields.infoComplementar.name} (ID: ${resolvedFields.infoComplementar.id || resolvedFields.infoComplementar._id})` : "❌ NÃO ENCONTRADO",
      feitoPor: resolvedFields.feitoPor ? `${resolvedFields.feitoPor.label || resolvedFields.feitoPor.name} (ID: ${resolvedFields.feitoPor.id || resolvedFields.feitoPor._id})` : "❌ NÃO ENCONTRADO",
    });

    // 4. Buscar Funil "Válvulas" / "Valvulas" no RD CRM (GET /pipelines)
    console.log(`[RD CRM Auto] 🏷️ Buscando funil e etapa de vendas "Válvulas" no RD CRM (GET /pipelines)...`);
    let dealStageId: string | undefined = undefined;

    try {
      let pipelinesRes = await rdRequest<any>(tenantId, "GET", "/pipelines").catch((err) => {
        console.warn(`[RD CRM Auto] Aviso ao buscar GET /pipelines:`, err?.message);
        return null;
      });

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

      console.log(`[RD CRM Auto] Lista de Funis encontrados no CRM (${pipelines.length}):`, pipelines.map((p) => ({ id: p.id || p._id, name: p.name })));

      const valvulasPipeline = pipelines.find((p) => {
        const norm = normalizeStr(p.name || "");
        return norm.includes("valvula") || norm.includes("valvulas");
      });

      if (valvulasPipeline) {
        console.log(`[RD CRM Auto] ✅ Funil "Válvulas" localizado: ID="${valvulasPipeline.id || valvulasPipeline._id}", Name="${valvulasPipeline.name}"`);
        const stages = valvulasPipeline.deal_stages || valvulasPipeline.stages || [];
        if (Array.isArray(stages) && stages.length > 0) {
          dealStageId = stages[0].id || stages[0]._id;
          console.log(`[RD CRM Auto] ✅ Primeira etapa do Funil Válvulas selecionada: ID="${dealStageId}", Nome="${stages[0].name}"`);
        }
      }

      if (!dealStageId && pipelines.length > 0) {
        const firstPipe = pipelines[0];
        const stages = firstPipe.deal_stages || firstPipe.stages || [];
        if (Array.isArray(stages) && stages.length > 0) {
          dealStageId = stages[0].id || stages[0]._id;
          console.log(`[RD CRM Auto] ⚠️ Funil Válvulas não encontrado especificamente. Usando primeira etapa do funil "${firstPipe.name}": ID="${dealStageId}"`);
        }
      }

      if (!dealStageId) {
        console.log(`[RD CRM Auto] Buscando etapas diretamente em GET /deal_stages...`);
        const stagesRes = await rdRequest<any>(tenantId, "GET", "/deal_stages").catch(() => null);
        const allStages: any[] = Array.isArray(stagesRes)
          ? stagesRes
          : (stagesRes && Array.isArray(stagesRes.deal_stages)
              ? stagesRes.deal_stages
              : (stagesRes && Array.isArray(stagesRes.data) ? stagesRes.data : []));

        console.log(`[RD CRM Auto] Lista de Etapas encontradas (${allStages.length}):`, allStages.map((s) => ({ id: s.id || s._id, name: s.name })));

        const valvulaStage = allStages.find((s) => {
          const norm = normalizeStr(s.name || s.pipeline_name || "");
          return norm.includes("valvula") || norm.includes("valvulas");
        });

        if (valvulaStage) {
          dealStageId = valvulaStage.id || valvulaStage._id;
          console.log(`[RD CRM Auto] ✅ Etapa correspondente ao Funil Válvulas localizada: ID="${dealStageId}", Nome="${valvulaStage.name}"`);
        } else if (allStages.length > 0) {
          dealStageId = allStages[0].id || allStages[0]._id;
          console.log(`[RD CRM Auto] ⚠️ Usando primeira etapa disponível de GET /deal_stages: ID="${dealStageId}"`);
        }
      }
    } catch (stageErr: any) {
      console.warn(`[RD CRM Auto] ⚠️ Não foi possível determinar etapa do funil:`, stageErr?.message || stageErr);
    }

    // 5. Extrair os valores coletados pela Valentina na triagem
    const clientName = collectedData["NOME COMPLETO"]?.value || contact.name || `Cliente ${contactPhone}`;
    const companyName = collectedData["EMPRESA"]?.value || contact.name || clientName;
    const cnpjVal = collectedData["CNPJ OU CPF"]?.value || contact.cnpj || contact.cpf || "";
    const productVal = collectedData["QUAL O TIPO DE PRODUTO?"]?.value || 
                       collectedData["QUAL O TIPO DE PRODUTO (VALEM)"]?.value || 
                       collectedData["PRODUTO DE INTERESSE"]?.value || "";
    const projetosVal = collectedData["PROJETOS / DESENVOLVIMENTO"]?.value || "NAO";
    const qualificadoVal = collectedData["QUALIFICADO POR SDR (VALEM)"]?.value || "Industrial - Recorrência: Lead Qualificado via Valentina SDR";

    // Título formatado da Oportunidade no CRM
    const dealTitle = productVal
      ? `${companyName} - ${productVal}`
      : `${companyName} - Triagem Valentina`;

    console.log(`[RD CRM Auto] 📝 Título da Oportunidade: "${dealTitle}"`);

    // Helper inteligente para encontrar a opção exata configurada no campo de seleção do RD CRM
    const matchBestOption = (fieldObj: any, rawValue: string): string => {
      if (!rawValue || !rawValue.trim()) return "";

      const options = fieldObj?.options || fieldObj?.custom_field_options || [];
      if (!Array.isArray(options) || options.length === 0) {
        return rawValue.trim();
      }

      const rawNorm = normalizeStr(rawValue);

      // 1. Busca opção por igualdade exata de string normalizada
      for (const opt of options) {
        const optVal = typeof opt === "string" ? opt : (opt.value || opt.name || opt.label || "");
        if (normalizeStr(optVal) === rawNorm) {
          return optVal;
        }
      }

      // 2. Busca opção por inclusão de texto (sub-string)
      for (const opt of options) {
        const optVal = typeof opt === "string" ? opt : (opt.value || opt.name || opt.label || "");
        const optNorm = normalizeStr(optVal);
        if (optNorm && (optNorm.includes(rawNorm) || rawNorm.includes(optNorm))) {
          return optVal;
        }
      }

      // 3. Fallbacks de termos comuns para campos do CRM da Valem
      if (rawNorm.includes("valentina") || rawNorm.includes("sdr")) {
        for (const opt of options) {
          const optVal = typeof opt === "string" ? opt : (opt.value || opt.name || opt.label || "");
          const optNorm = normalizeStr(optVal);
          if (optNorm.includes("sdr") || optNorm.includes("valentina")) {
            return optVal;
          }
        }
      }

      if (rawNorm.includes("nao") || rawNorm.includes("não")) {
        for (const opt of options) {
          const optVal = typeof opt === "string" ? opt : (opt.value || opt.name || opt.label || "");
          const optNorm = normalizeStr(optVal);
          if (optNorm === "nao" || optNorm.includes("nao")) {
            return optVal;
          }
        }
      }

      if (rawNorm.includes("sim")) {
        for (const opt of options) {
          const optVal = typeof opt === "string" ? opt : (opt.value || opt.name || opt.label || "");
          const optNorm = normalizeStr(optVal);
          if (optNorm === "sim" || optNorm.includes("sim")) {
            return optVal;
          }
        }
      }

      // 4. Se não houver correspondência exata, seleciona a primeira opção da lista do CRM
      const firstOpt = options[0];
      return typeof firstOpt === "string" ? firstOpt : (firstOpt?.value || firstOpt?.label || rawValue);
    };

    // Helper para formatar o valor de acordo com o tipo de campo (Seleção vs Texto)
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

    // Monta o resumo formatado para Informações Complementares
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

    if (resolvedFields.infoComplementar) {
      dealCustomFields.push({
        custom_field_id: resolvedFields.infoComplementar.id || resolvedFields.infoComplementar._id,
        value: infoComplementarText,
      });
    }

    console.log(`[RD CRM Auto] ⚙️ deal_custom_fields montados (${dealCustomFields.length}):`, JSON.stringify(dealCustomFields, null, 2));

    // 6. Tentar criar/associar Organização no CRM
    let organizationId: string | undefined = undefined;
    if (companyName && !companyName.startsWith("Cliente ")) {
      try {
        console.log(`[RD CRM Auto] 🏢 Criando/Buscando Organização no RD CRM para "${companyName}"...`);
        const orgRes = await rdRequest<any>(tenantId, "POST", "/organizations", {
          name: companyName,
        });
        organizationId = orgRes?.id || orgRes?._id;
        console.log(`[RD CRM Auto] ✅ Organização obtida: ID="${organizationId}"`);
      } catch (orgErr: any) {
        console.warn("[RD CRM Auto] Organização não criada (pode já existir no CRM):", orgErr?.message || orgErr);
      }
    }

    // 6.5. Tentar identificar vendedor/responsável alocado no RD CRM
    let crmUserId: string | undefined = undefined;
    if (allocatedOperator?.name || allocatedOperator?.email) {
      try {
        const { getCachedUsers } = await import("../rdCrmService");
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

    // 7. Se o contato já tem um Card no CRM, apenas atualiza. Se não tem, cria um NOVO Card!
    let dealId = contact.rdCrmDealId;
    let dealLink = contact.rdCrmDealLink;

    if (dealId) {
      console.log(`[RD CRM Auto] 🔄 Contato "${contact.id}" já possui card vinculado (${dealId}). Atualizando dados via PUT /deals/${dealId}...`);
      const updatePayload: Record<string, any> = {
        name: dealTitle,
        deal_custom_fields: dealCustomFields,
        contacts: [
          {
            name: clientName,
            phones: [{ phone: contactPhone }],
          },
        ],
      };
      if (organizationId) updatePayload.organization_id = organizationId;
      if (dealStageId) updatePayload.deal_stage_id = dealStageId;
      if (crmUserId) updatePayload.user_id = crmUserId;

      console.log(`[RD CRM Auto] 📤 Enviando PUT /deals/${dealId}:`, JSON.stringify(updatePayload, null, 2));
      const putRes = await rdRequest(tenantId, "PUT", `/deals/${dealId}`, updatePayload);
      console.log(`[RD CRM Auto] ✅ Card atualizado com sucesso no RD CRM:`, JSON.stringify(putRes, null, 2));
    } else {
      console.log(`[RD CRM Auto] ➕ Criando NOVO Card no RD CRM para o cliente "${clientName}" (${companyName})...`);
      const dealPayload: Record<string, any> = {
        name: dealTitle,
        deal_custom_fields: dealCustomFields,
        contacts: [
          {
            name: clientName,
            phones: [{ phone: contactPhone }],
          },
        ],
      };

      if (organizationId) dealPayload.organization_id = organizationId;
      if (dealStageId) dealPayload.deal_stage_id = dealStageId;
      if (crmUserId) dealPayload.user_id = crmUserId;

      console.log(`[RD CRM Auto] 📤 Enviando POST /deals:`, JSON.stringify(dealPayload, null, 2));
      const newDeal = await rdRequest<any>(tenantId, "POST", "/deals", dealPayload);
      console.log(`[RD CRM Auto] 📥 Resposta da API POST /deals:`, JSON.stringify(newDeal, null, 2));

      dealId = newDeal?.id || newDeal?._id || newDeal?.deal?.id;

      if (dealId) {
        dealLink = `https://crm.rdstation.com/app/deals/${dealId}`;

        // Salva os campos de vínculo no banco local do sistema
        console.log(`[RD CRM Auto] 💾 Persistindo rdCrmDealId (${dealId}) e rdCrmDealLink no contato ${contact.id}...`);
        await db
          .update(contacts)
          .set({
            rdCrmDealId: dealId,
            rdCrmDealLink: dealLink,
          })
          .where(eq(contacts.id, contact.id));

        console.log(`[RD CRM Auto] 🎉 CARD CRIADO E VINCULADO COM SUCESSO NO RD CRM! Deal ID: ${dealId} | Link: ${dealLink}`);

        // Notificar interface SSE para atualizar o painel lateral do contato instantaneamente
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
      } else {
        console.error("[RD CRM Auto] ❌ API do RD CRM não retornou o ID do novo deal criado!", newDeal);
      }
    }

    return true;
  } catch (err: any) {
    console.error("[RD CRM Auto] ❌ ERRO EXCEPCIONAL na automação de criação/atualização de card no RD CRM:", err?.stack || err?.message || err);
    return false;
  }
}

/**
 * sdr-crm-auto.ts
 * Automação de Criação e Vínculo de Card no RD Station CRM quando a SDR Valentina conclui uma triagem.
 */

import { db } from "../../db";
import { contacts } from "../../db/schema";
import { eq } from "drizzle-orm";
import { rdRequest, isRdCrmConfigured } from "../rdCrmService";

interface CreateCrmDealFromTriageOptions {
  tenantId: string;
  conversationId: string;
  contactPhone: string;
  collectedData: Record<string, any>;
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
}: CreateCrmDealFromTriageOptions): Promise<boolean> {
  try {
    // 1. Verificar se a integração com o RD CRM está configurada para este tenant
    const isConfigured = await isRdCrmConfigured(tenantId).catch(() => false);
    if (!isConfigured) {
      console.log(`[RD CRM Auto] RD CRM não está configurado para o tenant ${tenantId}. Pulando criação automática de card.`);
      return false;
    }

    // 2. Buscar o contato no banco local
    const cleanPhone = contactPhone.replace(/\D/g, "");
    const contactId = `c-${cleanPhone}`;

    const [contact] = await db
      .select()
      .from(contacts)
      .where(eq(contacts.id, contactId));

    if (!contact) {
      console.warn(`[RD CRM Auto] Contato ${contactId} não encontrado no banco.`);
      return false;
    }

    // 3. Buscar os campos customizados oficiais do RD CRM via API
    const rawFieldsRes = await rdRequest<any>(tenantId, "GET", "/custom_fields?limit=100").catch((err) => {
      console.error("[RD CRM Auto] Erro ao buscar custom_fields:", err.message);
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

    // 4. Extrair os valores coletados pela Valentina na triagem
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

    // 5. Montar os custom fields em formato aceito pela API do RD CRM
    const dealCustomFields: Array<{ custom_field_id: string; value: any }> = [];

    const formatValue = (fieldObj: any, val: any) => {
      if (!val) return "";
      const type = fieldObj?.type || "";
      if (type === "multiple_choice" || type === "option" || type === "select") {
        return Array.isArray(val) ? val : [val];
      }
      return val;
    };

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

    // 6. Tentar criar/associar Organização no CRM
    let organizationId: string | undefined = undefined;
    if (companyName && !companyName.startsWith("Cliente ")) {
      try {
        const orgRes = await rdRequest<any>(tenantId, "POST", "/organizations", {
          name: companyName,
        });
        organizationId = orgRes?.id || orgRes?._id;
      } catch (orgErr: any) {
        console.warn("[RD CRM Auto] Organização não criada (pode já existir):", orgErr?.message);
      }
    }

    // 7. Se o contato já tem um Card no CRM, apenas atualiza. Se não tem, cria um NOVO Card!
    let dealId = contact.rdCrmDealId;
    let dealLink = contact.rdCrmDealLink;

    if (dealId) {
      console.log(`[RD CRM Auto] Contato ${contactId} já possui card vinculado (${dealId}). Atualizando dados do CRM...`);
      await rdRequest(tenantId, "PUT", `/deals/${dealId}`, {
        name: dealTitle,
        deal_custom_fields: dealCustomFields,
        ...(organizationId ? { organization_id: organizationId } : {}),
      });
    } else {
      console.log(`[RD CRM Auto] Criando NOVO Card no RD CRM para o cliente ${clientName}...`);
      const dealPayload: Record<string, any> = {
        name: dealTitle,
        deal_custom_fields: dealCustomFields,
      };

      if (organizationId) {
        dealPayload.organization_id = organizationId;
      }

      const newDeal = await rdRequest<any>(tenantId, "POST", "/deals", dealPayload);
      dealId = newDeal?.id || newDeal?._id || newDeal?.deal?.id;

      if (dealId) {
        dealLink = `https://crm.rdstation.com/app/deals/${dealId}`;

        // Salva os campos de vínculo no banco local do sistema
        await db
          .update(contacts)
          .set({
            rdCrmDealId: dealId,
            rdCrmDealLink: dealLink,
          })
          .where(eq(contacts.id, contactId));

        console.log(`[RD CRM Auto] ✅ Card criado e vinculado com sucesso no RD CRM! Deal ID: ${dealId}`);
      } else {
        console.error("[RD CRM Auto] API do RD CRM não retornou o ID do novo deal criado:", newDeal);
      }
    }

    return true;
  } catch (err: any) {
    console.error("[RD CRM Auto] Erro na automação de criação/atualização de card no RD CRM:", err?.message || err);
    return false;
  }
}

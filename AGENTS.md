<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

---

## 🏢 ARQUITETURA MULTI-TENANT — REGRA FUNDAMENTAL (MANDATÓRIA)

> [!CAUTION]
> **DOIS TENANTS, DOIS SILOS COMPLETAMENTE SEPARADOS**
>
> Este projeto serve **dois clientes distintos** que compartilham o mesmo banco de dados PostgreSQL e o mesmo código, mas são **100% isolados em dados**:
>
> | Tenant | ID | Empresa | Canal padrão | IA Persona | Status |
> |--------|-----|---------|-------------|------------|--------|
> | Valem  | `"valem"`  | Valem Valvulas e Embalagens | **Baileys** (configurável via admin) | **Valentina** | 🟢 ATIVO em produção — não interromper |
> | Tecfag | `"tecfag"` | Tecfag Informática | **Meta API** (configurável via admin) | **Fagner** | 🟡 EM IMPLANTAÇÃO — **prioridade atual de desenvolvimento** |
>
> **Decisão arquitetural (28/09/2026):** Tecfag é a prioridade de desenvolvimento. Valem deve permanecer operando sem interrupção durante toda a implantação. Canal é configurável por tenant via painel admin — não fixe Baileys para Valem nem Meta para Tecfag no código.
>
> ### ⛔ REGRAS ABSOLUTAS DE ISOLAMENTO:
>
> 1. **NUNCA** faça queries no banco sem filtrar por `tenantId`. Toda query que acesse `conversations`, `operators`, `contacts`, `agentConfigs`, `aiConversationAudits`, `tasks`, `sectors`, `accessGroups`, `quickResponses`, `templates` ou `internalMessages` **DEVE** ter `eq(table.tenantId, tenantId)` no `WHERE`.
>
> 2. **NUNCA** aceite `tenantId` do cliente (query string ou body) como autoridade em rotas internas. O `tenantId` de rotas internas autenticadas DEVE vir **exclusivamente** da sessão do servidor (`session.tenantId` via `requireSession`). Rotas públicas (webhook, login, widget) têm validação própria explícita.
>
> 3. **NUNCA** use `"valem"` ou `"tecfag"` como string literal hardcoded em queries, engines de IA, ou rotas de API. **SEMPRE** use a variável `tenantId` recebida como parâmetro.
>
> 4. **Tecfag está em implantação.** Não crie dados reais, seeds ou funcionalidades que preencham o tenant `tecfag` sem necessidade operacional real. Configurações de teste usam banco/credenciais de teste, não o banco de produção da Valem.
>
> 5. **Valem nunca pode ficar sem serviço.** Em caso de ambiguidade ou conflito, preserve a operação da Valem. Tecfag pode aguardar uma janela de manutenção.

---

## 🤖 PERSONAS DE IA POR TENANT — REGRA ESTRITA

> [!CAUTION]
> **CADA TENANT TEM SUA PRÓPRIA PERSONA DE IA — NUNCA MISTURE**
>
> As duas IAs usam a **mesma infraestrutura técnica** (`src/lib/vertex-ai.ts`, `src/lib/valentina/`), mas são **personas completamente diferentes**:
>
> | Tenant | Nome da IA | Personalidade | Empresa |
> |--------|-----------|---------------|---------|
> | `valem` | **Valentina** | Consultora comercial pré-vendas (SDR). Especialista em válvulas aerosol/spray, frascos, potes, seladoras, embaladoras. Tom: profissional, feminino, comercial. | Valem Valvulas e Embalagens |
> | `tecfag` | **Fagner** | Consultor de atendimento técnico. Especialista em soluções de TI e informática. Tom: técnico, masculino, consultivo. | Tecfag Informática |
>
> ### ⛔ REGRAS DE PERSONA:
>
> 1. **NUNCA** use o nome "Valentina" para o tenant `tecfag`, nem "Fagner" para o tenant `valem`.
>
> 2. **SEMPRE** use a função central de persona: `getAiPersona(tenantId)` de `src/lib/ai-persona.ts` para obter nome, gênero e avatar corretos. Nunca hardcode o nome da IA na UI.
>
> 3. **Prompts de IA** que mencionam nome da empresa, persona ou produto **DEVEM** ser parametrizados por `tenantId`. Use o `agentConfig` do banco (tabela `agentConfigs`) filtrado por `eq(agentConfigs.tenantId, tenantId)`. Nunca use fallback sem tenant.
>
> 4. **Features de IA ativas por tenant:**
>    - `valem`: SDR (Valentina), Supervisor, Auditorias QA, Rodízio, Sentimento, Base de Conhecimento
>    - `tecfag`: Apenas Fagner (Chat do operador interno). SDR, Supervisor e Auditorias são **desativados** até go-live do tecfag.

---

## 🤖 REGRA ESTRITA DE ARQUITETURA DE I.A. (MANDATÓRIA)

> [!CAUTION]
> **PROVEDOR ÚNICO DE I.A. NO PROJETO — GOOGLE VERTEX AI**
>
> 1. **Uso Exclusivo de Credenciais**: Todas as chamadas de Inteligência Artificial no sistema DEVEM utilizar **unicamente** as credenciais da Service Account do **Google Vertex AI** (fornecidas via arquivo local `vertex-key.json` ou variável de ambiente `GOOGLE_SERVICE_ACCOUNT_JSON` / `VERTEX_SERVICE_ACCOUNT_JSON`).
>
> 2. **Proibição Absoluta de Outros Provedores**: É **estritamente proibido** integrar, importar ou utilizar APIs diretas de terceiros (ex: OpenAI direct keys, Groq SDK, Anthropic, Gemini API keys públicas) em qualquer módulo deste sistema.
>
> 3. **Integração Centralizada**: Qualquer desenvolvimento atual ou futuro que necessite de recursos de I.A. (texto, áudio, multimodal, JSON estruturado, transcrição ou RAG) DEVE ser implementado através do serviço central `vertexAi` (`src/lib/vertex-ai.ts`).
>
> 4. **Repasse Obrigatório de Custos**: Todas as chamadas ao `vertexAi.generateText` ou `vertexAi.generateStructuredJson` DEVEM fornecer os parâmetros de contexto obrigatórios:
>    ```typescript
>    await vertexAi.generateStructuredJson(prompt, model, signal, {
>      feature: "nome_da_feature",   // OBRIGATÓRIO — ver mapa abaixo
>      tenantId: tenantId,           // OBRIGATÓRIO — nunca hardcode "valem" ou "tecfag"
>      metadata: { conversationId }  // RECOMENDADO — para rastreabilidade
>    });
>    ```
>
> 5. **Mapa de Features de IA** (usar EXATAMENTE esses valores para aparecer corretamente no painel Custos):
>    | Feature Key | Label no Painel | Tenant |
>    |---|---|---|
>    | `"sdr_agent"` | SDR Bot (Triagem de Leads) | valem |
>    | `"conversation_audit"` | Auditoria de Atendimento QA | valem |
>    | `"sla_advisor"` | Análise SLA & Alertas | valem |
>    | `"supervisor_chat"` | Valentina Supervisor (Chat Interno) | valem |
>    | `"valentina_chat"` | Valentina Chat do Operador | valem |
>    | `"fagner_chat"` | Fagner Chat do Operador | tecfag |
>    | `"sentiment_analysis"` | Análise de Sentimento (Clientes) | ambos |
>    | `"call_transcription"` | Transcrição de Ligações | ambos |
>    | `"knowledge_rag"` | Base de Conhecimento RAG | ambos |

---

## 🛡️ CHECKLIST DE SEGURANÇA — OBRIGATÓRIO EM TODA NOVA ROTA DE API

> [!WARNING]
> **Antes de criar ou modificar qualquer rota em `src/routes/api/`**, verifique obrigatoriamente:
>
> - [ ] A rota é interna (requer operador logado)?
> - [ ] Se sim: usa `requireSession` — NUNCA `getAuthSession` — e obtém `tenantId` de `session.tenantId`?
> - [ ] A rota é pública (webhook/login/widget)? Tem validação própria e explícita?
> - [ ] Todas as queries ao banco têm `eq(table.tenantId, tenantId)` no WHERE?
> - [ ] Operações de DELETE/UPDATE verificam ID **e** tenant antes de modificar?
> - [ ] Ações admin (criar operador, alterar permissões) verificam `session.operator.role === "admin"`?
> - [ ] Se a rota chama Vertex AI, passa `tenantId` e `feature` corretamente?
>
> **Padrão obrigatório para rotas internas:**
> ```typescript
> const auth = await requireSession(request);
> if ("response" in auth) return auth.response; // 401 automático se sem sessão
> const { session } = auth;
> const tenantId = session.tenantId; // SEMPRE da sessão — nunca do query ou body
> ```
>
> **Padrão obrigatório para verificação admin:**
> ```typescript
> if (session.operator.role !== "admin") {
>   return new Response(JSON.stringify({ error: "Permissão insuficiente.", code: "FORBIDDEN" }), {
>     status: 403, headers: { "Content-Type": "application/json" }
>   });
> }
> ```


---

## 🐛 BUGS CONHECIDOS DE ISOLAMENTO (A CORRIGIR)

> [!WARNING]
> Os seguintes problemas foram identificados. Os marcados com ✅ foram corrigidos na Entrega 1 (28/09/2026):
>
> 1. ✅ **`GET/POST/DELETE /api/operators` sem sessão obrigatória** — Corrigido: agora usa `requireSession`. Senha padrão `123456` eliminada.
>
> 2. ✅ **`GET/POST/DELETE /api/groups` sem sessão obrigatória** — Corrigido: agora usa `requireSession`.
>
> 3. ✅ **`GET/POST/DELETE /api/sectors` sem sessão obrigatória** — Corrigido.
>
> 4. ✅ **`GET/POST/DELETE /api/quick-responses` sem sessão obrigatória** — Corrigido.
>
> 5. ✅ **`GET/POST/DELETE /api/templates` sem sessão obrigatória** — Corrigido.
>
> 6. ✅ **`POST /api/chats/tag-task` sem autenticação** — Corrigido: `requireSession` + verificação de tenant na conversa.
>
> 7. ✅ **`GET /api/gestao/overview` só com `?tenantId=`** — Corrigido: `requireSession`.
>
> 8. ⏳ **`SupervisorEngine.runChecks()`** — Query sem `WHERE tenantId`. Arquivo: `src/lib/valentina/supervisor-engine.ts` linha ~62.
>
> 9. ⏳ **`SdrEngine` fallback de agentConfig** — Busca qualquer config de tipo `"sdr"` sem filtrar por tenant. Arquivo: `src/lib/valentina/sdr-engine.ts` linha ~127.
>
> 10. ✅ **`useState("tecfag")` no frontend** — Corrigido na Entrega 2: tenant padrão antes do login é `null` em `src/hooks/useChatState.tsx`.
>
> 11. ⏳ **Prompt de IA hardcoded para Valem** — `src/lib/valentina/sdr-engine.ts` linha ~294.
>
> 12. ✅ **`recipientPhone` do body em `/api/whatsapp/send`** — Corrigido na Entrega 2: telefone de destino é obtido exclusivamente do banco via `conversationId`.
>
> 13. ✅ **Webhook Meta processa apenas `entry[0].changes[0]`** — Corrigido na Entrega 3: iteração completa sobre todas as entries e todos os changes do lote, com retenção de eventos órfãos.



## 📱 Histórico e Backup do WhatsApp (Migração Valem)

> [!NOTE]
> Para a migração da operação de chat do tenant **valem**, foi realizado com sucesso o backup criptografado do **WhatsApp Business** diretamente do celular físico (Samsung A23 de Denys) para o computador.
>
> * **Arquivo de Backup Local:** `C:/Users/TEC FAG/.gemini/antigravity/brain/af233ee8-75b8-405c-8628-1de0b5a0d50b/scratch/msgstore.db.crypt14`
> * **Tamanho do Arquivo:** ~80.5 MB (Apenas mensagens e contatos estruturados, sem mídias).
> * **Status da Migração:** O arquivo está salvo no PC. A extração da chave (`key`) e a descriptografia/importação serão feitas no "Dia da Virada" de chave oficial, utilizando o método do emulador ou extração da chave do celular, evitando deslogar o WhatsApp de produção prematuramente.

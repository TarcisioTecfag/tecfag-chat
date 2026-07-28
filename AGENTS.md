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

## 🤖 REGRA ESTRITA DE ARQUITETURA DE I.A. (MANDATÓRIA)

> [!CAUTION]
> **PROVEDOR ÚNICO DE I.A. NO PROJETO — GOOGLE VERTEX AI**
> 
> 1. **Uso Exclusivo de Credenciais**: Todas as chamadas de Inteligência Artificial no sistema DEVEM utilizar **unicamente** as credenciais da Service Account do **Google Vertex AI** (fornecidas via arquivo local `vertex-key.json` ou variável de ambiente `GOOGLE_SERVICE_ACCOUNT_JSON` / `VERTEX_SERVICE_ACCOUNT_JSON`).
> 2. **Proibição Absoluta de Outros Provedores**: É **estritamente proibido** integrar, importar ou utilizar APIs diretas de terceiros (ex: OpenAI direct keys, Groq SDK, Anthropic, Gemini API keys públicas) em qualquer módulo deste sistema.
> 3. **Integração Centralizada**: Qualquer desenvolvimento atual ou futuro que necessite de recursos de I.A. (texto, áudio, multimodal, JSON estruturado, transcrição ou RAG) DEVE ser implementado através do serviço central `vertexAi` (`src/lib/vertex-ai.ts`).
> 4. **Repasse Obrigatório de Custos**: Todas as chamadas ao `vertexAi.generateText` ou `vertexAi.generateStructuredJson` DEVEM fornecer os parâmetros de contexto (`feature`, `tenantId`, `metadata`) para garantir o registro automático e o repasse de **100% dos custos** para o painel financeiro na aba **Custos** do Monitoramento.

## 📱 Histórico e Backup do WhatsApp (Migração Valem)

> [!NOTE]
> Para a migração da operação de chat do tenant **valem**, foi realizado com sucesso o backup criptografado do **WhatsApp Business** diretamente do celular físico (Samsung A23 de Denys) para o computador.
>
> * **Arquivo de Backup Local:** `C:/Users/TEC FAG/.gemini/antigravity/brain/af233ee8-75b8-405c-8628-1de0b5a0d50b/scratch/msgstore.db.crypt14`
> * **Tamanho do Arquivo:** ~80.5 MB (Apenas mensagens e contatos estruturados, sem mídias).
> * **Status da Migração:** O arquivo está salvo no PC. A extração da chave (`key`) e a descriptografia/importação serão feitas no "Dia da Virada" de chave oficial, utilizando o método do emulador ou extração da chave do celular, evitando deslogar o WhatsApp de produção prematuramente.


# Implementação do controle de acesso — 22/10/2026

**Situação: em andamento, alterações locais, sem implantação.** Esta entrega contém correções nas rotas e no painel atual e prepara o avaliador da política nova. O controle completo descrito no plano ainda não está ativo em todos os módulos.

## Preservação das configurações existentes

Foram produzidos backups separados por tenant, em transação PostgreSQL somente leitura, usando o banco configurado no `.env`. Não foi comprovado que esse banco corresponde ao banco da implantação em produção.

Os arquivos ficam fora do Git, em `C:/Users/TEC FAG/.codex/private/access-control/2026-10-22/`:

| Tenant | Backup | SHA-256 do conteúdo protegido |
|---|---|---|
| Valem | `valem-before-access-c35180.json` | `a9b36373936a986fe20e3d031abeb2ba9b172fe69ba52f0552c5a9f144d8cf67` |
| Tecfag | `tecfag-before-access-c35180.json` | `43093b6316edf91c14312d1ed0ca2336297eaac8e8a9df9aed94f3b4017f1061` |

Os backups contêm configurações brutas dos grupos, IDs/papéis/vínculos dos operadores e setores. Não contêm senhas, tokens ou chaves de integração. Foram preservados campos desconhecidos e legados.

| Situação encontrada nesse banco | Valem | Tecfag |
|---|---:|---:|
| Grupos cadastrados | 2 | 2 |
| Operadores | 2 | 35 |
| Operadores sem `groupId` | 2 | 35 |
| Referências não nulas a grupo inexistente | 0 | 0 |
| Operadores com papel `admin` | 0 | 1 |
| Coluna `access_groups.permissions` existente | Não | Não |

Os 37 vínculos pendentes são campos `groupId` vazios. **Não foram atribuídos grupos por nome, e-mail, papel ou inferência.** A ausência de administrador na amostra da Valem também exige conferir o ambiente e a administração efetiva antes de ativar uma política restritiva.

A migração SQL `src/db/migrations/0011_access_groups_permissions.sql` já existe no projeto, mas não foi aplicada durante este trabalho. A instalação precisa ter seu esquema conferido antes de executar as rotas que leem/escrevem permissões granulares.

As prévias `valem-migration-preview-v1.json` e `tecfag-migration-preview-v1.json`, na mesma pasta privada, verificam a integridade dos backups, conservam os originais e apontam pendências. Ambas retornam `activationAllowed: false`. São propostas para revisão; seus escopos conservadores não reproduzem automaticamente todos os defaults e bypasses legados.

## Correções implementadas no caminho atual

- **Grupos:** revisão do registro para detectar edição concorrente; salvamento confirmado pelo servidor; merge que conserva campos não enviados e desconhecidos; validação de tipos e aliases; cópia antes/depois no histórico, na mesma transação da alteração; exclusão bloqueada enquanto houver operadores vinculados.
- **Painel:** correção das 15 chaves incompatíveis identificadas no inventário; exposição dos controles CRM, incluindo excluir e exportar separadamente; módulos comerciais adicionais; remoção da ampliação de acesso por nome/e-mail editável.
- **CRM:** os 34 handlers de subrecursos de negócio validam a leitura da negociação pai com tenant e responsável; lote/exportação recebem um recorte de operador definido pelo servidor; exclusão/exportação exigem capacidades próprias; transição para etapa terminal exige fechamento mesmo sem `status` no corpo; status de proposta verifica também o negócio da URL.
- **Voz:** objetivos, agenda, enriquecimento e disparo passam por sessão e capacidades; GET de objetivos não cria seeds; agenda/objetivos atualizam apenas campos permitidos; tenant não é alterável pelo corpo; outbound usa tenant obrigatório e configuração do serviço, sem credenciais padrão embutidas nesse helper.
- **Push:** cadastro/remoção derivam a identidade da sessão; remoção verifica tenant e dono; troca de operador no mesmo navegador exige as mesmas chaves de inscrição.
- **Distribuição e tarefas:** alterações de setor exigem administrador; alteração de carteira verifica capacidade; atualização de tarefas verifica autoria/atribuição e evita modificar tarefa legada de outro e-mail.
- **Conversas, filas, canais, mídia e eventos (Etapa 2):**
  - `src/lib/access-control/conversation-policy.ts`, `conversation-access.ts`, `conversation-events.ts` e `channel-permissions.ts` centralizam o predicado de visibilidade e escrita de conversas (`conversationReadCondition(session)`, `canReadConversation`, `requireConversationAccess`, `requireConversationWriteAccess`), exigindo simultaneamente módulo `views.chat`, tenant da sessão, canal permitido no grupo (`allowedChannels`), permissão da fila específica (`canViewQueueMine`, `canViewQueueWaiting`, `canViewQueueBot`, `canViewQueueClosed`) e respeito à restrição estrita `restrictToOwnChats` (que prevalece inclusive sobre `canViewAllChats` e sobre o papel `admin`).
  - Listagem (`GET /api/chats`), revalidação de IDs em cache local (`POST /api/chats` com `checkAccessIds`, sem carregar mensagens), leitura de histórico (`GET /api/chats/$chatId/messages`), persistência de mensagens/notas internas (`POST /api/chats` com revalidação transacional `FOR UPDATE` da posse da conversa antes de inserir/atualizar), envios/reações/presença WhatsApp e Baileys (`/api/whatsapp/send`, `/api/whatsapp/react`, `/api/whatsapp/presence`, `/api/baileys/send`, `/api/baileys/send-media`, `/api/baileys/presence`), leitura de mídia (`/api/baileys/media`, bloqueando acesso ao disco e `base64Data` antes da autorização da conversa), transição de fila (`/api/chats/update-queue`), resolução (`/api/chats/resolve`) e vínculo de tag/tarefa (`/api/chats/tag-task`) aplicam o recorte de conversa e canal.
  - Gestão de conexão WhatsApp (`/api/baileys/connect`, `/api/baileys/disconnect`, `/api/baileys/status`, `/api/whatsapp/meta-state`) e monitoramento global de visitantes do site (`/api/livechat/visitors`, `/api/livechat/metrics`, `/api/livechat/visitor/$visitorId` e `livechatWs.ts`) exigem capacidades explícitas (`canManageWhatsappConnection` e `canMonitorAllSiteVisitors`), negando perfis administrativos sem a respectiva permissão ativa. Ações operacionais no LiveChat (`applyOperatorChatAction` em `livechatDb.ts`) validam posse e transição sob lock `FOR UPDATE`.
  - O stream SSE (`/api/events`) revalida a sessão a cada evento, filtra payloads via `filterConversationEvent`, encerra o stream com `access_changed` livre de conteúdo caso o acesso seja revogado e bloqueia eventos `qr` sem `canManageWhatsapp`. O disparo de Web Push (`sendPushToTenant`) filtra destinatários pela visibilidade efetiva da conversa.
  - Vínculos de conversas em negócios e contas do CRM (`crmService.getDealById`, `getDealConversations`, `getAccountById`, `getAccountConversations`), histórico de contatos (`/api/contacts/$contactId/history`) e supervisão ao vivo (`/api/gestao/live`, `/api/gestao/messages`) aplicam `conversationReadCondition(session)`.
- **Painéis consolidados de gestão (`/api/gestao/*`):**
  - `overview.ts`, `alerts.ts`, `audits.ts` (`GET` e `PATCH`), `performance.ts`, `sla.ts`, `contacts-analytics.ts`, `costs.ts`, `reports.ts`, `reports-v2.ts`, `report-workflow.ts`, `my-metrics.ts` e `operator-history.ts` substituíram o bloqueio exclusivamente por `role` pela verificação explícita de módulo e capacidade granular (`monitor.canAccessRanking`, `monitor.canAccessAlerts`, `monitor.canAccessAudits`, `monitor.canManageAudits`, `analytics.canAccessOverview`, `analytics.canAccessPerformance`, `analytics.canAccessSla`, `analytics.canAccessContacts`, `analytics.canAccessCosts`, `analytics.canAccessAiReports`).
  - As consultas agregadas sobre conversas, alertas/logs de SLA, auditorias de IA e contatos (`overview.ts`, `alerts.ts`, `audits.ts`, `performance.ts`, `sla.ts`, `contacts-analytics.ts`, `my-metrics.ts`) aplicam `conversationReadCondition(session)` (e `wallet_only` em `contacts-analytics.ts`), impedindo também a inspeção cruzada de métricas/histórico de outros operadores quando `restrictToOwnChats` está ativo ou a leitura de terceiros não é autorizada.

Essas correções reduzem de forma expressiva os bypasses por papel administrativo em conversas, canais e painéis de gestão, mas ainda restam rotas administrativas/operacionais adicionais e a integração completa do motor v2 (`catalog.ts` / `policy.ts` / `delegation.ts`) com persistência de políticas em banco.

## Núcleo novo preparado, ainda sem ativação nas rotas

`src/lib/access-control/catalog.ts`, `policy.ts` e `delegation.ts` implementam e testam:

- Catálogo de 14 módulos e 156 ações independentes para negócios, componentes CRM, funis, conversas, contatos, carteiras, tarefas, administração, IA, voz e integrações.
- Escopos próprios, autoria, carteira, equipe, compartilhamento por ação, sem responsável e todos.
- Restrições simultâneas de funil, setor, canal e fila; limite de leitura/escrita por campo e expiração.
- Negação por módulo também para administrador; isolamento de tenant antes de qualquer concessão.
- Uma regra inteira precisa satisfazer a solicitação. Não há união indevida de pedaços de duas regras para autorizar uma alteração.
- Delegação limitada às ações, campos, escopos e prazos do administrador; “meus registros” do administrador não pode ser transferido como “meus registros” de outra pessoa. Atribuição de proprietário do tenant permanece uma operação separada.

Os atributos de equipe, dono, carteira, fila e compartilhamento precisam ser resolvidos pelo servidor em cada integração. O avaliador puro não transforma dados recebidos do cliente em autoridade.

O núcleo **não está conectado às sessões, consultas, eventos ou formulários operacionais**. As regras de delegação precisam ser validadas para todos os membros afetados ao editar um grupo e persistidas com lock, revisão e auditoria. A proteção do último gestor e a recuperação administrativa ainda precisam de implementação.

`ACCESS_CONTROL_STRICT_TENANTS` permanece desativado. No código atual, essa chave apenas permite preparar a negação a agentes sem grupo; ela não significa que a política v2 foi implantada. O comportamento legado de sessão foi mantido para os tenants não ativados.

## Validação desta entrega

- `npm run test:access`: **183 testes passaram** (11 suítes), sem falhas ou testes ignorados. Os handlers são executados com importações operacionais bloqueadas e banco/serviços simulados.
- `npm run test:triage`: **332 testes passaram** (38 suítes), validando compatibilidade integral com os fluxos de triagem industrial, LiveChat e canais.
- `npm run build`: build de cliente e servidor concluído. Foi usado `IS_TEST=true` e uma conexão deliberadamente indisponível, sem executar a aplicação contra o banco real.
- TypeScript: os mesmos **31 diagnósticos** no HEAD `b7dba7cdf24bbe69bb22a597f812d6fa2b9f77e9` e no código alterado, sem diagnóstico adicional. A comparação ignora deslocamentos de linha e considera arquivo, código, mensagem e multiplicidade. Os módulos puros novos de política, delegação e prévia de migração também passaram na checagem isolada, com `strict`.
- Backup: duas capturas reais somente leitura e duas prévias offline geradas com sucesso. Nenhum `UPDATE`, seed, DDL, deploy ou ativação de tenant foi executado no banco.

Os testes simulados não substituem ensaio em PostgreSQL de teste, teste de concorrência real, jornada de interface e verificação de todos os transportes de eventos. O build apresenta avisos de tamanho de chunks, externalização de módulos e imports dinâmicos; não são evidência de isolamento de acesso.

Resumo verificável: [validacoes-implementacao.json](./validacoes-implementacao.json). Logs detalhados desta execução estão na pasta temporária local; os backups e as prévias permanecem na pasta privada indicada acima.

## Próximas entregas necessárias

| Parte do plano | Situação após esta entrega |
|---|---|
| AC-01 — inventário | Baseline documentado; atualizar a cobertura a cada integração nova |
| AC-02/03 — preservação e classificação | Backups e prévias feitos; ensaio de restauração, ambiente e vínculos ainda pendentes |
| AC-04 a AC-09 — correções iniciais | Implementação parcial com testes; callbacks de voz, contatos e concorrência adicional continuam pendentes |
| AC-10 a AC-13 — catálogo, avaliador e delegação | Núcleo puro preparado; faltam persistência, resolução confiável de contexto e adoção nas rotas |
| AC-14 a AC-16 — revogação, editor e inspeção | Painel legado corrigido, revisão no salvamento e invalidação SSE (`access_changed`); editor v2 e diagnóstico efetivo ainda pendentes |
| AC-17 a AC-20 — CRM e funis completos | Proteções de pai, lote, transição e filtro de conversas vinculadas feitas; ações por componente, campos e funis específicos ainda pendentes |
| AC-21 a AC-24 — dados, conversas e painéis | “Só Meus”, filas independentes, canais, mídia, SSE/WS/push, vínculos CRM e painéis consolidados `/api/gestao/*` implementados e testados |
| AC-25 a AC-28 — módulos e administração | Bypasses administrativos removidos em conexões WhatsApp, LiveChat e painéis `/api/gestao/*`; cobertura administrativa restante ainda pendente |
| AC-29 a AC-33 — ensaio e implantação | Ainda não iniciados; dependem da cobertura, dos vínculos e do aceite operacional |

O trabalho seguinte é conectar o núcleo v2 à persistência e edição de políticas em rascunho, concluir a cobertura administrativa/contatos restante e realizar o ensaio em banco de teste antes de qualquer ativação progressiva, preservando a operação da Valem.

Referências: [plano de implementação](./PLANO-IMPLEMENTACAO.md), [mapa do estado inicial](./MAPA-CONTROLE-DE-ACESSO.md). Os inventários originais permanecem como evidência do estado anterior às correções.

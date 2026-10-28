# Auditoria forense de completude funcional — Tecfag Chat

Data: 27/10/2026. Escopo: código local de frontend, APIs, motores e consultas; tenant Tecfag e persona Fagner. Base Git: `faf5cb246febd587acb7e89c22a4348578558ef7`, incluindo as alterações locais já existentes no início da análise. Não houve alteração de código operacional, migração, ativação de motor, envio externo ou acesso ao PostgreSQL de produção.

Esta é uma auditoria do que o código consegue entregar. Credenciais, configuração efetiva dos agentes, jobs em execução, volume de dados e implantação no servidor não foram verificados em produção. “Confirmado” significa comprovado no código ou na reprodução isolada indicada; não significa incidente observado em produção. Notas são julgamento de engenharia sobre completude, não percentuais de testes aprovados.

Validações executadas: `npm run test:triage` — **341/341 passaram**; `npm run test:access` — **188/188 passaram**; `tsc --noEmit --pretty false` — **falhou, saída 2, 108 diagnósticos de erro**. Os testes exercitam regras, componentes/rotas com dependências isoladas e contratos; não comprovam integrações de produção. Reprodução em PGlite, PostgreSQL isolado em memória: consulta equivalente à de setores retorna **SQLSTATE 42803**. Log TypeScript: `.codex-audit/functional-completeness-2026-10-27/typescript.txt`.

Observação mandatória de implantação: o AGENTS.md descreve SDR/Supervisor/QA desativados para Tecfag até go-live, mas o código atual não é uniforme: `isSdrTenant` aceita as duas personas; Supervisor itera essa função; QA ainda bloqueia o enfileiramento de Tecfag. Não classifiquei uma constante/comentário antigo como bloqueio sem rastrear seu uso. Também não considerei imports de tipos de arquivos chamados `mockData` como evidência de dados falsos.

## 1. 🔴 FUNÇÕES INOPERANTES, QUEBRADAS OU TRAVADAS NO TENANT `tecfag`

**R01 — Estatísticas / Desempenho / consulta por setor — confirmado, alta prioridade**

- **Componente:** [src/routes/api/gestao/performance.ts:193](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/routes/api/gestao/performance.ts:193>) e [src/routes/api/gestao/performance.ts:262](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/routes/api/gestao/performance.ts:262>).
- **Quebra:** a consulta seleciona `AVG(response_time_seconds)` junto com `is_overdue`, sem `GROUP BY`. PostgreSQL rejeita a query quando o ramo de setores cadastrados é executado. O catch devolve HTTP 200 com `volumes`, `channels` e `sectors` vazios, apagando inclusive consultas anteriores que funcionaram. Reprodução equivalente em PGlite confirmou SQLSTATE 42803.
- **Correção fim a fim:** agregar média, contagem elegível e violações na mesma consulta por setor; usar `COUNT(*) FILTER`/`SUM(CASE...)` ou agrupar explicitamente. Devolver erro/indisponibilidade no contrato, preservar resultados parciais identificados e testar setor com tempos respondidos e pendentes.

**R02 — Estatísticas / SLA, alertas e ranking sem alimentação equivalente para Meta e site — confirmado**

- **Arquivos:** [src/lib/baileys/session-manager.ts:1598](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/lib/baileys/session-manager.ts:1598>), [src/lib/whatsapp/inbound.ts:98](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/lib/whatsapp/inbound.ts:98>), [src/lib/whatsapp/dispatch.ts:150](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/lib/whatsapp/dispatch.ts:150>), [src/lib/livechat/site-conversation-store.ts:1](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/lib/livechat/site-conversation-store.ts:1>).
- **Quebra:** a escrita operacional de `responseTimeLogs` e a chamada de `updateResponseMetrics` estão no caminho Baileys. Inbound Meta e dispatch universal não abrem/fecham esses mesmos ciclos; o site tampouco alimenta essa tabela. Portanto, se Tecfag operar por Meta, os painéis que dependem desses logs não medem esse tráfego. Não é bloqueio por nome do tenant: é lacuna de instrumentação por caminho de canal.
- **Correção:** centralizar eventos de mensagem recebida, mensagem humana aceita, atribuição e encerramento; integrar todos os adaptadores e deduplicar por ID externo/interno. Reaproveitar a infraestrutura de eventos já existente, mantendo tenant, conversa e conexão como dimensões.

**R03 — Gestão Comercial / TMA depois da transferência automática do Fagner — confirmado**

- **Arquivos:** [src/lib/commercial/tma.ts:11](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/lib/commercial/tma.ts:11>), [src/routes/api/chats/update-queue.ts:337](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/routes/api/chats/update-queue.ts:337>), [src/lib/triage/industrial-handoff-store.ts:410](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/lib/triage/industrial-handoff-store.ts:410>), [src/lib/triage/industrial-handoff-store.ts:605](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/lib/triage/industrial-handoff-store.ts:605>), [src/lib/whatsapp/dispatch.ts:165](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/lib/whatsapp/dispatch.ts:165>).
- **Quebra:** `recordCommercialTransfer` é chamado na atualização manual da fila. O handoff industrial grava diretamente `queueState: "meus"` e o operador, sem criar `commercialTransferResponseEvents`. A primeira resposta só fecha um evento previamente pendente. Assim, o fluxo automático central da Tecfag fica fora do TMA comercial. Transferências pelo rodízio também precisam do mesmo evento.
- **Correção:** inserir o evento na transação de atribuição, cobrindo handoff, reatribuição, tomada manual e cancelamento. Preservar a primeira resposta aceita e reconciliar eventos perdidos. A existência de perfil comercial é requisito adicional no código atual, não deve ser confundida com zero de atendimento.

**R04 — Monitoramento / QA, score e satisfação da Tecfag — bloqueio explícito de implantação**

- **Arquivos:** [src/lib/audit-service.ts:456](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/lib/audit-service.ts:456>), [src/lib/audit-service.ts:266](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/lib/audit-service.ts:266>), [src/lib/audit-playbook.ts:11](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/lib/audit-playbook.ts:11>).
- **Trava:** `enqueueAudit` retorna para qualquer tenant diferente de Valem. O worker aceita os tenants de `isSdrTenant`, mas novas finalizações da Tecfag não entram na fila por esse método. Score e sentimento derivados de auditoria ficam sem amostra nova. `buildAuditPrompt` usa playbook Valem, ainda com trechos `[PERSONALIZAR]`, sem seleção por tenant.
- **Correção:** tratar como pendência de go-live: aprovação operacional da ativação, configuração independente por feature/tenant, playbook industrial da Tecfag carregado de configuração filtrada e critérios de máquinas, peças e assistência. Não basta remover o `if`. Até lá, a UI deve mostrar “QA desativado”, não simular qualidade.

**R05 — Relatórios / colisão de ID entre tenants — confirmado, bloqueador multi-tenant**

- **Arquivos:** [src/lib/report-builder.ts:501](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/lib/report-builder.ts:501>), [src/db/schema.ts:712](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/db/schema.ts:712>), [src/lib/sla-engine.ts:224](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/lib/sla-engine.ts:224>).
- **Quebra:** o ID diário é `d-AAAA-MM-DD`; o semanal é o código da semana. `ai_reports.id` é chave primária global. Valem e Tecfag gerando o mesmo período produzem o mesmo ID; o segundo INSERT falha. O filtro por tenant na busca de existência não resolve a unicidade global.
- **Correção:** UUID ou ID que incorpore tenant; unicidade separada em `(tenant_id,type,period)`, com migração preservando versões/feedback/FKs. Testar geração para dois tenants no mesmo dia e semana, sem modificar histórico publicado.

**R06 — Relatórios / WhatsApp da Tecfag é envio simulado — confirmado**

- **Arquivos:** [src/lib/report-dispatcher.ts:64](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/lib/report-dispatcher.ts:64>), [src/lib/report-dispatcher.ts:175](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/lib/report-dispatcher.ts:175>).
- **Quebra:** `sendWhatsApp` escolhe Baileys por `tenantId === "valem"`; no outro ramo apenas registra `[MOCK Meta API]` e retorna. O chamador adiciona o número a `whatsappSent` mesmo sem envio. Tecfag pode receber confirmação de distribuição inexistente. A escolha também ignora a configuração de canal por tenant.
- **Correção:** usar o transporte central e a conexão configurada, verificar aceite do provedor e manter recibo por destinatário. Para Meta, respeitar a política/template do canal já implementada no projeto. Falha ou indisponibilidade nunca pode virar sucesso.

**R07 — Relatórios / PDF e agendamento — botões sem implementação**

- **Componente:** [src/components/reports/ReportsIATab.tsx:421](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/components/reports/ReportsIATab.tsx:421>).
- **Quebra:** “Exportar PDF” e “Agendar no WhatsApp” não têm `onClick`, link ou submissão associada. Não há exportação Excel/ação de impressão conectada nessa aba. O envio imediato possui handler e não deve ser confundido com esses botões.
- **Correção:** vincular exportação ao snapshot/versionamento persistido do relatório, implementar PDF/print e planilha quando oferecida; conectar agendamento à configuração/job existente com destinatários e resultado verificável.

**R08 — Relatórios / re-síntese altera o período dos dados — confirmado**

- **Arquivos:** [src/routes/api/gestao/report-workflow.ts:169](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/routes/api/gestao/report-workflow.ts:169>), [src/lib/report-builder.ts:435](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/lib/report-builder.ts:435>).
- **Quebra:** rejeitar um relatório antigo chama `buildStoredReport(report.period, now)`. O builder usa `date`, não o código `period`, para consultar o banco. Um relatório antigo pode passar a conter dados de hoje/últimos sete dias com o identificador do período antigo.
- **Correção:** persistir limites absolutos e timezone do período, reutilizar os limites na re-síntese e separar data de geração de data dos fatos. Usar job persistente para re-síntese e estado explícito de processamento/erro em vez de timer fixo de 12 segundos na UI.

**R09 — Relatórios / estado “enviado” sem distribuição comprovada — confirmado**

- **Arquivo:** [src/routes/api/gestao/report-workflow.ts:95](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/routes/api/gestao/report-workflow.ts:95>), [src/routes/api/gestao/report-workflow.ts:249](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/routes/api/gestao/report-workflow.ts:249>).
- **Quebra:** `dispatch` marca enviado mesmo quando todos os canais falham ou são pulados. `advance-stage` também permite avançar de aprovado para enviado sem executar distribuição. Na UI, avanço/rejeição atualizam estado antes de conferir resposta HTTP ([src/components/reports/ReportsIATab.tsx:111](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/components/reports/ReportsIATab.tsx:111>)).
- **Correção:** restringir transições, conferir o resultado por canal/destinatário, representar parcial/falha, impedir avanço editorial para enviado e só confirmar a UI depois da persistência. Adicionar proteção contra envios concorrentes e reenvio de destinatário já entregue.

**R10 — Estatísticas / atalhos da Visão Geral — confirmado**

- **Arquivos:** [src/components/chat/AnalyticsView.tsx:783](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/components/chat/AnalyticsView.tsx:783>), [src/components/chat/MonitorView.tsx:490](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/components/chat/MonitorView.tsx:490>), [src/components/chat/MonitorView.tsx:564](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/components/chat/MonitorView.tsx:564>).
- **Quebra:** `OverviewTab` renderiza atalhos para alertas/auditorias, mas Analytics passa `onSwitchTab={() => {}}`. Os controles aparecem clicáveis e não navegam.
- **Correção:** mapear para Monitor/aba correta usando navegação central, verificando permissões; ou não renderizar ação que o contexto não consegue oferecer.

**R11 — Monitor / Ao Vivo / filtro de data — confirmado**

- **Arquivo:** [src/routes/api/gestao/live.ts:55](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/routes/api/gestao/live.ts:55>).
- **Quebra:** o filtro aplica apenas `lastMessageTime >= início do dia`, sem fim do dia. Selecionar uma data antiga inclui datas posteriores. A rota também exige conversa atualmente não finalizada; não é histórico operacional daquele dia.
- **Correção:** aplicar intervalo `[início,fim)` em America/Sao_Paulo e definir se a aba oferece “ativas atualizadas no dia” ou inspeção histórica. Para histórico real, consultar eventos/mensagens do período, sem depender apenas do estado atual.

**R12 — Monitor / Ao Vivo / recorte de mensagens distorce espera — confirmado**

- **Arquivo:** [src/routes/api/gestao/live.ts:153](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/routes/api/gestao/live.ts:153>).
- **Quebra:** a query pega as mil mensagens mais recentes globalmente, inverte o array e guarda as primeiras 50 de cada conversa. Conversas longas podem ficar com as mais antigas dentro desse recorte, perdendo a mensagem realmente mais recente. `isUnanswered` e espera usam a última mensagem desse array truncado; notas internas também entram no cálculo.
- **Correção:** buscar última mensagem pública por conversa para espera e usar janela/consulta lateral para as últimas N de cada conversa; ordenar cronologicamente só depois. Paginar histórico e deixar notas internas fora da definição de resposta externa.

**R13 — Monitor / Visitantes do Site — casca visual confirmada**

- **Componente:** [src/components/chat/SiteVisitorsTab.tsx:9](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/components/chat/SiteVisitorsTab.tsx:9>).
- **Quebra:** não realiza fetch/WebSocket; cards mostram travessões e “Feature em desenvolvimento”. Não há lista, histórico, permanência ou abordagem nessa aba.
- **Correção:** conectar `livechat/visitors`, detalhe de visitante e eventos `visitors_snapshot`/`visitor_updated`, com autorização existente. Reaproveitar pageviews, contexto de página, origem e ações de operador já presentes no backend. O widget já envia conexão, heartbeat e `PAGE_UPDATE`; não falta começar a integração do zero ([tecfag-widget/src/components/ChatWidget/ChatWidget.tsx:249](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/tecfag-widget/src/components/ChatWidget/ChatWidget.tsx:249>), [src/lib/livechat/livechatWs.ts:470](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/lib/livechat/livechatWs.ts:470>)).

**R14 — Fagner / Vendedor — casca visual confirmada**

- **Componente:** [src/components/valentina/VendedorTab.tsx:9](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/components/valentina/VendedorTab.tsx:9>).
- **Quebra:** renderiza cadeado, “Em desenvolvimento” e uma lista de roadmap. Não há consultas, propostas automáticas, follow-ups ou previsão operacional implementados nessa aba.
- **Correção:** finalizar somente o escopo já anunciado, por etapas, usando CRM e tarefas existentes. Até haver fluxo real, a área não deve ser apresentada como ferramenta disponível. Não confundir com criação manual de proposta existente no CRM.

**R15 — Chat / respostas rápidas desktop e mobile — contrato incompatível confirmado**

- **Arquivos:** [src/components/chat/ChatPanel.tsx:4073](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/components/chat/ChatPanel.tsx:4073>), [src/components/chat/QuickResponsesPopover.tsx:19](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/components/chat/QuickResponsesPopover.tsx:19>), [src/components/chat/QuickResponsesPopover.tsx:515](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/components/chat/QuickResponsesPopover.tsx:515>), [src/components/mobile/MobileMessageInput.tsx:265](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/components/mobile/MobileMessageInput.tsx:265>).
- **Quebra:** os chamadores passam `onSelect`, `slashQuery`, `onCreateTemplate` etc.; o componente exige `onSelectResponse`, `slashFilterText`, `onCreateGlobal`, `onCreateIndividual` etc. Ao selecionar um item ele chama uma função não recebida; criação/edição/exclusão têm o mesmo desacordo. A checagem TypeScript confirma a incompatibilidade.
- **Correção:** alinhar props dos dois chamadores com o contrato atual; testar seleção, filtro por barra, edição global/pessoal e preenchimento de variáveis. O problema existe na árvore local auditada, que já possuía alterações não commitadas.

**R16 — Contatos/CRM / consulta de CNPJ da conta — confirmado**

- **Arquivos:** [src/components/crm/AccountDetailModal.tsx:174](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/components/crm/AccountDetailModal.tsx:174>), [src/lib/valentina/cnpj-service.ts:30](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/lib/valentina/cnpj-service.ts:30>), [src/lib/valentina/cnpj-service.ts:165](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/lib/valentina/cnpj-service.ts:165>).
- **Quebra:** a UI testa `info.found`, mas o serviço retorna `valid`, sem `found`. Mesmo resultado válido cai em “CNPJ não encontrado”. Telefone/e-mail estão em `details`, não no topo esperado pela UI. A tela também acessa `accountData.account.address`, embora o DTO de detalhe estenda a própria conta.
- **Correção:** usar contrato `valid/details`, preservar distinção entre documento inválido e consulta indisponível, corrigir shape da conta e normalizar campos textuais/arrays de QSA/CNAE antes de renderizar e salvar.

**R17 — Monitor / Tarefas Globais não contém tarefas do CRM local — confirmado**

- **Arquivos:** [src/routes/api/gestao/tasks.ts:35](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/routes/api/gestao/tasks.ts:35>), [src/routes/api/tasks.ts:202](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/routes/api/tasks.ts:202>).
- **Quebra:** o monitor lê apenas tabela legada `tasks`; a tela de tarefas operacional possui caminho de atividades de `crmDealActivities`. Tarefa criada no Kanban pode funcionar no CRM e ficar invisível na gestão global.
- **Correção:** compartilhar a projeção de tarefas, unir fontes com tipo/origem e identidade estável, aplicar tenant e escopo da equipe, oferecer paginação e agregados sem truncamento.

**R18 — Tarefas / conclusão apresenta sucesso mesmo com HTTP 4xx/5xx — confirmado**

- **Arquivos:** [src/components/chat/TasksView.tsx:317](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/components/chat/TasksView.tsx:317>), [src/components/chat/MonitorView.tsx:2443](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/components/chat/MonitorView.tsx:2443>).
- **Quebra:** a UI altera otimisticamente e aguarda `fetch`, mas não testa `response.ok`. HTTP 403/404/500 não lança exceção; o rollback não acontece. O gestor pode enxergar tarefa alheia como concluída apesar da negativa de escrita. `completed` também não é tratado pelo toggle como `done`.
- **Correção:** conferir resposta, erro visível e rollback/revalidação. Normalizar estados e separar permissão de visualizar tarefa de permissão de concluir a tarefa de outra pessoa.

**R19 — Voz / chamada da Tecfag utiliza persona e contexto Valem — confirmado**

- **Arquivos:** [src/lib/voice/outbound-call-service.ts:59](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/lib/voice/outbound-call-service.ts:59>), [src/routes/api/twilio-voice-webhook.ts:21](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/routes/api/twilio-voice-webhook.ts:21>), [src/routes/api/twilio-voice-webhook.ts:143](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/routes/api/twilio-voice-webhook.ts:143>), [src/routes/api/twilio-voice-webhook.ts:250](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/routes/api/twilio-voice-webhook.ts:250>).
- **Quebra:** o serviço padrão envia ao webhook que fixa `TENANT_ID = "valem"`, usa prompt/custos desse tenant e saudação Valentina/Valem. O tenant recebido no disparo não é transportado/resolvido com segurança ao longo da chamada.
- **Correção:** vínculo persistente de CallSid com tenant, operador e objetivo; resolver contexto no webhook validado e usar `getAiPersona`. Remover empresa, voz e domínio fixados no caminho compartilhado. Não testar realizando chamadas reais durante a auditoria.

**R20 — Voz / disparo Twilio e histórico ElevenLabs não formam ciclo completo — confirmado no encadeamento**

- **Arquivos:** [src/lib/voice/outbound-call-service.ts:95](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/lib/voice/outbound-call-service.ts:95>), [src/routes/api/elevenlabs-conversations.ts:159](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/routes/api/elevenlabs-conversations.ts:159>), [src/routes/api/elevenlabs-conversations.ts:213](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/routes/api/elevenlabs-conversations.ts:213>).
- **Quebra:** o disparo devolve CallSid, enquanto dashboard/histórico buscam um agente ElevenLabs global e só exibem IDs que coincidam com `voiceCalls.id` ou `campaignId`. O serviço de disparo não persiste esse vínculo ElevenLabs; a consulta externa é limitada aos últimos 50 itens. Uma chamada Twilio disparada não fica automaticamente comprovada/listada/transcrita nessa tela.
- **Correção:** usar `voiceCalls` como fonte de verdade do tenant, persistir IDs por provedor e correlacionar status, gravação/transcrição e contato. Paginar a fonte e consolidar os adaptadores existentes. A permissão por tenant que evita exibir chamadas sem correspondência é correta e deve ser mantida.

**R21 — Fagner interno / contexto CRM e triagem usa campos inexistentes — confirmado por schema e TypeScript**

- **Arquivos:** [src/lib/valentina/assistant-engine.ts:232](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/lib/valentina/assistant-engine.ts:232>), [src/routes/api/valentina/messages.ts:1454](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/routes/api/valentina/messages.ts:1454>), [src/routes/api/valentina/messages.ts:1920](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/routes/api/valentina/messages.ts:1920>).
- **Quebra:** seleção de `agentFlowStates.extractedData/currentStage/updatedAt`, `conversations.lastClientMessageAt/lastOperatorMessageAt` e propriedades antigas de produtos/propostas/questionários não corresponde ao schema atual. Há catches que degradam o contexto para fallback; não é garantia de consulta profunda ao PostgreSQL. Outros diagnósticos atingem resumo de triagem e notificações.
- **Correção:** mapear campos reais (`collectedData`, `currentStep`, `lastInteractionAt`, timestamps de mensagens, `totalPrice` etc.), reutilizar DTOs/serviços centrais e validar a projeção com dados isolados. Não tratar toda falha de contexto como ausência de dados.

**R22 — Sentimento / isolamento incompleto e resultado não persistido — confirmado**

- **Arquivo:** [src/lib/valentina/sentiment-analyzer.ts:94](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/lib/valentina/sentiment-analyzer.ts:94>), [src/lib/valentina/sentiment-analyzer.ts:148](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/lib/valentina/sentiment-analyzer.ts:148>), [src/lib/valentina/sentiment-analyzer.ts:210](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/lib/valentina/sentiment-analyzer.ts:210>).
- **Quebra:** leituras de mensagens, conversa e contato usam só ID, sem predicado de tenant. A análise retorna score/sentimento e pode inserir notificação, mas não persiste série temporal/estado de sentimento que alimente Ao Vivo ou o ranking. O chamador Baileys não utiliza o retorno para armazenar uma medição.
- **Correção:** adicionar tenant em cada leitura/update e chave composta nos caches; persistir resultado com momento, conversa, fonte e confiança. Conectar consumidores autorizados e instrumentar Meta/site. Ausência do filtro é infração confirmada; não foi demonstrado vazamento de dados de produção.

**R23 — BI Comercial / cache sem escopo de sessão — risco concreto no código**

- **Arquivos:** [src/components/commercial/CommercialBiView.tsx:191](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/components/commercial/CommercialBiView.tsx:191>), [src/components/commercial/CommercialBiView.tsx:356](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/components/commercial/CommercialBiView.tsx:356>), [src/components/commercial/CommercialBiView.tsx:485](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/components/commercial/CommercialBiView.tsx:485>), [src/hooks/useChatState.tsx:4654](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/hooks/useChatState.tsx:4654>).
- **Problema:** cache em nível de módulo indexado somente por divisão, com TTL de 60s, sem tenant/operador/permissões. `load` depende só de divisão. A troca explícita de tenant recarrega a página e mitiga esse caminho; logout/login local não limpa esse cache. Pode haver reapresentação de dados anteriores ao remontar a tela no mesmo contexto JS.
- **Correção:** chave contendo tenant, sessão/operador e versão de permissões; limpar no logout/invalidação; incluir tenant nas dependências e cancelar respostas da sessão anterior. Não presumir que reload resolve todos os caminhos.

## 2. 🟠 FUNÇÕES COM DADOS MOCKADOS, ZERADOS OU CÁLCULOS FALSOS

**D01 — Monitor / ranking com gauges, históricos e posições chumbados**

- **Indicadores:** [src/components/chat/OperatorsRankingTab.tsx:367](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/components/chat/OperatorsRankingTab.tsx:367>), [src/components/chat/OperatorsRankingTab.tsx:565](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/components/chat/OperatorsRankingTab.tsx:565>), [src/components/chat/OperatorsRankingTab.tsx:624](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/components/chat/OperatorsRankingTab.tsx:624>), [src/components/chat/OperatorsRankingTab.tsx:669](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/components/chat/OperatorsRankingTab.tsx:669>), [src/components/chat/OperatorsRankingTab.tsx:705](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/components/chat/OperatorsRankingTab.tsx:705>).
- **Falsidade:** SLA 98%; sentimento 8,2; conversão 12% com gauge em 60%; fallback de 48 atendimentos e 04:12; “+12% vs média”; “2º Lugar / Top 1%”; volume mensal 1.240 e retenção 92%. Séries de horas/dias são arrays fixos. Isso ocorre no componente efetivamente usado, mesmo com `DEMO_MODE=false`.
- **Fonte correta:** agregados de mensagens/eventos de resposta, auditorias válidas, contatos únicos e negócios ganhos por responsável; séries por hora/dia retornadas pelo servidor. Mostrar N/A e tamanho da amostra onde o processo está desligado.

**D02 — Overview / comparações fabricadas a partir do nome**

- **Indicadores:** [src/routes/api/gestao/overview.ts:269](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/routes/api/gestao/overview.ts:269>).
- **Falsidade:** `charSum` gera scores, tempos e atrasos semanais/mensais e satisfação quando agregados faltam ou são zero. Base de satisfação pode assumir 80%. As janelas “lastWeek/lastMonth” consultam últimos 7/30 dias incluindo hoje, não o período anterior fechado.
- **Fonte correta:** períodos anteriores não sobrepostos, métricas diárias ponderadas por amostra e retorno `null` quando não houver amostra. Remover todos os fallbacks dependentes de nome.

**D03 — Desempenho / volume por canal mede contatos e recodifica site como WhatsApp**

- **Indicador:** [src/routes/api/gestao/performance.ts:123](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/routes/api/gestao/performance.ts:123>).
- **Erro:** usa `contacts.mainChannel`, conta contatos, não conversas. Agrupa Meta e Baileys em WhatsApp e qualquer canal desconhecido também; não há linha site. Mistura histórico total com volume semanal. Se não houver contatos elegíveis, atribui todas as conversas a WhatsApp.
- **Fonte correta:** conversas/mensagens por `channel`, provider e `whatsappConnectionId`, com join da conexão por tenant e recorte temporal comum. Separar canal de transporte (WhatsApp/Meta/Baileys) de origem comercial.

**D04 — Desempenho / setores padrão inventados**

- **Indicador:** [src/routes/api/gestao/performance.ts:228](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/routes/api/gestao/performance.ts:228>).
- **Erro:** sem setores cadastrados, cria Comercial/Suporte/Financeiro/Triagem e atribui todas as finalizações a Comercial, tempos zero e SLA 100%. Ausência de configuração vira organograma e qualidade fictícios.
- **Fonte correta:** setores reais, categoria “sem setor” para conversas sem vínculo e aviso de configuração ausente. SLA sem ciclo elegível deve ser `null`.

**D05 — Clientes / novos versus recorrentes é aproximação incorreta**

- **Indicador:** [src/routes/api/gestao/contacts-analytics.ts:79](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/routes/api/gestao/contacts-analytics.ts:79>).
- **Erro:** `recorrentes = max(0, total de conversas criadas - novos contatos)`, sem join com criação do contato e sem DISTINCT. Um contato novo com duas conversas pode virar recorrente; contato cadastrado sem atendimento também distorce o saldo. Escopos de carteira e conversa não são necessariamente equivalentes.
- **Fonte correta:** contar contatos distintos atendidos no período; classificar pela primeira interação anterior ao início da janela e/ou cadastro, com definição de negócio explícita e predicados coerentes.

**D06 — Clientes / frequência “mensal” e dias sem atendimento não correspondem ao rótulo**

- **Indicador:** [src/routes/api/gestao/contacts-analytics.ts:119](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/routes/api/gestao/contacts-analytics.ts:119>).
- **Erro:** frequência divide todas as conversas históricas por todos os contatos, sem mês. Dias sem atendimento faz média de cada conversa finalizada, não da última interação de cada cliente; cliente com muitos históricos pesa várias vezes.
- **Fonte correta:** coorte de contatos elegíveis e `MAX(última interação/conclusão)` por contato; frequência por janela mensal explicitada. Distinguir contato sem qualquer atendimento.

**D07 — Clientes / “conversão IA” é sentimento, com 100% sem amostra**

- **Arquivos:** [src/routes/api/gestao/contacts-analytics.ts:148](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/routes/api/gestao/contacts-analytics.ts:148>), [src/components/chat/AnalyticsView.tsx:411](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/components/chat/AnalyticsView.tsx:411>).
- **Erro:** `ragConversionPct` deriva de auditorias satisfeitas, não de conversão CRM nem uso de RAG, e assume 100% se não houver auditorias. No Tecfag, o bloqueio de QA torna esse cenário particularmente provável.
- **Fonte correta:** separar sentimento inferido, pesquisa CSAT e conversão comercial. Usar negócios ganhos/coorte elegível para conversão; `null` sem auditoria ou pesquisa.

**D08 — Relatórios / QA 8,0 e sentimento 85/10/5 sem auditoria**

- **Arquivos:** [src/lib/report-builder.ts:173](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/lib/report-builder.ts:173>), [src/lib/report-builder.ts:187](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/lib/report-builder.ts:187>), [src/lib/report-builder.ts:203](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/lib/report-builder.ts:203>), [src/routes/api/gestao/reports-v2.ts:164](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/routes/api/gestao/reports-v2.ts:164>).
- **Erro:** ausência de auditorias resulta em score 80→8,0 e sentimento 85%/10%/5%; ausência de SLA resulta em 100%. `minimalReport` repete QA 8, satisfação 85 e SLA 100. O relatório pode estar vazio e parecer saudável. Confiança de fallback é 85, sem cálculo estatístico ([src/lib/report-builder.ts:384](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/lib/report-builder.ts:384>)).
- **Fonte correta:** amostras/status de cobertura e métricas nullable. Se a IA não gerar análise, informar análise determinística, sem confiança inventada. A rota v2 atualmente NÃO faz auto-seed mock; o comentário de cabeçalho está desatualizado e o helper está desativado.

**D09 — Relatórios / “atendidas” e “primeira resposta” usam outros universos**

- **Arquivo:** [src/lib/report-builder.ts:157](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/lib/report-builder.ts:157>), [src/lib/report-builder.ts:458](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/lib/report-builder.ts:458>).
- **Erro:** “Conversas atendidas” exibe conversas criadas no período. Finalizadas conta só as criadas no período que hoje estão finalizadas, não todas as encerradas nele. “1ª resposta” é média de todos os logs de resposta, sem selecionar primeira resposta humana. Metas 15 min/92% são fixas.
- **Fonte correta:** eventos de atendimento/fechamento e primeira resposta por conversa/transferência; snapshots do período; metas/configuração do tenant. Os deltas usam consultas reais, mas ficam contaminados pela definição e pelos defaults.

**D10 — SLA / ciclos abandonados, responsável vazio e demora sem jornada**

- **Arquivos:** [src/lib/baileys/session-manager.ts:1599](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/lib/baileys/session-manager.ts:1599>), [src/lib/baileys/session-manager.ts:1620](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/lib/baileys/session-manager.ts:1620>), [src/lib/sla-engine.ts:120](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/lib/sla-engine.ts:120>), [src/routes/api/gestao/sla.ts:60](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/routes/api/gestao/sla.ts:60>).
- **Erro:** cada mensagem do cliente abre ciclo com `operatorId:null`; uma resposta fecha somente o ciclo pendente mais recente e não grava o operador no log. Mensagens anteriores podem ficar pendentes para sempre. Ranking filtra logs por operador, reduzindo cobertura. Medição é diferença bruta de timestamps/15 minutos fixos; não desconta noite, intervalo, fim de semana ou feriado, nem começa necessariamente no handoff humano.
- **Fonte correta:** episódio contínuo de espera iniciado na primeira mensagem ainda não atendida, com responsável e contexto de atribuição, fechando/cancelando os ciclos correspondentes. Explicitar SLA corrido versus útil e usar calendário/jornada configurados. Pending não vencido não deve provar SLA cumprido.

**D11 — Visão Geral / espera desenhada quase em dobro**

- **Arquivos:** [src/components/chat/MonitorView.tsx:362](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/components/chat/MonitorView.tsx:362>), [src/routes/api/gestao/alerts.ts:95](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/routes/api/gestao/alerts.ts:95>).
- **Erro:** gráfico soma `waitingMinutes + waitingSeconds/60`, mas `waitingSeconds` já é o total. Exemplo: 600 s resulta em 20 min em vez de 10.
- **Fonte correta:** usar segundos/60 uma única vez; compartilhar unidade/contrato entre gráfico, lista e badge.

**D12 — Custos / totais do período limitados a 500 registros**

- **Arquivo:** [src/routes/api/gestao/costs.ts:71](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/routes/api/gestao/costs.ts:71>).
- **Erro:** todas as somas, distribuição, timeline e contagem são calculadas após `.limit(500)`. Mais de 500 chamadas no período subcontam consumo e podem esconder features antigas. Filtros de período/feature/modelo realmente entram no WHERE, mas os totais não cobrem o período completo.
- **Fonte correta:** agregação SQL sobre todo o conjunto filtrado e paginação separada para logs. Retornar cobertura temporal e contagem real; não confundir 100 logs exibidos com total calculado.

**D13 — Custos / tokens reais, valores estimados e streaming sem registro**

- **Arquivos:** [src/lib/vertex-ai.ts:36](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/lib/vertex-ai.ts:36>), [src/lib/vertex-ai.ts:327](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/lib/vertex-ai.ts:327>), [src/lib/vertex-ai.ts:374](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/lib/vertex-ai.ts:374>), [src/routes/api/twilio-voice-webhook.ts:170](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/routes/api/twilio-voice-webhook.ts:170>).
- **Erro:** chamadas não streaming leem `usageMetadata` real, porém preço distingue só “flash”/outros com duas tarifas fixas e dólar em R$5,60. Não contabiliza componentes de custo por modelo/contexto/modalidade. Streaming extrai texto sem persistir uso/latência/custos, embora seja chamado na voz. Logs são gravados sem await e falhas não entram em fila durável.
- **Fonte correta:** tabela versionada por modelo/modalidade e data, política cambial explícita, tokens de entrada/saída e demais categorias cobradas; telemetria final do streaming e reconciliação. Tratar BRL/USD como estimativa até conciliar cobrança. RAG local não gera consumo Vertex por si só: não inventar chamadas `knowledge_rag` onde só houve busca local.

**D14 — Ligações / Voice Score é demonstração, incluindo avaliações e transcrição**

- **Arquivo:** [src/components/voice/voice-score/VoiceScoreModule.tsx:729](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/components/voice/voice-score/VoiceScoreModule.tsx:729>), [src/components/voice/voice-score/VoiceScoreModule.tsx:814](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/components/voice/voice-score/VoiceScoreModule.tsx:814>), [src/components/voice/voice-score/VoiceScoreModule.tsx:2506](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/components/voice/voice-score/VoiceScoreModule.tsx:2506>).
- **Erro:** pessoas, clientes, ligações dos meses 7–10, duração, SPICED e notas são gerados em memória a partir de arrays. Não dependem do tenant/banco. Há aviso explícito de prévia na análise da ligação; isso não transforma os indicadores de performance em métricas reais. O player toca arquivo local, mas não transcreve nem recalcula os scores.
- **Fonte correta:** gravações e transcrições de `voiceCalls`/integração existente, avaliação via Vertex, trilha de evidências por trecho e agregações por vendedor/período. Manter demonstração separada e inequivocamente identificada até a integração.

**D15 — Supervisor / “perguntas respondidas” conta perguntas recebidas**

- **Arquivo:** [src/routes/api/valentina/supervisor.ts:43](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/routes/api/valentina/supervisor.ts:43>).
- **Erro:** `questionsAnswered` conta `direction = 'to_agent'`, sem verificar resposta. Os KPIs usam últimas 24h independentemente do filtro da timeline; perguntas recentes usam outro recorte. Tipo é filtrado após limitar 200 notificações, podendo ocultar ocorrências válidas.
- **Fonte correta:** correlação pergunta↔resposta com status/latência, mesmos limites do período selecionado, filtro no SQL antes de LIMIT e paginação. Contar `repeatCount` quando a métrica prometida for ocorrências, distinguindo notificações agrupadas.

**D16 — Operadores / presença e semáforo de desempenho confundidos**

- **Arquivos:** [src/components/chat/OperatorsRankingTab.tsx:71](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/components/chat/OperatorsRankingTab.tsx:71>), [src/components/chat/OperatorsRankingTab.tsx:359](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/components/chat/OperatorsRankingTab.tsx:359>), [src/routes/api/gestao/overview.ts:260](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/routes/api/gestao/overview.ts:260>), [src/routes/api/gestao/live.ts:217](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/routes/api/gestao/live.ts:217>).
- **Erro:** semáforo baseado em TMR vira ONLINE/EM PAUSA/EM ATENDIMENTO/OFFLINE. Um operador online sem amostra pode aparecer offline; status ausente no Ao Vivo vira disponível. Não há comprovação de heartbeat no contrato de leitura dessa aba.
- **Fonte correta:** presença de sessão/heartbeat e estado operacional separados de qualidade/SLA. Exibir último contato e “desconhecido” quando faltar presença confiável.

**D17 — Métricas diárias / universos e médias incompatíveis**

- **Arquivos:** [src/lib/sla-engine.ts:341](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/lib/sla-engine.ts:341>), [src/lib/audit-service.ts:405](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/lib/audit-service.ts:405>), [src/routes/api/gestao/overview.ts:224](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/routes/api/gestao/overview.ts:224>), [src/routes/api/gestao/operator-history.ts:75](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/routes/api/gestao/operator-history.ts:75>).
- **Erro:** SLA incrementa `totalConversations` por ciclo de resposta; auditoria usa esse contador como denominador de score sem representar número de auditorias. Overview conta conversas com mensagem hoje, enquanto histórico exibe o contador de ciclos. Os números intitulados atendimentos não são comparáveis. Sem dados, histórico renderiza 0s como medição.
- **Fonte correta:** contadores independentes de conversas distintas, ciclos respondidos e auditorias concluídas, média ponderada por sua própria amostra e updates atômicos. Dias operacionais devem seguir o timezone do tenant, não UTC implícito.

**D18 — Falhas de consulta devolvidas como operação vazia/perfeita**

- **Arquivos:** [src/routes/api/gestao/performance.ts:262](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/routes/api/gestao/performance.ts:262>), [src/routes/api/gestao/sla.ts:137](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/routes/api/gestao/sla.ts:137>), [src/routes/api/gestao/contacts-analytics.ts:171](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/routes/api/gestao/contacts-analytics.ts:171>), [src/routes/api/gestao/alerts.ts:191](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/routes/api/gestao/alerts.ts:191>), [src/routes/api/gestao/operator-history.ts:99](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/routes/api/gestao/operator-history.ts:99>).
- **Erro:** catches respondem HTTP 200 com arrays vazios, zeros e até SLA/satisfação 100. Consumidores também ignoram respostas não OK ou mantêm tela anterior sem estado de erro. “Sem atendimento” não pode significar “banco falhou”.
- **Fonte correta:** disponibilidade/erro por seção, status HTTP coerente, dados de última atualização com indicação de defasagem e retorno explícito de amostra vazia.

## 3. 🟡 FUNÇÕES RASAS QUE PRECISAM SER EXPANDIDAS (Especialmente Estatísticas, Relatórios e Monitoramento)

**E01 — Estatísticas / períodos, dimensões e comparabilidade**

- **Arquivos:** [src/components/chat/AnalyticsView.tsx:623](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/components/chat/AnalyticsView.tsx:623>), [src/routes/api/gestao/performance.ts:48](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/routes/api/gestao/performance.ts:48>), [src/routes/api/gestao/sla.ts:50](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/routes/api/gestao/sla.ts:50>).
- **Limite atual:** não existe seletor geral de período conectado às abas principais: overview usa hoje; desempenho, sete dias para volume e todo histórico para canal/setor; SLA, todo histórico; clientes, quatro janelas móveis. Não é um filtro visual quebrado, é ausência de filtro comum. Predominam dias UTC.
- **Expansão:** intervalo customizado e atalhos dia/semana/mês, comparação equivalente, filtros de equipe, operador, setor/fila, conexão/provider e funil. Mesmos limites em cards/gráficos/exportações; informar timezone e amostra no contrato. Fazer GROUP BY no PostgreSQL em vez de carregar todo o histórico e dezenas de consultas por operador.

**E02 — Visão Geral e SLA / indicadores de ação gerencial**

- **Arquivos:** [src/components/chat/MonitorView.tsx:367](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/components/chat/MonitorView.tsx:367>), [src/routes/api/gestao/sla.ts:51](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/routes/api/gestao/sla.ts:51>), [src/lib/commercial/analysis-service.ts:808](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/lib/commercial/analysis-service.ts:808>).
- **Limite:** média única esconde cauda de atrasos, fila sem dono, demora do bot versus do humano e diferença de canal. Há dois sistemas de tempo (logs gerais e eventos comerciais) sem conciliação.
- **Expansão:** primeira resposta humana após transferência, resposta subsequente, P50/P90/P95, maior espera, backlog por faixa de idade e fila, abandonos reais e percentual com medição. Exibir separadamente tempo total, triagem e espera humana e reconciliar os dois motores. Não chamar todo tempo de resposta de TMA de atendimento.

**E03 — Relatórios executivos / falta cruzamento CRM ↔ Chat**

- **Arquivo:** [src/lib/report-builder.ts:17](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/lib/report-builder.ts:17>), [src/lib/report-builder.ts:157](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/lib/report-builder.ts:157>).
- **Limite:** agregador consulta conversas, SLA e auditorias, sem `crmDeals`, produtos, propostas ou vínculos de conversa-negociação. A geração diária/semanal existe e `isSdrTenant` já permite Tecfag, condicionada à configuração e inicialização do job; não se pode concluir que esteja ativa no servidor. O conteúdo é relatório de atendimento, não fechamento executivo comercial.
- **Expansão:** usar `crmConversationDeals` e associações existentes para leads triados, transferidos, primeira resposta, oportunidades abertas/ganhas/perdidas, valores, ticket, ciclo e motivos de perda; cortes por vendedor/funil/divisão/origem. Deduplicar conversa/negócio em relações N:N, preservar denominador de cada conversão e não atribuir toda receita ao último chat. Reutilizar serviços comerciais que já calculam metas, perdas e safras.

**E04 — Relatórios / geração, rastreabilidade e distribuição confiável**

- **Arquivos:** [src/lib/sla-engine.ts:150](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/lib/sla-engine.ts:150>), [src/lib/report-builder.ts:435](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/lib/report-builder.ts:435>), [src/routes/api/gestao/reports-v2.ts:62](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/routes/api/gestao/reports-v2.ts:62>), [src/lib/report-dispatcher.ts:89](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/lib/report-dispatcher.ts:89>).
- **Limite:** sem ação de geração inicial na aba; depende de configuração diária/semanal e job. Relatório diário gera após 18h mesmo antes do fechamento civil; rotulagem semanal e janela móvel não são exatamente a mesma coisa. Listagem limita 200 relatórios. Texto de e-mail/WhatsApp ainda usa marca Valem.
- **Expansão:** período fechado com começo/fim persistidos, status de geração/distribuição por destinatário, repetir falhas de forma idempotente, paginação, geração/reprocessamento do período permitido e marca/persona por tenant. Diferenciar “parcial do dia” de “fechamento”. Sem necessidade de módulo novo.

**E05 — Monitor Ao Vivo / contexto operacional**

- **Arquivos:** [src/routes/api/gestao/live.ts:190](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/routes/api/gestao/live.ts:190>), [src/components/chat/MonitorView.tsx:1845](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/components/chat/MonitorView.tsx:1845>).
- **Limite:** lista e mensagens são reais e a atualização é polling de 8s; “Ao Vivo” não é stream instantâneo. Inspeção/histórico e abertura no chat existem. Não há sentimento medido no payload, página atual, provider/conexão, risco financeiro do negócio nem separação de carga por setor. Conversas de automação têm mensagens bloqueadas e redirecionam ao SDR.
- **Expansão:** exibir presença confiável, origem/conexão, negócio ativo e valor, etapa, transferência, primeira resposta pendente e sentimento persistido com confiança. Preferir eventos já disponíveis com fallback de polling; indicar defasagem. Intervenção deve continuar usando tomada/transferência e permissões do chat.

**E06 — Alertas e Supervisor / ciclo de tratamento**

- **Arquivos:** [src/routes/api/gestao/alerts.ts:57](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/routes/api/gestao/alerts.ts:57>), [src/lib/valentina/supervisor-engine.ts:81](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/lib/valentina/supervisor-engine.ts:81>), [src/lib/valentina/supervisor-engine.ts:103](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/lib/valentina/supervisor-engine.ts:103>), [src/components/chat/MonitorView.tsx:712](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/components/chat/MonitorView.tsx:712>).
- **Limite:** Monitor/Alertas deriva de ciclos SLA; Supervisor produz notificações internas separadas. O motor atual itera Tecfag via `isSdrTenant`; a constante `SUPERVISOR_ACTIVE_TENANTS=["valem"]` está sem uso e não é bloqueio efetivo. Porém, a query só pega `meus`, `whatsappConnectionId IS NULL` e contato diferente de livechat: conexões pessoais/site/filas ficam fora. Regras 8/15 min, 24h e sobrecarga >8 são fixas. O botão Abrir Conversa funciona; não encontrei botões Resolver/Ignorar nessa aba.
- **Expansão:** ciclo reconhecido/resolvido/ignorado com ator, motivo, prazo e evidência; prioridades por fila e negócio; regras por configuração do tenant e cobertura de canais elegíveis. Unir alertas de backlog, frustração e sobrecarga sem duplicar a mesma ocorrência. Configurar ativação de Supervisor separada de SDR antes do go-live.

**E07 — Fagner SDR / monitor, rodízio, fluxos e histórico**

- **Arquivos:** [src/components/valentina/SdrTab.tsx:947](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/components/valentina/SdrTab.tsx:947>), [src/components/valentina/SdrTab.tsx:2299](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/components/valentina/SdrTab.tsx:2299>), [src/components/valentina/SdrHeaderControls.tsx:389](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/components/valentina/SdrHeaderControls.tsx:389>), [src/routes/api/valentina/triage-history.ts:23](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/routes/api/valentina/triage-history.ts:23>), [src/lib/valentina/sdr-engine.ts:939](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/lib/valentina/sdr-engine.ts:939>).
- **Situação real:** não é só mock. Há prompt industrial próprio, configuração por tenant, diagnóstico de handoff, coletados, estados de entrega, revisão humana, histórico paginado e controles reais de rodízio/fluxos. Os 341 testes de triagem cobrem regras e contratos importantes. O fallback sem tenant e o prompt sempre Valem citados como bugs antigos não descrevem o caminho industrial atual.
- **Lacunas:** filtros e lista ao vivo não substituem consulta histórica agregada; histórico de conversa pode carregar só últimas 200 mensagens no monitor. Falta cruzar prontidão/revisão/destino com resultado comercial posterior e medição de transferência; permissões/motores divergentes continuam problema.
- **Expansão:** conversão por motivo de revisão e destino, tempo em coleta/espera/handoff, falhas por causa e retry, taxa de entrega comprovada e resultado do negócio. Reusar journal/history já existentes e não substituir a trilha histórica por arrays resumidos de metadados.

**E08 — Gestão Comercial, Início e War Room / preservar o que já é real**

- **Arquivos:** [src/lib/commercial/home-service.ts:22](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/lib/commercial/home-service.ts:22>), [src/lib/commercial/bi-service.ts:38](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/lib/commercial/bi-service.ts:38>), [src/lib/commercial/analysis-service.ts:168](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/lib/commercial/analysis-service.ts:168>), [src/components/commercial/CommercialBiView.tsx:374](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/components/commercial/CommercialBiView.tsx:374>).
- **Situação real:** há consultas reais de oportunidades, metas, calendário, diretrizes, perdas, rankings, pipeline e safras; componentes recebem projeções dessas APIs. Arquivos `BASELINE_*` usados como tipos/fixtures não provam que a tela esteja usando mock. Essa área está mais completa que Monitor/Estatísticas.
- **Lacunas:** BI principal fixa mês atual; análises têm semânticas diferentes de recorte, pendências podem incluir qualquer mês. Previsão usa taxa configurada ou fallback de 10%, não probabilidade aprendida ([src/lib/commercial/bi-service.ts:307](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/lib/commercial/bi-service.ts:307>)). Cadastros de perfil/divisão/activeOnTv condicionam a inclusão. Operação WhatsApp e resultado de triagem ainda não ficam conciliados com o pipeline.
- **Expansão:** levar mês/intervalo e funil a todas as consultas/cards, mostrar exclusões/perfis faltantes e premissas de previsão, comparar taxas realizadas por coorte e permitir rastrear do agregado até negócio↔conversa↔evidência. Remover o fallback de 10% como pressuposto silencioso; não chamar previsão parametrizada de dado realizado.

**E09 — Carteira / cobertura dos clientes e resultados comerciais**

- **Arquivos:** [src/components/chat/WalletView.tsx:120](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/components/chat/WalletView.tsx:120>), [src/hooks/useChatState.tsx:1537](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/hooks/useChatState.tsx:1537>), [src/routes/api/chats.ts:289](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/routes/api/chats.ts:289>).
- **Limite:** a carteira filtra o array de conversas carregadas, não consulta todos os contatos da carteira. O carregamento inicial pede 150 chats e há paginação para chats; contato sem conversa ou fora desse recorte pode faltar e múltiplas conversas podem duplicar cliente. KPI de inatividade vem de endpoint separado e pode divergir da lista. Templates e abertura de chat têm implementação real.
- **Expansão:** lista paginada de `contacts.walletOperatorId`, um contato por item, agregados completos e última interação/negócios ativos/valor/follow-up. Navegar para conversa via resolução existente e mostrar cliente sem atendimento. Garantir mesma definição de inatividade no KPI e no detalhe.

**E10 — Tarefas e Contatos / visão de equipe e dados acionáveis**

- **Arquivos:** [src/components/chat/TasksView.tsx:209](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/components/chat/TasksView.tsx:209>), [src/routes/api/gestao/tasks.ts:35](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/routes/api/gestao/tasks.ts:35>), [src/components/chat/ContactsView.tsx:228](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/components/chat/ContactsView.tsx:228>), [src/components/chat/ContactsView.tsx:321](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/components/chat/ContactsView.tsx:321>).
- **Limite:** tarefas têm calendário, filtros e persistência reais, mas fontes e estados divergem; monitor traz tudo em memória. Contatos têm busca/paginação/contas, mas o resumo de conversas usa limite independente e não substitui histórico completo.
- **Expansão:** equipe/responsável/funil/tipo/origem, atrasos por idade e valor de negócios sem próximo passo; filtros no servidor e totalizadores completos. Para contatos, consolidar identidade, carteira, empresa e negócios, com última interação e qualidade cadastral calculadas, corrigindo antes o contrato CNPJ.

**E11 — Base de Conhecimento e Fagner interno / evidência e continuidade**

- **Arquivos:** [src/components/valentina/KnowledgeTab.tsx:69](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/components/valentina/KnowledgeTab.tsx:69>), [src/lib/valentina/knowledge-service.ts:640](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/lib/valentina/knowledge-service.ts:640>), [src/components/valentina/ValentinaChatTab.tsx:121](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/components/valentina/ValentinaChatTab.tsx:121>).
- **Limite:** há leitura/upload/gestão real da KB e recuperação de contexto; nome de arquivo `valentina-mock-data` não prova KB simulada. Busca local por conteúdo/ranking não equivale a embeddings Vertex nem deve gerar custo fictício de RAG. Threads organizadas do chat são guardadas em localStorage por tenant/operador, limitando continuidade entre dispositivos; mensagens têm APIs próprias.
- **Expansão:** evidenciar fonte/versão e trechos recuperados, arquivos não indexados/erros de extração e cobertura por família industrial. Sincronizar organização de threads com o histórico persistido se esse comportamento for esperado, mantendo tenant e operador. Corrigir primeiro os contextos de schema de R21.

**E12 — Settings, design system e voz / fechar contratos existentes**

- **Arquivos:** [src/components/chat/SettingsView.tsx:119](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/components/chat/SettingsView.tsx:119>), [src/components/valentina/SupervisorTab.tsx:242](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/components/valentina/SupervisorTab.tsx:242>), [src/components/chat/AnalyticsView.tsx:746](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/components/chat/AnalyticsView.tsx:746>), [src/components/voice/LigacoesView.tsx:58](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/components/voice/LigacoesView.tsx:58>), [src/lib/voice/elevenlabs-tts.ts:3](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/lib/voice/elevenlabs-tts.ts:3>), [src/lib/voice/elevenlabs-dynamic-tts.ts:82](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/lib/voice/elevenlabs-dynamic-tts.ts:82>).
- **Limite:** Settings tem persistência/testes de canal e relatórios; não é tela vazia. Mas salvar configuração não prova que o job/distribuidor funcionou. Há date pickers, title e select nativos em telas auditadas, contrariando o design system. Voz compara gênero com `"M"`, embora persona retorne `male/female`. Síntese ElevenLabs é integração direta e possui fallback de credencial no código, incompatível com a regra de IA única Vertex; não foi usada nem validada a credencial encontrada.
- **Expansão:** status verificável de última geração/envio/conexão por tenant nas configurações, componentes personalizados obrigatórios e concordância via persona. Adequar síntese/transcrição à central Vertex, retirar credencial embutida e revogá-la se ainda válida; telemetria completa de voz, sem expor segredos na interface ou no relatório.

## 4. 📊 TABELA DE PONTUAÇÃO DE COMPLETUDE POR MÓDULO (0 a 10)

Critério: fluxo fim a fim, dados verdadeiros, consistência dos cálculos, funcionamento no caminho Tecfag e capacidade gerencial. Não foi dada nota 10 apenas por haver tela ou teste passando. Média geral simples entre as sete áreas; produção não homologada.

| Módulo / Área do Sistema | Nota | Status Atual | Principais Lacunas Encontradas |
| :--- | :---: | :---: | :--- |
| **1. Estatísticas (`AnalyticsView`)** | **3,0** | Parcial | SQL de setores inválido; SLA sem cobertura Meta/site; clientes/canais com definições erradas; ausência de períodos comuns; custos truncados. |
| **2. Relatórios Executivos (`ReportsIATab` / Exportações)** | **2,5** | Parcial | IDs colidem entre tenants; envio WhatsApp Tecfag simulado; PDF/agendamento mortos; KPIs artificiais; sem CRM; re-síntese muda janela. |
| **3. Monitoramento ao Vivo (`MonitorView`: Live, Alertas, Ranking, QA, Site)** | **3,0** | Parcial | Ranking majoritariamente fictício; QA bloqueado; Visitantes inoperante; recorte de mensagens/data errado; tarefas CRM ausentes. |
| **4. Gestão Comercial & War Room BI (`CommercialManagement` / `Bi` / `Home`)** | **7,0** | Parcial | Base CRM real e profunda, mas handoff automático não alimenta TMA; cache sem sessão; períodos e conciliação Chat↔CRM incompletos. |
| **5. Fagner IA (`SDR`, `Rodízio`, `Fluxos`, `Supervisor`, `Vendedor`, `KB`)** | **6,0** | Parcial | SDR industrial/histórico/revisão reais; Vendedor é placeholder; contexto com schema defasado; política de ativação divergente; métricas do Supervisor inexatas. |
| **6. Operação Core (`Chat`, `CRM Negociações`, `Tarefas`, `Contatos`, `Carteira`)** | **6,5** | Parcial | Chat/CRM e regras de acesso implementados; respostas rápidas quebradas; CNPJ da conta inválido; carteira por recorte de chats; conclusão falsa de tarefas. |
| **7. Ligações & Voz (`LigacoesView`)** | **2,0** | Parcial | Voice Score demonstrativo; webhook fixa Valem; histórico não fecha com disparo; telemetria streaming ausente e integração IA fora da regra Vertex. |
| **NOTA GERAL DE COMPLETUDE DO SISTEMA** | **4,3 / 10** | **Parcial** | A operação e o CRM têm base substancial; a camada gerencial ainda não é confiável como fonte única para a diretoria da Tecfag. |

Subáreas totalmente inoperantes não significam que o módulo inteiro seja inoperante: Visitantes, Vendedor e exportação/agendamento não entregam a ação; voz possui player, agenda e endpoints reais, mas não o ciclo analítico anunciado. Não foi possível verificar o estado efetivo das integrações no servidor.

## 5. 🛠️ ROADMAP DE FINALIZAÇÃO (ORDEM DE EXECUÇÃO)

### Pacote 1 — Desbloqueio e Correção do que está Inoperante/Zerado

1. **Preservar isolamento e verdade da informação.** Resolver IDs globais de relatórios, filtros de tenant em sentimento, cache por sessão e transporte de tenant na voz. Configuração independente de SDR/Supervisor/QA por tenant. Decisão de go-live é operacional; não ativar QA nem alterar Valem automaticamente.
2. **Retirar sucesso fictício da superfície.** Remover arrays/gauges/fallbacks de ranking e overview, percentuais perfeitos sem amostra e relatórios com QA/sentimento fabricados. Mostrar desativado, sem amostra, indisponível e dados defasados como estados distintos.
3. **Restaurar os fluxos operacionais.** Corrigir SQL por setor, props de respostas rápidas desktop/mobile, contrato CNPJ, contextos do Fagner com schema atual, toggle de tarefas com HTTP/rollback e reunião de tarefas do CRM no monitor. Fechar os 108 erros TypeScript, priorizando falhas com impacto demonstrado; isso não equivale a 108 bugs independentes.
4. **Instrumentar o caminho real da Tecfag.** SLA/sentimento em Meta, Baileys e site; evento TMA dentro da atribuição industrial e do rodízio; primeira resposta somente após aceite externo; cancelamento/fechamento e reconstrução controlada em ambiente de teste. Não criar dados reais para preencher dashboards.
5. **Corrigir distribuição e calendário dos relatórios.** Eliminar mock Meta e seleção de canal por nome de tenant; comprovar envio; preservar período na re-síntese; impedir marcar enviado editorialmente. Remover marca/persona Valem da saída Tecfag.

**Aceite do pacote:** em ambiente isolado, dois tenants geram relatório do mesmo período sem colisão; cliente envia duas mensagens e uma resposta humana não deixa espera fantasma; handoff industrial→resposta aceita alimenta TMA; canal Meta gera logs/alertas reais; API negada não mantém sucesso visual; ausência de QA nunca produz nota ou satisfação; testes de acesso/triagem continuam aprovados; checagem TypeScript passa. Validar Valem com regressão separada antes de qualquer rollout compartilhado.

### Pacote 2 — Profundidade em Monitoramento, Estatísticas e Relatórios

1. **Unificar semântica de períodos e indicadores.** Timezone, jornada/calendário, metas do tenant e definições de conversa/cliente/ciclo/transferência/fechamento. Implementar filtros de data, operador, equipe, setor, fila, conexão e funil nas APIs e UI.
2. **Recompor Estatísticas com agregados verdadeiros.** Novos/recorrentes por identidade e primeira interação; canal/provider/conexão por evento; primeira resposta humana, P50/P90/P95, pendências e cobertura. Agregação SQL completa e paginação de detalhe, inclusive custos.
3. **Enriquecer Monitor e Supervisor.** Corrigir última mensagem/data; presença separada de qualidade; sentimento persistido; estado de tratamento de alertas com evidência; contexto do negócio e fila sem dono. Reutilizar eventos de acesso/SSE e projeções já presentes.
4. **Conectar Visitantes ao backend/widget existente.** Página atual, origem, histórico, duração derivada de eventos/heartbeat e ações permitidas. Testar visitante anônimo, troca de página, desconexão, retomada e atendimento humano por tenant.
5. **Transformar o relatório de chat em relatório executivo.** Cruzar triagem, revisão humana, transferência, SLA e oportunidades/receita/perdas/metas por vendedor e funil; deduplicar N:N; manter snapshot/versão e fonte de cada indicador. Entregar exportação PDF/print/planilha coerente com o período e agendamento real.
6. **Auditar custos.** Totais SQL sem teto de 500, tarifas/versionamento e câmbio explícitos, telemetria streaming e reconciliação. Mostrar cobertura e consumo por feature realmente executada; não esperar custo de features desativadas.

**Aceite do pacote:** os mesmos filtros e população produzem os mesmos totais em tela, API e exportação; drill-down explica cada total; mais de 500 chamadas não muda a cobertura dos custos; a diretoria consegue rastrear oportunidade↔conversa↔triagem/resposta e distinguir ausência de dado de problema operacional.

### Pacote 3 — Refinamento dos Módulos Secundários

1. **Carteira/Contatos/Tarefas.** Carteira completa por contato paginado, sem duplicidade e sem depender do cache de chats; KPI de inatividade consistente; fontes de tarefas unificadas, permissões de equipe e próximo passo comercial.
2. **Início/Gestão/War Room.** Mesmo recorte temporal e funil em todos os slides, indicação de perfis excluídos, premissas de previsão visíveis e rastreabilidade dos apontamentos. Aproveitar serviços comerciais reais em vez de reconstruí-los.
3. **Fagner Vendedor e KB.** Finalizar o comportamento já anunciado de propostas/follow-up usando os módulos existentes, em entregas testáveis; evidência da KB e organização persistida do chat quando aplicável. Não liberar uma lista de roadmap como recurso entregue.
4. **Voz.** Primeiro corrigir identidade/isolamento e persistência; depois gravação→transcrição Vertex→avaliação evidenciada→ranking real. Manter demonstração identificada até sua substituição. Adequar provedores à regra IA do projeto e eliminar credenciais embutidas.
5. **Design system e diagnósticos.** Substituir `title`, `<select>` e datas nativas pelos componentes obrigatórios; estados de erro/vazio completos; saúde de jobs e últimas entregas nas configurações existentes.

**Aceite do pacote:** nenhuma ação exposta sem implementação, nenhum demo apresentado como resultado operacional, nenhum segredo no código/saída, carteira e tarefas explicadas por dados completos, voz com chamada e evidência vinculadas ao tenant correto. Homologar em banco/credenciais de teste; rollout por feature preservando Valem.

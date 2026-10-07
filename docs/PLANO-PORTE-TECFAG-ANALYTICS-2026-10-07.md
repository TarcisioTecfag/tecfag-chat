# Porte funcional do Tecfag Analytics para o Tecfag Chat

**Estado:** levantamento estático e plano de execução, 07/10/2026.  
**Origem (somente leitura):** `C:/Users/TEC FAG/Documents/antigravity/fearless-pythagoras` (`package.json`: `tecfag-analytics`).  
**Destino:** este repositório, tenant `tecfag`.  
**Referências Git do levantamento:** origem `894a0d2`, destino `9a77157` (commits curtos; atualizar ao executar cada entrega).  
**Decisão do usuário:** portar as funções; não importar o histórico antigo nesta etapa.
**Decisões de apresentação:** manter o rótulo **Faturado** e as duas divisões comerciais **Personnalité** e **Máquinas**. O indicador Faturado continuará calculado a partir do valor dos negócios ganhos enquanto não houver fonte financeira própria; a interface deve explicar essa fórmula ao passar o mouse/abrir o detalhe.
**Decisão de TMA comercial:** transferência para consultor → primeira resposta do consultor. Esse relógio é distinto do SLA de atendimento cliente→agente já presente no Chat.
**Decisão de evidências:** usar registros internos de ligação/e-mail quando existirem e permitir relato manual autenticado. A origem e o tipo de prova devem aparecer no dossiê.

## Objetivo e fronteira

O Tecfag Chat será a fonte de verdade para negociações, operadores, contatos, atividades, conversas e eventos comerciais. O Analytics serve como especificação funcional e visual. O resultado deverá oferecer a mesma rotina do consultor e da gestão, inclusive o Commercial War Room, sem depender do RD CRM nem do RD Conversas para dados novos.

Este levantamento foi feito por leitura do código. Não houve conexão aos bancos, uso de credenciais, execução de rotas, alteração do Analytics ou importação de dados. Valores numéricos exibidos no legado devem ser revalidados em dados de teste antes de afirmar equivalência.

## Inventário da origem

### Superfícies e funções

| Área | Funções encontradas | Código principal |
|---|---|---|
| Portal individual do consultor | Saudação e cockpit, meta do mês, ritmo diário, agenda, diretrizes priorizadas/atrasadas/concluídas, conclusão com evidência, escolha da próxima ação (ganhar, perder ou seguir), notificações, perfil e atalhos para CRM/conversa | `app/components/ConsultorPortalPage.tsx`; `app/api/consultor-portal/**` |
| Status do sistema | Saúde da operação, status de sincronização, consultores, calendário, auditoria recente e atalhos | `app/components/hub-pages.tsx` (`DashboardPage`) |
| Consultores e equipes | Cadastro, equipes, foto, presença na TV, vínculo ao usuário do RD e link individual | `app/components/hub-pages.tsx` (`ConsultoresPage`); `app/api/consultores` |
| Metas | Meta mensal por consultor/equipe, realizado, conversão prevista, cobertura e comparação | `app/components/hub-pages.tsx` (`MetasPage`); `app/api/goals` |
| Calendário comercial | Fechamentos por dia, ritmo necessário, dias úteis, feriados/pontes/expediente extra, impacto na meta e detalhe dos negócios | `app/components/hub-pages.tsx` (`CalendarioPage`); `app/api/calendario` |
| Diretrizes comerciais | Gestor seleciona negócios no BI, atribui responsabilidade diária e acompanha execução; exportação PDF | `app/components/pages.tsx`; `app/api/deals/guidelines`; `app/lib/export-guidelines-pdf.ts` |
| Evidências | Dossiê por negociação e consultor, ligação (relato), WhatsApp (mensagens), e-mail (conteúdo), estados de vinculação/importação e inspeção pela gestão | `app/components/evidencias-page.tsx`; `app/api/manager/evidence-sessions/**`; `app/api/consultor-portal/complete-action` |
| BI para TV | Seis módulos rotativos, painéis laterais, alertas, seleção/pausa da rotação, tela cheia, atualização periódica e versão móvel de cinco abas | `app/components/pages.tsx` (`BITVPage`); `app/components/BITVMobile.tsx`; `app/api/tv` |
| SLA e TMA | Início na transferência, confirmação do vendedor, faixas de tempo, alertas pendentes e ranking | `app/lib/tmaService.ts`; `app/api/tma/**` |
| Régua de maturidade | Cinco faixas configuráveis por idade/valor; responsabilidades atuais e previstas; drill-down de coortes | `app/components/config-pages.tsx` (`ReguaDeParaPage`); `app/components/MaturityCohortFullscreenModal.tsx`; `app/api/deals/maturity`, `cohorts` |
| Controle da TV | Módulos ativos, tempo de rotação, painel fixo e aviso ao vivo | `app/components/config-pages.tsx` (`ControleTvPage`); `app/api/settings` |
| Integrações e usuários | OAuth/sync/logs de RD, conta de gestor e auditoria de ajustes | `app/components/config-pages.tsx` (`IntegracoesPage`); `app/components/usuarios-page.tsx`; `app/api/audit`, `users` |

Os **seis módulos da TV desktop**, na ordem configurável do legado, são: (0) oportunidades e pipeline por fase, (1) responsabilidades por faixa de maturidade, (2) responsabilidades previstas, (3) metas e ritmo, (4) perdas e motivos, (5) ranking de resposta e SLA. A versão móvel apresenta maturidade, pipeline, metas, TMA/SLA e perdas como abas. Há filtros por equipe e detalhamento de negócios/coortes.

### Persistência e integrações da origem

`app/lib/db.ts` cria: `tma_events`, `crm_deals_cache`, `crm_losses_cache`, `commercial_goals`, `crm_users_map`, `system_settings`, `business_calendar`, `audit_log`, `oauth_tokens`, `sync_log`, `system_users`, `webhook_events_log`, `consultant_daily_actions`, `evidence_sessions`, `rd_conversas_import_queue`, `rd_conversas_messages`, `evidence_session_messages` e `rd_conversas_sync_logs`.

O fluxo atual é: RD CRM (OAuth, webhooks e sincronizações periódicas) → caches de negócios/perdas → agregações do BI; RD Conversas/Tallos → fila noturna → mensagens vinculadas a evidências; transferência/ACK externo → eventos de TMA. Essas integrações deixam de ser necessárias para a **operação futura**. Histórico antigo continua no Analytics até uma decisão separada sobre importação ou arquivamento.

O repositório da origem contém **50 arquivos de rota de API** e quatro serviços principais. A triagem por destino é:

| Classe | Rotas/serviços de origem | Tratamento no porte |
|---|---|---|
| Núcleo funcional | `consultor-portal/**`, `manager/evidence-sessions/**`, `deals/guidelines`, `deals/by-phase`, `deals/maturity`, `deals/cohorts`, `goals`, `calendario`, `consultores`, `settings`, `tv`, `tma/**`, `audit`, `users` | Reimplementar contra CRM/chat/sessão do Chat; reutilizar contratos de comportamento e elementos visuais, sem copiar autorização/SQL. |
| Dependência RD | `webhooks/rd-crm`, `rd-crm-oauth/**`, `sync/crm/**`, `cron/sync-deals`, `cron/sync-losses`, `webhooks/logs`; `rdCrmSync.service.ts`, `rdConversas.service.ts`, `rdConversasWorker.service.ts`, `nightlySync.service.ts` | Não portar para o fluxo futuro. Substituir a alimentação por eventos e tabelas locais. |
| Administração e diagnóstico legados | `admin/**`, `diag/**` (importações, seeds, resets, testes e inspeções de RD) | Não expor no novo produto. Criar observabilidade administrativa própria somente onde houver necessidade operacional. |
| Autenticação antiga | `auth/login` e portal público por token | Substituir integralmente por sessão e RBAC já existentes no Chat. |

As rotas são agrupadas pelo propósito; a implementação nova deve ser desenhada por domínio e não copiada arquivo a arquivo.

### Regras identificadas que precisam de equivalência

- Metas: mês comercial em `America/Sao_Paulo`; alvo por vendedor; realizado baseado em negócios ganhos; dias úteis ajustados pelo calendário; percentual esperado até hoje e valor necessário por dia restante.
- Maturidade: cinco faixas configuráveis de dias e valor (padrões do legado: 7/15/30/60/90 dias e limites 15/35/60/100 mil). Mostrar idade, valor, negócio vencido/pronto e previsão. A definição exata de “pronto a faturar” precisa de teste de contrato, porque o legado combina idade, valor e status do RD.
- SLA/TMA: instante da transferência ao consultor (`t0`) até a confirmação (`t1`); limite e buckets configuráveis (padrões 5/15/30 min e SLA de 15 min); pendências acima do limite, média e ranking diário.
- Diretriz: uma responsabilidade por negócio/dia no legado; conclusão exige canal de evidência; WhatsApp, ligação e e-mail têm campos diferentes; em seguida há escolha obrigatória de ganho, perda com motivo/observação, ou continuidade com tarefa futura/observação.
- Perdas: agrupamento de motivos em categorias, filtros por mês/equipe, contagem e valor. A política de motivos do CRM próprio deve prevalecer.
- BI: filtros globais e por equipe, atualização periódica, aviso, módulo ligado/desligado, rotação com pausa e tela cheia. Agregados devem ter a mesma fonte e os mesmos filtros no desktop e no móvel.

**Contrato dos cálculos extraído de `app/api/tv/route.ts`:** o funil conta e soma negócios `ongoing` por vendedor/equipe/etapa; a coluna Requalificação aparece, mas fica fora do total ativo. A maturidade considera somente negócios abertos, de valor positivo e fora de Requalificação: a faixa é escolhida pelo **valor**, e o negócio fica maduro quando sua idade alcança os dias da faixa. A previsão usa `dias_restantes = dias_da_faixa - idade`; `<= 0` é “Hoje/pronto ou atrasado”. Valor de fechamento prometido é valor da coorte multiplicado pela taxa de conversão configurada. Perdas têm mês atual, anterior e acumulado histórico. O ritmo de metas é `dias_úteis_decorridos / dias_úteis_do_mês`, descontando os dias do calendário que afetam a meta. O SLA do legado mede transferência→ACK, não simplesmente cliente→resposta.

**Correções de qualidade ao portar, sem alterar o comportamento desejado:** o legado associa vendedores por nomes aproximados, mapeia etapas por trechos do texto e usa valores de fallback quando uma consulta falha. O Chat deve usar IDs de operador, IDs/configuração explícita das etapas e retornar estado de erro/atualização parcial. A média geral de TMA deve ser calculada sobre eventos, evitando média não ponderada das médias individuais. Histórico de ganhos usa `closedAt` real, sem substituir pela data de sincronização.

## Encaixe proposto no Tecfag Chat

| Função do Analytics | Destino de produto | Fonte no destino / trabalho necessário |
|---|---|---|
| Portal do consultor | **Início** como primeira tela do operador Tecfag, desktop e móvel | Sessão do operador, `crmDeals`, `crmDealActivities`, calendário e metas novas. Sem link público com token; o operador só vê seus próprios registros. |
| Pipeline e negócio | **Negociações** existente | `crmDeals`, `crmPipelines`, `crmStages`, `crmDealEvents`; aproveitar tela, filtros, detalhe e permissões atuais. |
| Diretrizes diárias | **Gestão Comercial > Diretrizes** para atribuição e acompanhamento; cards na **Início** do consultor | Nova entidade por tenant ligada a `crmDeals` e `operators`; conclusão transacional e trilha de eventos. Não misturar com a tabela genérica `tasks`. |
| Próxima ação | No fluxo de conclusão da diretriz e na aba **Atividades** do negócio | `crmDealActivities` para tarefa; alteração de status via serviço CRM existente; motivo de perda pelo catálogo do tenant. |
| Evidências | **Gestão Comercial > Evidências** e detalhe da negociação | `crmActivityMessages` e `crmConversationDeals` para mensagens; chamada, e-mail ou relato com snapshot próprio; navegação para chat/deal local. |
| Metas e consultores | **Gestão Comercial > Metas** e **Equipe** | Nova meta por `tenantId`, mês e `operatorId`; cadastro/autorização de consultor reutiliza `operators` e grupos, sem tabela paralela de usuário. Personnalité/Máquinas são divisões comerciais preservadas. |
| Calendário | **Gestão Comercial > Calendário** para fechamento e dias úteis; tarefas continuam na agenda/CRM | `crmDeals.closedAt`, atividades com vencimento e nova configuração de dias comerciais. Não duplicar o calendário de tarefas existente. |
| Visualização executiva | **BI Comercial** como módulo próprio na navegação, com abas/visões e botão **Abrir TV** | Serviço de métricas do CRM próprio; mesma camada de dados para BI, TV e portal. Estatísticas atuais de chat ficam na área existente. |
| War Room/TV | Tela cheia do **BI Comercial**, versão desktop e móvel | Portar composição, hierarquia, densidade, módulos rotativos e drill-down; trocar somente tokens de cor/forma necessários à linguagem do Chat. |
| Parâmetros de SLA e maturidade | **Ajustes > CRM Comercial**, abas **SLA** e **Régua de Maturidade** | Configuração por tenant, validação de valores, histórico de alteração. |
| Controle da TV | **BI Comercial > Configurar TV** (gestores) | Configuração por tenant: módulos, ordem, intervalo, painel fixo e aviso. |
| Usuários e permissões | **Grupo de Acesso** existente | Novas permissões de leitura/gestão de Início, Gestão Comercial, BI e TV, verificadas também no servidor. |
| Saúde e auditoria | **Gestão Comercial > Operação** | Eventos internos e estado da projeção/atualização; sem tela OAuth do RD como requisito do novo módulo. |

O Chat já possui `operators`, sessão no servidor, grupos, `crmDeals`, atividades, tarefas, eventos, conversas/mensagens e indicadores de atendimento (`responseTimeLogs`, `operatorDailyMetrics`). Ainda **não** possui metas comerciais, calendário de dias úteis, diretrizes comerciais, configuração do War Room nem o dossiê completo do Analytics. A tela de Estatísticas atual mede a operação de atendimento; o BI Comercial terá métricas de venda próprias e poderá aproveitar componentes visuais sem misturar conceitos.

## Modelo de dados e contratos a criar

1. `commercialGoals`: `tenantId`, `month` (`YYYY-MM`), `operatorId`, `targetValue`, `conversionTarget`, autor e timestamps; chave única por tenant/mês/operador. O realizado é **derivado** de negócios ganhos, não campo editável.
2. `commercialCalendarDays`: `tenantId`, `date`, `type`, `scope`, `affectsGoal`, descrição, autor; unicidade por tenant/data. Fuso São Paulo na definição do dia comercial.
3. `commercialDirectives`: `tenantId`, `dealId`, `assignedToOperatorId`, `assignedByOperatorId`, `assignedDate`, `dueAt`, prioridade, instrução, status, conclusão e timestamps. Definir explicitamente se pode haver mais de uma por negócio/dia; padrão de paridade: uma.
4. `commercialEvidence`: `tenantId`, `directiveId`, `dealId`, `operatorId`, canal, estado, origem (`internal_record` ou `manual_report`), resumo/conteúdo, metadados, timestamps; vínculo N:N com `messages` para prova WhatsApp e referência a chamada/e-mail interno quando houver. Permitir relato manual autenticado e identificá-lo claramente, sem apresentar relato como registro automático. Preservar o snapshot mesmo que uma tarefa seja reprogramada.
5. `commercialSettings`: `tenantId`, faixas de maturidade, buckets/SLA, configuração da TV, aviso; validação de ordem crescente e parâmetros positivos.
6. `commercialTransferResponseEvents`: `tenantId`, `conversationId`, `operatorId`, `transferredAt`, `firstResponseMessageId`, `firstRespondedAt`, `durationSeconds`, estado e timestamps. Capturar a transferência no servidor e fechar apenas na primeira mensagem **desse consultor após a transferência**, de forma idempotente. Transferência posterior inicia outro ciclo; mensagens internas, bot e respostas de outro operador não encerram o ciclo.
7. Para histórico de BI confiável, usar `crmDealEvents` ou nova projeção diária **tenant-scoped**. Confirmar cobertura de eventos de valor, dono, etapa e fechamento antes de calcular coortes históricas; fotografia atual de `crmDeals` não reconstrói passado sozinha.

Contratos de leitura propostos: `GET /api/commercial/home`, `GET /api/commercial/goals`, `GET /api/commercial/calendar`, `GET /api/commercial/directives`, `GET /api/commercial/evidence`, `GET /api/commercial/bi`, `GET /api/commercial/tv`. Escritas separadas por domínio, com validação de permissão e transações para conclusão. Endpoints podem evoluir na implementação, mas todos os consumidores devem usar o mesmo serviço de métricas e filtros.

## Regras arquiteturais obrigatórias

- Toda rota interna usa `requireSession`, `session.tenantId`, RBAC no servidor e `eq(tabela.tenantId, tenantId)` em **todas** as leituras e mutações; atualização/exclusão conferem ID e tenant. A implantação funcional fica habilitada apenas para o tenant Tecfag por permissão/feature flag derivada da sessão. Valem permanece operacional.
- O Analytics legado contém padrões que **não serão copiados**: autenticação mantida no `localStorage`, links de consultor por token, rotas de configuração sem sessão, identificação por nome, credenciais/segredos com fallback no código e algumas métricas de cache que podem esconder falhas. O novo módulo usa sessão, IDs estáveis, validação e erros visíveis.
- UI e serviços não recebem tenant do cliente como autoridade. Equipe/consultor são filtros **dentro** do tenant autenticado.
- O BI é cálculo determinístico. Caso surja recurso novo de IA, usar somente `vertexAi`, persona via `getAiPersona(tenantId)`, feature e contexto de custo corretos. Não ativar SDR/Supervisor/Auditorias para Tecfag por consequência do porte.
- Não executar sync, seed, reset, migração de dados de produção nem copiar o banco do Analytics. Testes com banco isolado e duas sessões de tenants.

## Plano de execução em entregas verificáveis

| Entrega | Escopo | Critério de aceite |
|---|---|---|
| 0. Contratos e base | Fechar glossário de KPI, definir equipes e autoria; migrações aditivas, permissão/flag, serviço de métricas e fixtures sintéticas | Mesmos casos de cálculo documentados; isolamento Tecfag/Valem; nenhuma mudança funcional em Valem |
| 1. Início do consultor | Cockpit, meta/ritmo, agenda, prioridades e navegação ao negócio/chat | Um operador enxerga apenas suas negociações e diretrizes; desktop/móvel; carregamento e estados vazios |
| 2. Gestão comercial | Equipe, metas, calendário de dias úteis, criação/atribuição de diretrizes, execução e evidências | Fluxo gestor → consultor → evidência → próxima ação completo, idempotente e auditável |
| 3. BI Comercial | Pipeline/fases, maturidade e previsão, metas/pacing, perdas, SLA/ranking e drill-down | Contagens, somas e filtros reconciliam com consultas do CRM; mês e dias em São Paulo |
| 4. War Room e ajustes | TV rotativa e móvel, pausa/seleção/fullscreen, avisos, SLA, régua e parâmetros da TV | Fidelidade visual revisada lado a lado com a origem; configuração persistida por tenant; TV estável sem RD |
| 5. Validação e ativação | Testes de cálculo/isolamento, comparação funcional, desempenho, ativação gradual no Tecfag | Fluxos reais em ambiente de teste; nenhuma query cruzada; Valem sem regressão; Analytics pode continuar apenas como referência |

Cada entrega tem migração aditiva, feature flag/permissão, verificação com dados de teste e rollback por desativação da interface. A TV pode usar agregação sob demanda inicialmente; quando o volume justificar, criar projeções/materializações com atualização observável e indicação de última atualização. Não apresentar zero como sucesso quando a fonte falhar.

## Decisões pendentes antes da implementação correspondente

1. **Fórmula do Faturado:** rótulo confirmado pelo usuário. Mostrar em detalhe que, nesta fase, o valor é a soma dos negócios ganhos; uma integração financeira poderá mudar a origem com revisão explícita da fórmula.
2. **Equipes:** Personnalité e Máquinas confirmadas. Falta mapear cada consultor aos grupos/setores/carteiras atuais do Chat, com ID próprio estável e sem IDs do RD.
3. **TMA comercial:** definido como transferência→primeira resposta. Falta definir o comportamento quando a transferência é para fila/setor sem consultor escolhido: iniciar o relógio ao atribuir/capturar um consultor específico. O `responseTimeLogs` atual mede cliente→resposta e permanece separado.
4. **Evidência de e-mail/ligação:** usar registro interno quando disponível e permitir relato manual autenticado, conforme decisão do usuário. Confirmar, em cada fluxo, quais campos e anexos internos podem ser vinculados por ID local. Mensagens WhatsApp já podem ser vinculadas por IDs locais.
5. **Histórico:** fora do escopo atual. Se requisitado depois, inventariar volume/qualidade, mapear IDs antigos→novos e importar por pipeline separado, idempotente e restrito ao tenant Tecfag.

## Matriz de verificação de paridade

- [ ] Cadastro/visibilidade de consultor e equipe; imagem de perfil.
- [ ] Meta mensal, conversão prevista, realizado, dias úteis e ritmo necessário.
- [ ] Calendário: feriado, ponte, dia extra, impacto nas metas, ganhos por data.
- [ ] Diretriz: seleção pelo gestor, prioridade, atraso, conclusão, reprogramação e trilha.
- [ ] Evidência: ligação, WhatsApp, e-mail, vínculo ao negócio e inspeção pela gestão.
- [ ] Próxima ação: ganho, perda com motivo/observação, tarefa futura.
- [ ] BI: funil por fase/equipe/consultor, maturidade, previsão, perdas, SLA, detalhamento.
- [ ] TV: seis módulos desktop, cinco abas móveis, rotação, pausa, fullscreen, aviso e configuração.
- [ ] RBAC e isolamento de cada endpoint; operador não vê dados alheios sem permissão.
- [ ] Visual: estrutura, tipografia, densidade, gráficos, estados vazios e responsividade comparados lado a lado; cores pelo tema do Chat.

## Estado da implementação no Tecfag Chat (07/10/2026)

O primeiro corte funcional já está no código **deste repositório**. O repositório Tecfag Analytics permaneceu somente como fonte de análise.

| Área | Implementado agora | Ainda necessário para paridade |
|---|---|---|
| Base | Migração aditiva `0027`, tabelas segregadas por tenant, permissões de tela, fórmulas de ritmo e maturidade | Aplicar migração primeiro em banco de teste e verificar duas sessões de tenants; depois planejar janela de produção |
| Início | Cockpit pessoal desktop/móvel, meta, Faturado como negócios ganhos, ritmo, agenda CRM, diretrizes e acesso ao negócio | Notificações, concluídas no histórico pessoal, atalhos de conversa e refinamento visual lado a lado |
| Gestão | Cadastro de divisão Personnalité/Máquinas, metas, calendário comercial, atribuição de diretrizes, dossiê básico de evidências e parâmetros do War Room | Reprogramar/cancelar diretrizes, exportação PDF e auditoria administrativa detalhada |
| Evidências | Conclusão transacional com vínculo validado por tenant a ligação, e-mail ou mensagens internas; relato manual autenticado para ligação/e-mail identificado como tal; escolha obrigatória do próximo passo, validando ganho/perda com motivo ou tarefa futura já registrada no CRM | Anexos e transcrição detalhada; criação/alteração do próximo passo dentro do mesmo fluxo de tela, sem exigir ida prévia ao CRM |
| BI/TV | Seis módulos: pipeline, maturidade atual, previsão, metas, perdas, TMA/SLA; equipe, rotação, pausa, tela cheia e atualização; configuração de régua, etapas excluídas e tempo | Drill-down completo por consultor/coorte, avisos ao vivo, exportação, comparação visual final, teste de volume e política de snapshot/histórico |
| TMA | Evento criado quando atendimento é atribuído a operador cadastrado como consultor; primeira mensagem externa aceita encerra o tempo | Cobrir todas as vias de envio de mídia/canais, reconciliação após falha e validação operacional da definição de transferência |

**Critérios de ativação ainda não cumpridos:** não houve execução da migração nem teste funcional com banco isolado; a criação do próximo passo na própria tela e a paridade visual/operacional ainda faltam. O BI usa o estado atual do CRM e `closedAt` dos negócios; coortes históricas de fase/valor/dono exigem projeção de eventos completa antes de serem apresentadas como série histórica. A tela de BI fica restrita ao administrador nesta versão inicial. Nenhum dado legado foi importado.

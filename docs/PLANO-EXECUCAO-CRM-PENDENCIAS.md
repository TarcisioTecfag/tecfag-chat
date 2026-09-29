# Plano de execução — pendências Conversas + CRM

**Data da auditoria:** 28/09/2026. **Finalidade:** orientar a implementação do que ainda falta após as mudanças já feitas. **Plano de produto de referência:** [PLANO-CONVERSAS-CRM.md](PLANO-CONVERSAS-CRM.md).

Este documento é uma fotografia do código na data acima, não uma declaração de que as migrações foram aplicadas em produção ou de que os dados do RD já foram reconciliados. Antes de cada entrega, a IA desenvolvedora deve conferir o estado mais recente do repositório.

### Estado de partida

- **Existe:** entidades locais de cliente, contato, negociação, atividade e vínculos N:N; menu Negociações; Kanban e lista básicos; ficha; produtos/propostas; painel de negócios no chat.
- **Falha hoje:** contratos divergentes entre UI e API para cliente/responsável; alguns campos da ficha não correspondem à resposta; quadro calcula totais usando só 50 negócios carregados; tarefas não têm ciclo completo.
- **Falta para as capturas:** filtros de responsável e ordenação, totais corretos por etapa, card com próxima ação, lista com seleção e data de criação, ficha comercial mais completa e navegação confiável entre card e várias conversas.
- **Falta para o modelo de negócio:** ficha de cliente PF/PJ, associação de vários contatos, gestão de funis/etapas por tenant e validação completa de permissões e vínculos no servidor.

## 1. Roteiro de execução

Este documento transforma as pendências identificadas na auditoria em entregas pequenas. Use o plano de produto original como referência para as decisões arquiteturais e as oito capturas do RD; este arquivo define somente o trabalho daqui em diante. **Não repetir cegamente as fases 0–4:** conferir o código atual antes de cada mudança, reaproveitar o que funciona e demonstrar o que falta. A aparência deve seguir os oito prints como referência de função e densidade; dados, rótulos e estrutura do funil são próprios de cada tenant. Não fixar no código os sete nomes de etapa vistos nas imagens.

### 1.1 Regras de execução e relatório

1. Trabalhar na ordem E0 → E1 → E2 → E3 → E4 → E5 → E6 → E7 → E8. Uma entrega só termina com seus critérios verificados. E8 pode exigir configuração de integrações externas e deve registrar dependências concretas.
2. Antes de editar, registrar o estado do Git, as alterações de terceiros em andamento, a migração aplicada no ambiente alvo e os contratos reais das rotas. Não sobrescrever mudanças locais; não reescrever histórico publicado da branch ligada ao Lovable.
3. Usar `requireSession` e `session.tenantId` em toda rota interna, escopo por tenant em cada consulta/mutação, autorização no servidor por ação e validação de todas as entidades relacionadas. ID simples em FK não substitui validação de tenant. Nunca aceitar `tenantId` do cliente como autoridade.
4. Não executar `db:seed`, `db:push`, `db:reset-data`, importador RD ou testes de integração contra banco operacional. `db:push` encadeia `cleanup`; revisar qualquer comando antes de rodá-lo. Valem deve continuar operando. Dados Tecfag só com finalidade operacional aprovada, sem seed de demonstração.
5. Testes que importam `src/db/index.ts` devem fixar `DATABASE_URL` **antes do import** e provar que preparação, handlers e servidor usam a mesma instância de banco exclusiva de teste. Falhar antes de qualquer escrita quando não houver isolamento comprovado. Limpar somente IDs gerados no teste e falhar se a limpeza não concluir. Nome de banco contendo `test` não é prova suficiente.
6. Em cada entrega, reportar: arquivos alterados; migrações e como desfazê-las; evidência de verificação; diferenças conhecidas dos prints; riscos para Valem; itens que permaneceram pendentes. Não declarar “concluído” baseado somente em compilação ou em presença de componente.
7. Executar verificações estáticas e testes isolados pertinentes à mudança. Para interface, registrar capturas do nosso sistema com cenários de dados. Não usar o banco de produção para fabricar uma captura.

### 1.2 Contratos de domínio que todas as entregas preservam

| Entidade | Regra de identidade e vínculo |
|---|---|
| Cliente PF/PJ (`crm_accounts`) | ID próprio, tipo `person`/`company`, documento normalizado opcional; um cliente pode ter vários contatos e negociações. Não criar outro cliente quando uma correspondência confirmada já existe no mesmo tenant. |
| Contato (`contacts`) | Pessoa que se comunica; zero ou um cliente principal atual, com histórico da mudança. Pode participar de várias negociações por `crm_deal_contacts`. |
| Conversa (`conversations`) | Atendimento e mensagens, com vida própria; pode ter zero, uma ou cinco ou mais negociações em `crm_conversation_deals`. Não selecionar negócio pelo telefone. |
| Negociação (`crm_deals`) | ID próprio, até um cliente comprador principal, múltiplos contatos e múltiplas conversas; vendedor independente do atendente. Etapa pertence ao funil; status comercial é campo separado. |
| Tarefa/nota comercial | Pertence a um negócio explícito e pode registrar conversa de origem. Nota interna geral permanece na conversa. Com vários cards, a escolha do destino é obrigatória. |

**Decisão de transição:** não inferir ganho/perda apenas do nome da coluna. Se uma etapa estiver configurada com `isWinStage`/`isLossStage`, a interface deve solicitar a confirmação da ação comercial e salvar etapa + status numa transação com evento auditável; alternativamente o administrador pode configurar um funil sem etapas terminais. Nunca deixar uma negociação aberta numa etapa terminal sem sinalizar a inconsistência.

### E0 — Segurança, ambiente e contratos antes de expandir o CRM

**Objetivo:** tornar confiável a base existente, sem alterar dados comerciais reais.

- Levantar em `src/routes/api/crm/` cada operação GET/POST/PATCH/DELETE e definir permissões separadas para visualizar, ver todos, criar, editar, movimentar, encerrar, administrar funis e produtos/propostas. `views.crm` controla a navegação, mas o servidor decide o acesso. Testar chamada direta à API por operador sem permissão.
- Em `src/lib/crm/crm-service.ts`, validar tenant e existência de `accountId`, `contactId`, `pipelineId`, `stageId`, `conversationId` e `operatorId` fornecidos; validar que etapa pertence ao funil. Aplicar a mesma validação ao atualizar, vincular conversa, registrar atividade, produto e proposta. Rejeitar vínculo cruzado com erro 400/403, antes de inserir qualquer linha.
- Tornar criação de negócio + participante + vínculo de conversa + evento uma unidade transacional. Falha intermediária não pode deixar card incompleto. Criar/desfazer vínculo mantém histórico e não apaga mensagens.
- Revisar o `GET /api/crm/pipelines`: hoje ele escreve um funil com etapas fixas quando não encontra configuração. Decidir explicitamente se inicialização é uma ação administrativa; não usar GET para criar dados operacionais, sobretudo no tenant em implantação.
- Corrigir erros HTTP de validação/conflito para que a UI distinga falha de permissão, dado inválido, indisponibilidade e versão concorrente. Verificar isolamento das suítes anteriores antes de executá-las.

**Aceite E0:** requests sem permissão ou com IDs de outro tenant não leem nem alteram dados; etapa de outro funil é rejeitada; criação parcial é revertida; GET do funil não produz seed; testes isolados não tocam Valem ou Tecfag operacionais.

### E1 — Corrigir a criação e o DTO único de negócio/cliente

**Objetivo:** o que o usuário escolhe e vê deve ser exatamente o que o servidor grava e devolve.

- Alinhar `CreateDealDialog.tsx` com `/api/crm/accounts` (`type`, `document`) e `/api/crm/deals` (`operatorId` ou campo contratual decidido). Hoje a UI envia `cnpj`/`isCompany`, `ownerId` e `initialNote`, mas as rotas não consomem esses campos. Salvar a nota inicial como atividade na mesma transação, ou retirar o campo até existir essa operação.
- Criar um tipo/DTO compartilhado para negócio resumido e detalhado, incluindo `operatorId`, `account.type`, `account.document`, contatos, contagem de conversas, datas e próxima tarefa. Adaptar `DealCard.tsx`, `DealList.tsx`, `DealDetailModal.tsx` e `PipelineColumn.tsx`; eliminar leituras de `ownerId`, `account.isCompany`, `account.cnpj`/`cpf` quando a API não entrega esses nomes.
- Escolher vendedor realmente persistível com validação de permissão e tenant; vendedor da negociação não muda o atendente da conversa. Editar vendedor também na ficha.
- Representar “valor não informado” separadamente de `R$ 0,00` no banco e na interface. A coluna `value` atual tem default zero e não aceita nulo: planejar migração aditiva/retrocompatível ou indicador explícito. Não reinterpretar todos os zeros legados como ausência. Rejeitar entrada inválida; salvar zero sem chamar `.toString()` em `null`.
- Definir CPF versus CNPJ por tipo selecionado e dígitos validados no servidor; mascarar documento na UI conforme permissão. Falha na criação/seleção do cliente deve parar o fluxo com erro visível, sem prosseguir silenciosamente com card sem conta.
- Se o formulário cadastrar conta e negócio na mesma confirmação, executar ambos no servidor numa operação transacional/idempotente ou compensar falha de modo verificável. Não depender de dois POSTs independentes para prometer ausência de conta órfã.

**Aceite E1:** criar PF com CPF e PJ com CNPJ, escolher vendedor diferente do operador, incluir nota inicial e registrar valor ausente/zero/positivo gera exatamente os dados mostrados em card, lista e ficha. Reabrir a ficha mantém esses valores; erros não geram contas órfãs nem duplicam negócios.

### E2 — Cliente, vários contatos e participantes da negociação

**Objetivo:** tornar utilizável o modelo cliente → contatos 1:N, mantendo cliente, contato e card independentes.

- Completar `/api/crm/accounts` com leitura individual, atualização, arquivamento e busca paginada, todos autorizados por tenant. Criar `AccountPicker` reutilizável com busca por nome/documento, opção de cadastrar PF/PJ e aviso de possível duplicata. A criação de negócio deve escolher conta existente antes de oferecer cadastro novo.
- Criar tela/ficha `AccountDetail` acessível do CRM e do chat: dados PF/PJ, contatos vinculados, negócios e atendimentos relacionados, histórico de alterações. Documento pode ficar em branco na triagem.
- Oferecer na ficha do contato escolher/trocar cliente principal, registrar `crm_contact_account_history`, mostrar o cliente atual e as conversas. Não reescrever automaticamente o cliente dos negócios históricos ao trocar o contato de empresa.
- Criar operações e interface para adicionar/remover participantes de `crm_deal_contacts`, marcar contato principal e atribuir papel. Criar card sem contato é permitido; cliente e contato não são automaticamente a mesma entidade. Se contato e cliente escolhido divergirem, pedir revisão explícita sem apagar vínculos existentes.
- Dar uso ao vínculo opcional `crm_account_conversations` para contexto histórico quando necessário, sempre com ação explícita, autoria e consulta limitada ao tenant. Não associar cliente por simples coincidência de número.

**Aceite E2:** um cliente reúne pelo menos três contatos e vários cards; um contato pode existir sem cliente; trocar o cliente principal de um contato preserva histórico e negócios anteriores; criar segundo card para cliente existente reutiliza a mesma conta; CPF/CNPJ conflitante gera revisão, não associação automática.

### E3 — Tarefas comerciais completas e próxima ação

**Objetivo:** transformar atividades criadas em trabalho acompanhável, como na faixa inferior do card do RD.

- Completar `/api/crm/deals/$dealId/activities` com leitura paginada e atualização de tarefa (concluir, editar data/título/descrição/responsável, cancelar ou reabrir conforme regra), com autoria e eventos. Não oferecer essas transições para nota imutável sem regra explícita.
- Buscar a próxima tarefa pendente por card na listagem sem N+1, ordenada por prazo; informar vencida/hoje/futura, tipo e responsável. Tarefa sem prazo deve ter tratamento definido. O cabeçalho de cada etapa e os filtros podem usar esses dados.
- Mostrar próximas tarefas acima das abas da ficha; na aba Tarefas separar pendentes, concluídas e notas. Implementar botão “Criar tarefa” e faixa de próxima ação no `DealCard`, com texto além da cor. Atualizar card e ficha após cada mudança.
- No chat, manter nota interna geral vinculada somente à conversa; para tarefa/nota comercial exigir `dealId` explícito. Com um card, pré-seleção visível; com vários, seleção obrigatória. Tarefa RD sem conversa de origem comprovada fica sem `conversationId`.

**Aceite E3:** criar, concluir e reagendar tarefa reflete no card, na ficha e no dado de próxima tarefa usado pela futura ordenação E5; tarefa vencida não desaparece; duas negociações na mesma conversa recebem tarefas diferentes conforme escolha, sem associação por telefone.

### E4 — Kanban correto com volume e ações de etapa

**Objetivo:** quadro utilizável com centenas/milhares de negócios, sem contadores enganosos.

- Criar contrato de API de agregação por etapa para todos os negócios que satisfazem os filtros: `count(distinct deal.id)` e soma monetária por moeda, sem multiplicar pelo N:N de contatos/conversas. Não calcular totais só com os 50 cards carregados. Paginar independentemente por etapa, com carregamento adicional ou virtualização.
- Deixar a paginação da **lista** separada da paginação do **quadro**. Ao trocar de visão, conservar funil, filtros, ordenação e card aberto; não reutilizar o offset global da lista para ocultar cards no quadro.
- Arraste, menu no card e seletor acessível por teclado/celular devem chamar a mesma transição validada. Em etapa terminal, aplicar a decisão da seção 1.2 com confirmação. Exibir erro e restaurar posição em conflito; auditoria guarda etapa anterior/nova e operador.
- Completar o card compacto: estado “Em andamento” visível, cliente PF/PJ, classificação, vendedor correto, valor ou “Adicionar valor”, alerta de esfriamento configurado, contador de conversas clicável e faixa da tarefa. Menu rápido: editar, criar tarefa, mover, vincular conversa, ganho, perda e pausa conforme permissão.
- Gestão de funis/etapas por tenant: criar, renomear, reordenar, configurar alertas/campos exigidos e desativar com política para cards existentes. Não usar nomes ou IDs de etapas do RD como constantes do produto.

**Aceite E4:** cenário com mais de 50 negócios distribuídos por sete etapas mostra contagem e valor completos, embora só parte dos cards esteja renderizada. Mover um card atualiza dois totais; teclado/celular e arraste chegam ao mesmo estado. Negócio aberto em etapa terminal exige ação explícita ou aviso de inconsistência.

### E5 — Barra de filtros e lista das capturas 2–5 e 7

**Objetivo:** permitir encontrar e comparar negócios em volume.

- `CrmToolbar`: seletor de funis com busca/rolagem quando necessário; filtro de vendedor com Todas/Minhas, busca, seleção múltipla, Limpar/Aplicar; status Todos, Em andamento, Vendido, Perdido, Pausado, Não pausado; ordenação por nome A–Z/Z–A, criação recente/antiga, próxima tarefa, previsão de fechamento, contato recente/antigo e qualificação.
- Implementar filtros avançados com indicador numérico de ativos: etapa, cliente, faixa de valor, data de criação, origem, produto, tarefa vencida e tempo parado. Mostrar somente filtros cujos dados sejam confiáveis. Filtros, busca e ordenação são feitos no servidor antes da paginação; usar paginação estável e índices adequados.
- Busca abrangente por título, conta, contato, telefone, documento e identificador, respeitando tenant e visibilidade; eliminar duplicatas de join. Debounce no campo de texto e limpar offset quando o filtro mudar.
- `DealList`: incluir seleção de linhas, responsável, qualificação, etapa, valor, criação e status como na captura; deixar cliente, conversas e próxima tarefa como complementos. Tamanho da página, total real e páginas navegáveis. Ações em massa somente se houver autorização e confirmação quando forem irreversíveis.
- Interface responsiva: filtros utilizáveis em largura pequena e alternativa de movimentação de etapa sem arraste. Estados de carregamento, erro com “Tentar novamente” e vazio com filtros ativos.

**Aceite E5:** cada controle altera a consulta do servidor e permanece ao alternar Quadro/Lista; filtro por dois vendedores, “Não pausado” e ordenação por próxima tarefa produzem resultados previsíveis; total e paginação continuam corretos com mais de 50 negócios.

### E6 — Ficha da negociação e navegação conversa ↔ card

**Objetivo:** reunir os dados comerciais úteis da captura 8 e fazer a relação bidirecional funcionar.

- Ampliar `DealDetailModal` ou transformá-lo em página/painel amplo sem perder o contexto do quadro. Topo: título, cliente, funil, status, vendedor, valor e ganho/perda/pausa. Trilha usa **o funil real do negócio**; ao abrir pelo chat, não passar sempre o funil padrão.
- Lateral editável: origem, campanha, previsão, qualificação, valor, cliente, contatos participantes e campos personalizados por tenant quando configurados. Mostrar criação e alteração com datas. Não inferir documento do contato como documento da conta.
- Corrigir o DTO da aba Conversas: devolver nome/telefone do contato, canal real, estado, responsável, período e última mensagem por consulta autorizada. A ficha permite vincular conversa existente, desvincular e abrir a conversa exata. Ao iniciar/retomar atendimento, escolher contato e canal; só vincular após confirmar a criação do atendimento.
- No chat, separar visualmente Contato, Cliente e Negociações relacionadas. Exibir os múltiplos cards sem selecionar primeiro por telefone; criar/vincular/desvincular com aviso quando a conta do card difere da conta principal do contato. Descontinuar `RdCrmCard` legado apenas quando seu fluxo tiver substituto validado.
- Histórico: combinar eventos, notas, tarefas, propostas e evidências com data/autoria/ação identificáveis, sem copiar todas as mensagens da conversa para todos os cards. Se o operador não tiver direito de ver determinada conversa, mostrar vínculo sem conteúdo sensível ou ocultá-lo conforme regra aprovada.

**Aceite E6:** uma conversa mostra cinco cards e cada card abre a ficha correta; um card com três conversas de períodos/canais diferentes permite abrir cada atendimento pelo ID exato; a ficha apresenta contato/canal/responsável reais e não “Cliente sem nome” por campo inexistente; troca de cliente ou contato não altera histórico silenciosamente.

### E7 — Migração RD e qualidade dos dados

**Objetivo:** preencher o CRM local com dados reconciliados, sem duplicar nem desorganizar a operação.

- Inventariar por tenant funis, etapas, negócios, contas/empresas, contatos, responsáveis, tarefas e campos personalizados no RD, com totais e amostras. Confirmar endpoint/campo pelo contrato oficial da versão usada e registrar as diferenças; não inferir sucesso da importação pela presença do importador no código.
- Mapear IDs RD → IDs locais de forma durável e idempotente. Vincular negócio ao contato conhecido, mas não atribuir todas as conversas históricas desse contato ao negócio. Tarefa importada sem conversa de origem comprovada fica com `conversationId` vazio.
- Relatório de reconciliação: quantidades por funil/etapa/status; valores; responsáveis sem correspondência; CPFs/CNPJs inválidos/duplicados; negócios sem conta; tarefas órfãs; erros por item. Permitir retomar importação sem duplicar linhas e sem substituir edição local silenciosamente.
- Definir por tenant fonte de verdade (`rd_primary` ou `local_primary`) e política de sincronização. Troca para `local_primary` somente depois de reconciliação, teste de recuperação e decisão operacional explícita. Preservar integração RD legada durante a transição.

**Aceite E7:** duas execuções do mesmo lote não duplicam cliente, contato, negócio ou tarefa; totais e amostras conferem com a origem; itens ambíguos permanecem em revisão; nenhum script escreve no banco operacional sem plano de execução e validação correspondente.

### E8 — Paridade funcional ampliada das capturas

**Objetivo:** completar os elementos visíveis que dependem de fluxos próprios, após o núcleo CRM estar confiável.

- **Produtos e propostas:** aprimorar as telas já existentes; conferir valores, permissões, histórico, estado real de envio/aceite e relação com o negócio. Copiar texto para a área de transferência não deve ser tratado como envio confirmado. Gerar arquivo apenas se houver requisito e armazenamento definido.
- **Arquivos:** anexar/listar/baixar documentos do negócio com tenant, autorização, metadados, limite de tamanho e vínculo de origem quando vierem de uma conversa. Não mostrar aba vazia como funcionalidade entregue.
- **E-mail:** integrar uma caixa/canal autorizado ou registrar e-mails com origem verificável, destinatário, data e associação explícita ao negócio. Configuração de provedor e política de envio são dependências; não simular envio.
- **Questionários:** definir formulário e respostas versionados por tenant, associados a negócio/contato, com histórico. Exibir aba apenas quando houver formulário utilizável.
- **Priorização e IA das negociações:** definir critério comercial mensurável e explicável antes da interface. Qualquer IA deve usar exclusivamente `vertexAi` com `feature`/`tenantId` exigidos pelo `AGENTS.md`; se uma nova `feature` for necessária, adicioná-la explicitamente ao mapa de custos. Sugestões não criam nem vinculam cards automaticamente sem regra e auditoria.
- **Calendário e ações do cabeçalho:** usar tarefas com prazo como fonte, respeitar timezone e permissões, e abrir o card/tarefa exatos. Implementar apenas ações que tenham comportamento completo.

**Aceite E8:** cada aba e comando visível executa um fluxo verificável com dados reais, permissões e histórico; elementos dependentes de serviço ainda não configurado permanecem claramente indisponíveis e constam do relatório de pendências.

### 1.3 Matriz mínima de verificação antes de declarar concluído

| Cenário | Evidência exigida |
|---|---|
| Isolamento | Dois tenants de teste; tentativa cruzada com IDs conhecidos em conta, contato, conversa, funil, etapa, negócio e atividade retorna erro e não grava. |
| Cliente/contato | Um PF com CPF opcional; um PJ com CNPJ; PJ com três contatos; troca de cliente de um contato preserva histórico. |
| Relação N:N | Uma conversa ligada a cinco ou mais cards; um card ligado a três conversas; desvincular um par preserva os outros. |
| Atividade contextual | Uma nota geral só na conversa; tarefa para card A não aparece no card B; ausência de seleção com múltiplos cards bloqueia o salvamento. |
| Quadro e lista | Mais de 50 cards em sete etapas; contagem/soma servidor conferem; filtros e páginas não escondem ou duplicam cards; valores sem preenchimento não viram zero presumido. |
| Ficha | Responsável, PF/PJ, documento, contatos, próximo prazo, etapa e conversa exata corretos; abrir pelo chat usa o funil do próprio card. |
| Operação | Valem segue recebendo/enviando mensagens; nenhum teste, seed ou importação cria dados comerciais reais em Tecfag por acidente. |

### 1.4 Formato de entrega para a IA desenvolvedora

Ao finalizar **cada** E0–E8, entregar uma tabela curta com: requisito, estado (feito/parcial/bloqueado), arquivos e linhas principais, evidência de teste isolado/captura, migração necessária e risco remanescente. Informar o próximo bloco, mas não chamar a fase seguinte de concluída antes dos critérios acima. Se uma decisão comercial não estiver disponível, registrar a hipótese, implementar o que independe dela e deixar a dependência explícita; não inventar funil, campo obrigatório ou política de sincronização RD.

**Mapa inicial de arquivos para a execução:** `src/db/schema.ts` e `src/db/migrations/` (modelo e migrações); `src/lib/crm/crm-service.ts` (regras); `src/routes/api/crm/` e `src/routes/api/chats/` (contratos HTTP); `src/components/crm/CrmView.tsx`, `CrmToolbar.tsx`, `PipelineBoard.tsx`, `PipelineColumn.tsx`, `DealCard.tsx`, `DealList.tsx`, `DealDetailModal.tsx`, `CreateDealDialog.tsx` e `ConversationDealsPanel.tsx` (interface); `src/components/chat/SharedFiles.tsx` (ponte com atendimento); `src/lib/rbac.ts` e `src/hooks/usePermissions.ts` (permissões). Conferir nomes e chamadas no repositório antes de editar, pois o código pode avançar entre entregas.

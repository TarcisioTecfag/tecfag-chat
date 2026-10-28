# Análise funcional para go-live da Tecfag

Data: 23/10/2026, horário de Brasília. Código analisado: `main`, commit `97fe7b3`.
Dimensionamento solicitado: aproximadamente 30 usuários cadastrados, até 10 simultâneos.

## Parecer

**Não liberar a virada completa no estado verificado. A arquitetura é plausível para esse porte, mas existem falhas funcionais confirmadas e a implantação ainda precisa de homologação operacional.**

Um piloto de atendimento humano é um caminho razoável depois de corrigir os bloqueios do ambiente e das funções essenciais. Colocar Fagner em atendimento automático exige também validar inicialização dos serviços, destinos, distribuição e recuperação de triagens. Não há necessidade demonstrada de reescrever o sistema para suportar dez operadores.

O foco desta análise foi funcionamento, continuidade e colaboração entre operadores. Questões de segurança sem efeito direto nesses fluxos não determinaram o parecer.

## Escopo e limites da evidência

- Leitura do código de chat, WhatsApp, sessões, CRM, contatos, distribuição, assistente e serviços de recuperação.
- Geração do pacote de produção e inspeção dos serviços efetivamente registrados nele.
- Execução de suítes selecionadas e reproduções isoladas de falhas.
- Consultas ao banco indicado pelo `.env` com PostgreSQL em **modo somente leitura**, sem importar o servidor da aplicação nessas consultas.
- O banco encontrado é **local**, `valemchat`, em loopback. Seus resultados não comprovam configuração, versão ou estado do Railway.
- Nenhuma migração, seed, alteração cadastral, envio WhatsApp, chamada de IA ou mudança no provedor foi executada. O código funcional da aplicação não foi alterado.
- Não foi realizado teste visual completo em navegador, atendimento com um número real nem ensaio HTTP com dez sessões. A tentativa de medir o serviço real de listagem CRM foi interrompida por incompatibilidade do schema local.

## Verificações executadas

| Verificação | Resultado | Alcance |
|---|---|---|
| Build de produção: `node node_modules/vite/bin/vite.js build` | Aprovado | Geração do bundle; não verifica todos os tipos nem certifica inicialização de recursos |
| TypeScript: `tsc --noEmit` | Reprovado: **66 diagnósticos** | Inclui inconsistências com impacto funcional, além de problemas de tipagem |
| `npm run test:access` | **187 aprovados** | Contratos de rotas, autorização e fluxos, com cenários isolados |
| `npm run test:triage` | **339 aprovados** | Políticas, triagem, catálogo, encaminhamento, monitor e integrações simuladas |
| Resiliência, fila otimista e cache/índices | **18 aprovados** | Três arquivos selecionados, sem serviços externos |
| Identidade Meta, variáveis/grupos de templates e telefones | **21 aprovados** | Quatro arquivos selecionados, sem envio externo |
| Reprodução da configuração de destinos | **Falha confirmada** | `ReferenceError: matchedSector is not defined` |
| Reprodução do clique em resposta rápida | **Falha confirmada** | `TypeError: onSelectResponse is not a function` |
| Leitura pelo serviço real de listagem CRM | **Falha confirmada no banco local** | PostgreSQL `42703`: coluna `crm_deal_activities.rd_marketing_cycle` inexistente |

Total: **565 testes aprovados nas suítes selecionadas**. Isso não significa que todos os testes do repositório foram executados, nem substitui teste integrado em produção. Alguns testes usam mocks ou verificam contratos estáticos; a ausência dos serviços no pacote produzido é um exemplo de problema que essas aprovações não detectaram.

Logs e scripts desta análise estão em `.codex-audit/`, na raiz do projeto. Os scripts de banco limitam a conexão a leitura; o ensaio CRM exige conexão local. Eles são evidências auxiliares da análise, não um novo procedimento de implantação.

## Situação do ambiente local encontrado

| Item Tecfag | Resultado observado |
|---|---|
| Operadores | 35: 34 agentes e 1 administrador |
| Contatos | 20.695 |
| Negociações | 27.829 |
| Funis / etapas / setores | 8 / 59 / 4 |
| Conversas | Nenhuma |
| Provedor selecionado | Meta |
| Estado cadastrado do canal | `connected` |
| Phone Number ID / App Secret | Ausentes |
| Token | Campo preenchido; validade não testada |
| Último webhook Meta registrado | Ausente |
| Configurações de agentes | Apenas rodízio encontrado; sem registros SDR ou configuração industrial |
| Política RD CRM | `rd_primary`, sincronização `manual` |

O rótulo `connected` não demonstra comunicação WhatsApp. Com esse cadastro local, o atendimento Meta não está operacionalmente comprovado. A existência de muitos contatos e negócios também não demonstra um ciclo completo de atendimento: não há conversas nessa base para verificá-lo.

O schema local diverge do modelo em oito tabelas: `access_groups`, `attendance_event_cycles`, `attendance_events`, `conversation_deal_contexts`, `conversations`, `crm_deal_activities`, `rd_marketing_commercial_outbox` e `rd_marketing_sync_settings`. Três dessas tabelas estão ausentes por completo. Não aplicar correções diretamente na operação compartilhada: validar as migrações previstas em ambiente separado e conferir a base de implantação.

**A consulta de schema usada pelo healthcheck atual retornou `ready=true` nessa mesma base incompatível.** Portanto, a verificação atual de saúde pode aprovar infraestrutura enquanto funcionalidades do CRM falham. Isso foi reproduzido executando a consulta do probe, sem subir o servidor contra o banco operacional.

## Achados com prioridade operacional

### 1. Ambiente e schema precisam estar coerentes com a versão — bloqueia a liberação no ambiente verificado

A listagem real pelo `crmService.getDeals` falhou antes de completar a primeira leitura. As ausências de schema também abrangem contexto da negociação e eventos do atendimento. A geração do bundle funciona independentemente disso.

**Efeito diário:** quadro que não abre, operações do atendimento que retornam erro e falsa impressão de saúde pelo endpoint de infraestrutura.

**Fechamento necessário:** homologar migrações e configuração na base de destino, abrir CRM/contatos/tarefas/chat pela aplicação e confirmar os fluxos depois de um reinício normal. Não foi comprovado que a produção tem a mesma divergência do banco local.

Evidência: `src/lib/crm/crm-service.ts:2725`, `src/lib/readiness.ts:11`, migrações `0044`, `0045` e `0046`, logs `schema-readonly.log` e `crm-readonly-benchmark.log`.

### 2. Serviços de follow-up e recuperação industrial não entram no pacote — bloqueia Fagner automático confiável

O `vite.config.ts` registra apenas `websocket`, `orphan-cleanup` e `recovery`. No `index.mjs` gerado, a lista efetiva contém somente esses três serviços. Os plugins `sdr-followup.ts` e `industrial-triage-recovery.ts` não estão registrados.

Há um segundo problema no plugin de follow-up: ele importa `startSdrFollowupEngine`, que não é exportado pelo engine atual, e depende do hook `listen`. O próprio plugin de recuperação existente documenta que esse hook não é emitido pelo runtime Node dessa versão do Nitro.

**Efeito diário:** não há inicialização comprovada do follow-up por silêncio nem do ciclo periódico de recuperação de encaminhamentos e confirmação pós-transferência. Na Meta, a recuperação associada à reconexão Baileys não substitui esses ciclos. A recuperação durável do transporte WhatsApp está registrada, mas não cobre sozinha todas essas etapas da triagem.

**Fechamento necessário:** corrigir o registro e a inicialização; validar o bundle e o processo real com testes de silêncio, reinício e encaminhamento pendente.

Evidência: `vite.config.ts:31`, `server/plugins/sdr-followup.ts:6`, `server/plugins/industrial-triage-recovery.ts:19`, `.output/server/index.mjs:4456`, `src/lib/valentina/sdr-recovery.ts:241`.

### 3. Respostas rápidas estão desconectadas dos chamadores — corrigir antes de colocar a equipe

O componente exige `onSelectResponse`, `slashFilterText`, `onCreateGlobal` e outros callbacks. O chat principal e o compositor mobile passam nomes antigos, incluindo `onSelect`, `slashQuery` e `onCreateQuickResponse`.

**Efeito diário:** clicar numa resposta pronta lança erro, a busca por atalho não recebe seu filtro e as ações de gerenciamento inline recebem callbacks ausentes. A reprodução usou o componente real transpilado, com hooks simulados e um item sintético, sem navegador ou banco. O link para configuração também usa `configuracoes`, enquanto o estado aceita `settings`.

**Fechamento necessário:** alinhar o contrato nos dois chamadores e validar seleção, filtro, criação, edição e exclusão na interface. Templates oficiais da Meta são um fluxo distinto e não devem ser confundidos com essas respostas rápidas.

Evidência: `src/components/chat/QuickResponsesPopover.tsx:19`, `src/components/chat/QuickResponsesPopover.tsx:515`, `src/components/chat/ChatPanel.tsx:3631`, `src/components/mobile/MobileMessageInput.tsx:241`.

### 4. Sugestão automática de destinos da Tecfag falha — bloqueia preparação automática da triagem

`autoMatchIndustrialDestinations` calcula `matchedSectorId`, mas ao montar um destino comercial acessa `matchedSector.id`, variável inexistente. A função é chamada na primeira carga sem destinos e nas ações de sugestão de vínculos.

**Efeito diário:** a configuração inicial pode falhar ou não produzir os destinos esperados. A reprodução com setor, funil e etapa sintéticos gerou o `ReferenceError`.

Além disso, o algoritmo usa primeiro setor/funil/etapa como fallback quando não encontra correspondência. Mesmo corrigindo a exceção, os vínculos sugeridos exigem revisão pelos responsáveis para não direcionar suporte/financeiro para um funil comercial incorreto.

**Fechamento necessário:** corrigir a variável, apresentar erros de carga e validar cada destino por ID com setores, membros da escala e etapas oficiais.

Evidência: `src/lib/triage/tecfag-default-catalog.ts:255`, `src/components/valentina/IndustrialTriageSettings.tsx:476`.

### 5. Sincronização entre operadores tem lacunas — relevante para dez simultâneos

No caminho de envio humano Meta, `dispatchStored` emite `message_status`, mas não publica o conteúdo da nova mensagem como evento `message`. A fila e a rota de envio também não o fazem. O navegador remetente insere seu próprio balão localmente. O consumidor de `message_status` só atualiza mensagens que já existem e não busca um balão desconhecido.

**Risco sustentado pela leitura do código:** supervisor ou segunda aba acompanhando o chat principal pode não enxergar a resposta enviada enquanto permanece com a conversa aberta. O mini-chat CRM tem polling de quatro segundos e reduz esse problema naquele componente. O chat principal busca histórico ao abrir e reconectar, sem esse polling contínuo.

No quadro CRM também não foi encontrado mecanismo de atualização entre navegadores: há recarga ao abrir, alterar filtros e concluir ações locais. O controle de versão ao mover cards protege contra algumas alterações concorrentes, mas não atualiza espontaneamente os quadros dos colegas.

**Fechamento necessário:** publicar o conteúdo persistido e invalidar/reconciliar os consumidores; testar dois navegadores e dez sessões. Este achado precisa de confirmação visual integrada, diferentemente das duas exceções reproduzidas acima.

Evidência: `src/lib/whatsapp/dispatch.ts:83`, `src/routes/api/whatsapp/send.ts:315`, `src/hooks/useChatState.tsx:3810`, `src/components/chat/ChatPanel.tsx:1222`, `src/components/crm/CrmChatWidget.tsx:1371`, `src/components/crm/CrmView.tsx:538`.

### 6. Escala e presença precisam de procedimento explícito — risco de lead sem resposta

O rodízio industrial usa participação, folga, penalização, funil e associação ao setor. Não exige sessão ativa nem presença online. Na seleção geral de operadores do encaminhamento, nem o status de pausa é carregado. O campo `isOnline` não tem atualização de presença por heartbeat encontrada no fluxo de login/logout/perfil; não deve ser tratado como prova de disponibilidade.

**Efeito diário:** fechar o navegador, sair para almoço ou alterar o status pessoal não garante retirada do rodízio. Um lead pode ser distribuído para quem não está atendendo. Isso pode ser uma política intencional de carteira/escala, mas precisa ficar claro para a equipe.

**Fechamento necessário:** definir a política e o procedimento de entrada, pausa, saída e cobertura. Se a regra for atender apenas quem está online, implementar e homologar essa condição. Se a regra for escala manual, exigir atualização da participação/folga e acompanhar fila sem resposta.

Evidência: `src/lib/triage/industrial-policy.ts:475`, `src/lib/triage/industrial-handoff-store.ts:528`, `src/routes/api/operators/profile.ts:64`.

### 7. Assistente pode trabalhar com contexto incompleto — prioridade posterior ao transporte humano

A consulta de contexto usa `agentFlowStates.extractedData`, `currentStage` e `updatedAt`, campos inexistentes no modelo. O bloco captura o erro e permite fallback com mensagens fornecidas pelo frontend; isso pode reduzir o histórico e o enriquecimento CRM disponíveis para melhor resposta/resumo.

**Fechamento necessário:** usar os campos existentes, validar contra banco isolado e garantir que o assistente degrade de forma visível sem interromper atendimento humano.

Evidência: `src/lib/valentina/assistant-engine.ts:225` e diagnósticos de tipos.

## Avaliação por área

| Área | Avaliação |
|---|---|
| Atendimento humano | Base implementada: captura, transferência, encerramento, histórico, mídia e notas. Falta homologar o ciclo inteiro no ambiente de destino e corrigir respostas rápidas/sincronização. |
| WhatsApp Meta | Implementação de recebimento, envio, identidade, janela de atendimento e templates existe. Configuração local incompleta e nenhuma entrega real validada nesta análise. |
| Concorrência no atendimento | Bom fundamento: versões e verificações transacionais para captura e transferência. Ainda requer dois operadores disputando a mesma conversa em ambiente integrado. |
| CRM | Funcionalidades e otimizações relevantes já existem. O schema local impede validar a listagem atual; colaboração entre navegadores precisa ser melhorada. |
| Contatos | Paginação e busca no servidor adequadas como desenho. Volume local já é significativo; qualidade da importação e cadastros precisa de conferência operacional. |
| Tarefas e agenda | Código e cobertura parcial por testes existem; não foi validado o ciclo diário completo de criar, vencer, concluir e associar ao atendimento. |
| Fagner automático | Núcleo extenso e políticas testadas, mas inicialização/recuperação e preparação de destinos impedem aprovação integral. Pode ficar fora do piloto humano. |
| Relatórios e gestão | Devem ser conciliados com dados reais de atendimento antes de orientar cobrança de produtividade. Não precisam bloquear um piloto humano se forem tratados como ainda em homologação. |
| Reinício e recuperação | Transporte durável tem base implementada; recuperação industrial não está registrada no bundle. Restore de produção e comportamento após deploy não foram testados nesta análise. |

## Capacidade para 30 usuários e dez simultâneos

O número de usuários cadastrados não é o fator principal. A carga vem das sessões ativas, conversas abertas, mensagens/mídias, buscas no CRM, relatórios e IA em paralelo. Os 27.829 negócios e 20.695 contatos locais tornam a paginação mais importante que os 35 cadastros de operadores.

Pontos favoráveis:

- Node persistente, PostgreSQL e eventos SSE são compatíveis com o porte solicitado como desenho arquitetural.
- Listagem de chat usa preview, histórico é paginado e o CRM carrega 20 cards por etapa no quadro.
- Há índices, consultas de enriquecimento em paralelo e verificação de versão em movimentos concorrentes.
- Envios são persistidos e tentativas de resultado incerto são separadas de falhas comuns.

Pontos a medir:

- O pool de dez conexões é compartilhado pela aplicação, pelos dois tenants e pelos serviços de fundo. **Dez conexões não equivalem a dez usuários máximos.** Não aumentar o pool apenas porque haverá dez operadores.
- Cada conexão SSE revalida sessão em eventos e heartbeats. Há reconciliação de atribuição a cada 12 segundos, além de verificações em lotes dos chats em cache e polling em componentes específicos. A amplificação de consultas depende do tráfego de mensagens e permissões.
- Recuperação durável busca lotes de 20 por tenant e processa envios sequencialmente, com intervalo configurado de 30 segundos. Medir drenagem de backlog após queda; isso não é um limite do envio normal imediato.
- Mídias persistidas em base64 no banco aumentam volume, memória e backup. Ensaio deve incluir áudios, imagens e documentos, não só texto.
- A configuração Railway tem uma réplica. A entrega de eventos usa listeners em memória; aumentar réplicas sem tratar distribuição de eventos pode produzir telas desatualizadas. A reconciliação de atribuição não substitui distribuição integral de mensagens entre processos.
- CPU/RAM, plano do banco, conexões disponíveis, latências e rede da implantação não foram medidos. Não existe certificação de capacidade baseada apenas no código.

**Conclusão de capacidade:** não foi identificado um motivo estrutural para esse porte exigir outra arquitetura, mas a capacidade ainda não está demonstrada. O ensaio de concorrência não produziu tempos válidos porque a primeira chamada do serviço CRM falhou por schema. Corrigir funcionamento vem antes de otimizar por suposição.

## Sequência de liberação sugerida

1. **Estabilizar o núcleo:** schema e configuração do ambiente de destino, respostas rápidas e sincronização de envios. Conferir usuários/grupos, setores e membros efetivos. Decidir se o CRM local será a fonte oficial; o cadastro local ainda informa RD primário/manual.
2. **Homologar atendimento humano:** receber texto/áudio/imagem/documento; assumir; responder; transferir; vincular negociação; registrar nota/tarefa; encerrar; reabrir. Validar os estados de envio e a retomada com template quando exigida pelo canal.
3. **Ensaiar colaboração e recuperação:** duas capturas concorrentes; dez sessões operando; queda do navegador e da internet; reinício do servidor; backlog e envio de resultado incerto. Nenhuma mensagem deve sumir ou ser reenviada inadvertidamente.
4. **Piloto assistido:** poucos operadores da Tecfag, cobertura do gestor e caminho de retorno definido. Expandir para dez simultâneos após observar o ciclo diário e seus picos. Manter a operação Valem preservada na implantação compartilhada.
5. **Liberar Fagner separadamente:** serviços efetivamente ativos no runtime, destinos homologados, catálogo oficial revisado, escala e indisponibilidades testadas, intervenção humana e recuperação após restart confirmadas. Se a triagem automática for indispensável desde o primeiro dia, este passo passa a ser requisito da virada inicial.

## Critérios de aceite propostos para o ensaio

São metas para validação, não resultados já medidos:

- Dez sessões de operador por pelo menos uma hora em homologação, com volume representativo de texto e mídia e dados próximos do volume de operação.
- Um único responsável após capturas concorrentes; nenhuma negociação criada duas vezes pelo mesmo encaminhamento.
- Mensagens recebidas e enviadas visíveis nos navegadores autorizados, sem exigir recarga manual para supervisão.
- CRM e listas comuns com p95 de resposta do servidor abaixo de dois segundos; abertura de histórico abaixo de três segundos, separando tempo do servidor, rede e renderização.
- Confirmação local de mensagem persistida em até dois segundos no p95; entrega externa medida separadamente conforme o provedor, sem confundir `pending`/`accepted` com entrega ao cliente.
- Sem erros não tratados, perda de mensagem, crescimento contínuo de backlog ou esgotamento de conexões durante o ensaio.
- Reinício recupera pendências esperadas e identifica resultados desconhecidos para revisão, sem duplicar mensagens.
- Se Fagner estiver ligado: nenhuma disputa com operador humano, nenhum destino inválido e retomada das triagens interrompidas comprovada.
- Backup e retorno operacional ensaiados em ambiente separado antes da virada ampla.

**Decisão final:** preparar piloto após corrigir bloqueios; não declarar go-live completo aprovado apenas com build e testes verdes. O principal trabalho restante é fechar o ciclo operacional integrado, não adicionar módulos.

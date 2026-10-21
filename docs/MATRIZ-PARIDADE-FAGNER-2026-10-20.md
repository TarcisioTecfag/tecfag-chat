# Matriz atual de paridade — Fagner Conversas + Site

Data: 20/10/2026. Atualiza os 47 itens do diagnóstico `MAPA-PORTE-FAGNER-2026-10-20.md` sem apagar suas constatações históricas. O destino é um atendimento nativo único; RD Marketing permanece separado.

Atualização de 21/10/2026: [destinos simplificados por equipe](./UNIFICACAO-DESTINOS-TRIAGEM-2026-10-21.md) e [contexto de origem/produto](./CONTEXTO-SITE-PRODUTO-2026-10-21.md). S02/S04 e C25 avançaram na integração local, mas a validação de produto/loja e a homologação publicada continuam pendentes.

**Esta é uma matriz de código e evidências locais. Nenhum item está homologado por esta entrega nos canais da operação.** Não usar quantidade de telas, testes ou linhas desta tabela como percentual de conclusão do porte.

Estados: **L** = núcleo implementado com evidência local; **P** = parcial, com integração, comportamento ou validação faltante; **A** = equivalente ainda não demonstrado no caminho industrial unificado, a integrar/implementar. Uma base existente em outro módulo não equivale à capacidade integrada.

Referências de evidência:

- **T**: `test/industrial-triage.test.mjs` — política por intenção, precedência, coleta e autorização de equipe.
- **C**: `test/industrial-catalog.test.mjs` — Decisor, catálogo e API de configurações.
- **S**: `test/industrial-site-channel.test.mjs` — regras do site, continuidade e contratos de integração. Parte dessa suíte inspeciona código; não é teste de canal real.
- **R**: `test/industrial-silence-resilience.test.mjs` — régua, expediente e recuperação por política pura.
- **M**: `test/industrial-monitor.test.mjs` — projeção de estado e handlers autenticados.
- **D**: `test/industrial-handoff-issues.test.mjs` — diagnóstico, entrega compartilhada e despachante com dependências isoladas.
- **H**: `test/industrial-triage-history.test.mjs` — notas, paginação, sessão e contratos do histórico. Implementação em `IMPLEMENTACAO-HISTORICO-NOTAS-2026-10-20.md`.
- **B**: `test/industrial-review.test.mjs` — briefing, revisão humana, permissões e contrato da API. Implementação em `IMPLEMENTACAO-BRIEFING-REVISAO-2026-10-20.md`; interface conferida em prévia com dados e APIs fictícios.
- **PG**: `test/industrial-handoff-postgres.test.ts` — PostgreSQL local isolado, transação, concorrência, configuração, monitor e avisos pós-commit.
- **O**: `test/industrial-site-context.test.mjs` — contexto/UTM, consulta explícita, handlers reais do WebSocket, métodos reais do widget e renderização HTML do painel com dependências isoladas.

## Conversas — 27 capacidades

| ID | Capacidade | Estado | Código/evidência local | O que falta para paridade operacional |
|---|---|---|---|---|
| C01 | Entrada, identidade e deduplicação | P | `whatsapp/inbound.ts`, adaptadores; T/S | Homologar lotes e reenvios Meta/Baileys; importar aliases do legado sem disparar atendimento histórico. |
| C02 | Pausa, retomada e intervenção humana | P | `sdr-engine.ts`, APIs de conversa, store; T/PG | Homologar todas as ações de operador e retorno à automação nos dois canais, inclusive durante geração e envio. |
| C03 | Agrupamento e mensagem durante geração | P | `sdr-debouncer.ts`, recuperação; R | Validar concorrência de geração entre processos; o debounce em memória não é prova de exclusão distribuída. |
| C04 | Reinício e recuperação de pendências | P | `sdr-recovery.ts`, plugin industrial; R/D/PG | Testar reinício real com mensagens em trânsito e os três transportes. O contrato do plugin e da entrega foi corrigido neste lote. |
| C05 | Cinco famílias e treze subfluxos | L | `industrial-policy.ts`; T | Homologar cenários anonimizados dos 13 subfluxos com a equipe. |
| C06 | Coleta por intenção | L | `assessIndustrialReadiness`, parser estruturado; T | Homologar respostas do Vertex; suporte e pedido humano não podem virar coleta comercial. |
| C07 | Extração múltipla sem repetição | P | `collectedData`, histórico recente e prompt | Avaliar primeira mensagem rica, correção de dados e mudança de assunto com o modelo real. |
| C08 | CNPJ e enriquecimento cadastral | P | `cnpj-service.ts`, contatos/contas CRM | Homologar indisponibilidade da consulta, sincronização da conta e distinção entre validade matemática e situação cadastral. |
| C09 | CPF tratado corretamente | L | Validação matemática no núcleo; T | Homologar cadastro, exibição e reuso de pessoa. Dígitos válidos não comprovam titularidade. |
| C10 | Decisor por catálogo, categoria e capacidade | L | `industrial-decisor.ts`, runtime Vertex; C/PG | Confirmar catálogo oficial e validar decisões do modelo com casos reais anonimizados. |
| C11 | LMS e enriquecimento de porte | P | Capital cadastral promove revisão no Decisor; C | O LMS completo não está demonstrado. Separar fatos cadastrais de inferência e decidir quais enriquecimentos serão mantidos. |
| C12 | Análise/revisão humana | L | Destino `REVIEW`, estado e motivo; T/C/PG/M | Configurar equipe real de revisão e homologar o trabalho do SDR humano. |
| C13 | Humano, pessoa específica e frustração | P | Pedido humano ignora gates de venda; T | O pedido humano já é suportado; confirmar política de pessoa específica, indisponibilidade e frustração com casos reais. |
| C14 | Escala, autorização e compensação | L | `industrial-handoff-store.ts`, rodízio; T/PG | Conferir equipe, permissões e compensações oficiais; homologar manutenção da escala. |
| C15 | Reserva, confirmação e cancelamento | L | Recibo por ciclo, locks e outbox; PG/D | Homologar cancelamento no transporte real. Não afirmar entrega externa exatamente uma vez quando o canal aceita e o processo cai antes de persistir a prova. |
| C16 | Card, contato, empresa, responsável e atividade | P | `sdr-crm-local.ts`, transação compartilhada; PG | Conferir tarefas/notas esperadas e a política de reuso por pessoa/funil/3h frente ao legado; reconciliar dados importados. |
| C17 | Fluxos sem oportunidade comercial | L | Política por subfluxo; T/PG | Validar orientações administrativas e equipe real de Análise e revisão humana. Atendimento Geral foi absorvido pela revisão. |
| C18 | Notas progressivas e relatório final | L | Notas por ciclo, arquivo, briefing final e revisão humana auditada; H/B/PG | Homologar uso com a equipe e canais. Revisão da coleta não aprova máquina/destino nem sincroniza cadastro automaticamente. Dados antigos descartados não são reconstruídos. |
| C19 | Áudio, imagem, documento e interpretação | P | SDR multimodal, `mediaInterpretation`, sender | Homologar tamanho, autorização, reenvio, memória e disponibilidade dos anexos em cada canal. |
| C20 | Catálogo e famílias não atendidas | P | Configuração industrial, catálogo preparado; C | Resolver conflitos de SKU `964` e `1137`; confirmar dados oficiais antes de importar. O JSON preparado tem 1.037 registros históricos. |
| C21 | Follow-up e retorno do cliente | P | Política industrial e engine; R | Homologar execução persistida, cancelamento por humano e retorno com os provedores reais. |
| C22 | Sem resposta e fechamento diário | P | Régua de abandono, etapa preservada; R | Validar job em operação e relatório diário; coluna/estado não substitui relatório. |
| C23 | Expediente e aviso fora do horário | P | Agenda industrial por configuração; R | Conferir agenda real, feriados e diferenças por equipe/setor; homologar aviso e retomada. |
| C24 | Score comercial em cinco dimensões | A | Score de navegação existe, mas é outra medida | Definir e portar dimensões, evidências e revisão; não reutilizar temperatura do site como score comercial. |
| C25 | Campanha e notificação operacional | P | Origem/UTM declarada no ciclo, briefing e painel; O/PG; avisos por ciclo | Confirmar destinatários e homologar atribuição de campanha; UTM informada pelo navegador não é atribuição verificada pelo RD Marketing. |
| C26 | Monitor, dados, histórico e simulação | P | SDR/Fluxos/Rodízio, projeção, diagnóstico e histórico paginado; M/D/H/PG | Homologar consulta de ciclos/notas, nomes amigáveis de destinos e simulador isolado. Histórico antigo depende dos registros preservados; não equivale à exportação integral de mensagens. |
| C27 | Custos, concorrência e recuperação | P | Vertex central, contexto de custo e workers | Teste de carga, limites entre instâncias, tratamento de cotas e reconciliação de custos. Sem fallback para outros provedores. |

## Site — 20 capacidades

| ID | Capacidade | Estado | Código/evidência local | O que falta para paridade operacional |
|---|---|---|---|---|
| S01 | Widget, sessão, histórico e reconexão | P | Widget por marca, adaptador e storage; S/PG | Validar instalação publicada, domínio/origem, sessão pública e reconexão em navegador. |
| S02 | Página, atividade e origem/UTM | P | Entrada/página/referrer/UTM em mensagens, ciclo, briefing e painel; O/PG | Homologar instalação e uso operacional. Tempo, scroll/cliques gerais, retenção e calibração da navegação continuam parciais. |
| S03 | Abordagem proativa por atividade | P | Caminho anterior possui proatividade; industrial evita saudação duplicada | Definir configuração industrial de abordagem e implementar no núcleo comum, com critérios e horário explícitos. |
| S04 | Consulta de produto pelo botão da página | P | Botão/API do widget → evento idempotente → adaptador comum; O | Instalar e homologar o botão no site novo e validar dados na loja. Nome/SKU/categoria ainda são declarados, sem comprovação VTEX ou qualificação automática. |
| S05 | Busca e especificações VTEX | A | Caminho anterior v2 usa Tray; industrial usa catálogo decisório | Integrar consulta VTEX por configuração do tenant; catálogo decisório não substitui busca comercial da loja. |
| S06 | Preço público, frete e links de compra | A | Política industrial não demonstra essa capacidade integrada | Consolidar a diferença Site/WhatsApp do legado e criar consulta controlada, com dados verificáveis e regras de oferta. |
| S07 | Fluxos industriais do site | L | Mesmo SDR, política e handoff; T/S | Homologar os 13 subfluxos pelo widget publicado, com a equipe. |
| S08 | Coleta, resumo e confirmação | P | `collectedData` comum e pré-chat validado; S | Conferir aproveitamento do pré-chat sem repetir perguntas e resumo/overview dos fluxos antigos. |
| S09 | Operador no widget e retorno à IA | P | Atendimento nativo em Conversas; S | Homologar posse e retorno; saída humana de anexos/templates ainda tem restrições. |
| S10 | Atenção, arquivo, reabertura e motivos | P | Reabertura transacional e histórico de ciclo; PG | Completar marcador de atenção e motivos operacionais; homologar fechamento/reabertura pelo operador. |
| S11 | Continuidade e perfil entre canais | P | Código de uso único, vínculo e dados; S/PG | Homologar ponta a ponta com telefone real. A janela copiada é das últimas 200 mensagens; não é exportação integral nem reconciliação de todo o acervo de mídias. |
| S12 | Mesmo CRM e mesma distribuição | L | Serviço atômico compartilhado; T/S/PG | Configurar destinos reais e demonstrar, no canal, que o mesmo ciclo não consome dois rodízios. |
| S13 | Resgate de lead parcial | P | Regra industrial de resgate; R | Validar os tempos e mensagens reais; ausência de resposta não comprova confirmação dos dados. |
| S14 | Notas, briefing e timeline | L | Notas progressivas, arquivo por ciclo, briefing e revisão humana; H/B/PG | Homologar autenticação, consulta e canais reais. A prévia de interface usa APIs fictícias; não comprova o fluxo publicado. |
| S15 | Score de navegação e retorno | P | Scoring existente no livechat | Calibrar comportamento industrial, separar de porte/score comercial e validar retorno do visitante. |
| S16 | Estrelas/NPS e motivo de fechamento | A | Equivalência não demonstrada no widget industrial | Implementar evento verificável e vinculado ao atendimento; avaliação e venda confirmada são eventos distintos. |
| S17 | Ativação, contenção, latência e coortes | P | Snapshot real de ciclos, ativos e início no dia; M/PG | Instrumentar métricas históricas com denominadores e fontes. Conversão e tempo médio seguem indisponíveis. |
| S18 | Anexos, presença e notificações | P | Entrada multimodal e entrega/presença do bot | Homologar os formatos, anexos enviados pelo operador, sessão desconectada e autorização da mídia entre canais. |
| S19 | Pedido VTEX confirmado por webhook | A | Equivalente não demonstrado no atendimento industrial | Integrar evento autenticado e idempotente da loja, reconciliando pedido e atendimento. Não deduzir venda da resposta da IA. |
| S20 | Exportações e relatórios | P | Há bases de relatórios no produto; contrato unificado pendente | Definir e implementar exportação autorizada com filtros, períodos, campos, mídias e ciclos; validar contra o legado. |

## Ordem de continuidade

1. Homologar monitor, histórico paginado, revisão humana e briefing final. A implementação local tem evidência em H/B/PG e uma prévia de interface com dados fictícios.
2. Homologar a evidência de origem/consulta de produto e integrar dados verificáveis da loja, consolidando a política VTEX/preço/frete antes de chamar o site de equivalente ao legado.
3. Portar score comercial, avaliação/fechamento e exportações com contratos verificáveis.
4. Confirmar catálogo/destinos e executar E7: dados reconciliados, casos anonimizados, transportes e equipe em ambiente separado.
5. Executar E8 somente com corte de entrada e rollback por canal, preservando Valem e um único bot por entrada.

Os cenários H01–H26 do diagnóstico continuam sendo critérios de homologação; os testes locais não aprovam automaticamente esses cenários. Nenhum serviço legado, webhook ou widget publicado foi alterado por este documento.

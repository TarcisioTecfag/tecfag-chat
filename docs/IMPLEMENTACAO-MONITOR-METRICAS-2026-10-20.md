# Monitoramento e métricas — primeiro lote E6

Continuação: [causas de encaminhamento e correção da entrega pós-commit](./IMPLEMENTACAO-CAUSAS-HANDOFF-2026-10-20.md); [matriz atual das 47 capacidades](./MATRIZ-PARIDADE-FAGNER-2026-10-20.md). As pendências abaixo registram o término deste primeiro lote.

Data: 20/10/2026. Continuação do checkpoint `RETOMADA-PORTE-FAGNER-2026-10-20.md`. Implementação local; não houve ativação de SDR, publicação, importação ou escrita no banco da operação.

## Comportamento entregue

O monitor industrial passa a distinguir coleta, coleta pronta, encaminhamento pendente, espera por equipe, transferência confirmada, atendimento humano, interrupção, sem resposta, resolução pela automação e continuidade em outro canal.

A confirmação de transferência exige recibo do ciclo atual, horário de commit válido e correspondência entre o responsável do recibo e o responsável salvo na conversa em atendimento humano. Troca manual de responsável aparece como atendimento humano; não é atribuída ao rodízio anterior. Encerrar uma conversa sem responsável não comprova transferência.

A projeção mostra campos pendentes, necessidade de revisão, destino, linha de catálogo, tentativas, confirmação ao cliente e origem/continuação entre canais. O componente traduz os motivos conhecidos para a operação. Não envia prompts, requisições de IA ou checkpoints brutos à interface.

O painel não anuncia mais card ou responsável por simples conclusão do fluxo industrial. O card vem de vínculo ativo consultado no banco; não se aceita o ID antigo do metadado como prova de vínculo. Sem responsável atual, não se usa carteira, operador logado ou vendedor de um ciclo anterior como substituto. Mensagens de exemplo que eram fabricadas na ausência de histórico foram removidas da leitura do monitor.

## Métricas e definições

`agent-monitor-store.ts` seleciona o ciclo mais recente por conversa e tipo de agente, ordenando por início e ID. Uma interação tardia no ciclo antigo não o torna o ciclo corrente. A leitura de detalhes industriais usa a mesma seleção, apenas para SDR.

| Campo | Definição |
|---|---|
| `currentCycles` | Quantidade de ciclos correntes registrados em `agent_flow_states`, com conversa pertencente ao mesmo tenant. Não é o total histórico de leads. |
| `activeFlows` | Ciclo corrente com `outcome=in_progress` e sem conclusão; para SDR, a conversa também precisa estar em `automacao` e sem operador. |
| `startedToday` | Ciclos correntes cujo início ocorreu na data de Brasília (`America/Sao_Paulo`). Não soma ciclos antigos já substituídos ou arquivados. |
| Conversão em vendas | Indisponível (`null`), sem um funil histórico instrumentado que comprove esse resultado. |
| Tempo médio histórico | Indisponível (`null`), até consolidar a duração dos ciclos e seu denominador. |

Contagens bem-sucedidas sem registros retornam zero. Falha de consulta não vira zero: `/api/valentina/agents` retorna 503 e código `METRICS_UNAVAILABLE`; `/api/valentina/sdr` sinaliza resumo indisponível e permite inspecionar os detalhes que conseguiu carregar. A API de agentes não usa mais `mockMetrics`.

O cabeçalho do SDR distingue contagens globais dos ciclos registrados da quantidade de atendimentos carregados na lista. A lista continua limitada a até 50 fluxos recentes e 30 conversas em automação sem fluxo; não representa todo o histórico. Seus filtros não redefinem o escopo do resumo global.

## Correções de integração

- Canal `livechat` é normalizado para `site` no filtro da interface.
- A configuração exibida começa desligada até que uma configuração persistida comprove habilitação.
- As rotas usam `requireSession`; a autoridade de tenant vem da sessão. Novas consultas e joins filtram tenant explicitamente. As leituras não semeiam ou habilitam agentes.
- A leitura de card por contato, mantida para o caminho anterior, usa `crm_deal_contacts` e IDs do tenant. Foi corrigida a referência ao campo inexistente `crm_deals.contactId`; o caminho industrial exige vínculo direto com a conversa.
- A interface evita sobrepor consultas de polling, aborta a requisição ao trocar tenant/desmontar e limpa os dados do contexto anterior.
- Respostas do monitor usam `Cache-Control: no-store`.

## Validação

Evidência consolidada e hashes: `fagner-monitor-metrics-2026-10-20.json`.

Resultado: **180 testes em 15 suítes e 33 cenários PostgreSQL aprovados; build e ESLint dos seis arquivos novos ou formatados aprovados.** A verificação global de tipos passou de 22 para 21 diagnósticos, removendo a referência inválida no monitor SDR e sem novos diagnósticos. O PostgreSQL local de teste foi desligado ao final.

- Testes puros e de handlers reais isolados de banco/provedores: estados, recibos de outro ciclo, troca de responsável, confirmação de envio, metadado inválido, autenticação, tenant da sessão e indisponibilidade de métricas.
- PostgreSQL local de teste: snapshot por ciclo corrente, separação de agente, exclusão de humanos/encerrados, filtro de tenant e mudança do dia às 03:00 UTC (meia-noite de Brasília). Usa schema privado descartável; não executa migrations/seeds da operação.
- Build, ESLint dos novos módulos/handlers/testes e comparação dos diagnósticos TypeScript com o checkpoint anterior.
- Não houve teste visual em navegador nem homologação com Vertex, widget publicado ou canais reais. O lint global e a verificação global de tipos ainda têm pendências fora deste lote.

## O que ainda falta para encerrar E6

1. Instrumentar causas operacionais específicas da pendência de handoff: configuração de destino, validação de setor/etapa, ausência de elegível e falha de CRM/transação. Atualmente o painel distingue espera por equipe e pendência genérica; não expõe uma causa específica que não foi persistida.
2. Resolver nome amigável de referência e setor a partir dos IDs, preservando a distinção entre destino atual da configuração e destino efetivamente usado no recibo.
3. Consolidar histórico de ciclos, paginação e agregados históricos sem chamar o snapshot atual de total de leads.
4. Fechar a matriz funcional de notas, score, origem de campanha, NPS e exportações do legado. Este lote não implementa esses recursos nem comprova paridade integral.
5. Homologar visualmente o monitor e o atendimento completo com falhas de transporte e reinício. A confirmação persistida de envio não equivale à leitura da mensagem pelo cliente.

E7 (importação/homologação) e E8 (virada/rollback) continuam pendentes. A operação da Valem e a configuração dos canais não foram alteradas por esta entrega local.

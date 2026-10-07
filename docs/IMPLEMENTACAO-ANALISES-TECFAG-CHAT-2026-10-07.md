# Porte das análises comerciais para o Tecfag Chat

Este documento complementa o [mapa completo](MAPA-COMPLETO-ANALISES-TECFAG-ANALYTICS-2026-10-07.md). O Tecfag Analytics foi consultado somente em leitura; este porte usa exclusivamente registros do CRM e do atendimento locais. Não importa histórico do RD.

## Contrato de dados

Todas as consultas internas exigem sessão de administrador. O tenant vem de `session.tenantId`; `division` aceita somente `personnalite`, `maquinas` ou vazio. Datas comerciais usam `America/Sao_Paulo`. `month=AAAA-MM` é opcional e assume o mês corrente. `page` e `limit` são validados; o limite máximo é 100.

`GET /api/commercial/analysis` oferece:

| `view`             | Entrega                                                                                                                                                                                        |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pipeline`         | Matriz consultor × etapa, quantidade/valor, total ativo e participação. Etapas excluídas continuam visíveis, fora do total ativo.                                                              |
| `maturity`         | Cinco faixas de valor/idade, fora de maturidade, sem classificação, cinco horizontes de previsão, metas, conversão, promessa e cobertura por consultor.                                        |
| `deals`            | Negócios paginados para `mode=pipeline`, `maturity` ou `forecast`; filtra consultor, etapa, faixa e busca, com cliente, contato, status da última diretriz e elegibilidade para pontuar hoje.  |
| `responsibilities` | Indicadores de execução, atrasos e valor do mês, quadro por consultor, fila ordenada e ações individuais. Inclui consultores comerciais desativados na TV para preservar cobranças do período. |
| `goals`            | Meta e realizado por consultor, dia e semana; série acumulada da Curva S, dias úteis e ajustes do calendário. O campo **Faturado** continua sendo o valor dos negócios ganhos no CRM.          |
| `losses`           | Mês atual, anterior e histórico com motivo, categoria configurada, submotivos, porcentagem, valor e tendência mensal.                                                                          |
| `loss-deals`       | Negociações perdidas paginadas por período/motivo.                                                                                                                                             |
| `tma`              | Duração real transferência → primeira resposta, quatro faixas configuráveis, média, SLA real, ranking por consultor e fila pendente; inclui resumo do dia.                                     |
| `tma-events`       | Atendimentos respondidos paginados por consultor e faixa; nenhum cliente ou tempo é fabricado.                                                                                                 |
| `cohorts`          | Seis safras por mês de criação, faixas de valor e negócios sem valor. A régua atual reclassifica as safras, sem alterar os negócios.                                                           |
| `cohort-deals`     | Negociações da safra, inclusive filtro `unclassified=true`, paginadas.                                                                                                                         |
| `operational`      | Consultores configurados/na TV/online, oportunidades abertas, transferências pendentes, responsabilidades vencidas e alterações recentes do CRM local.                                         |

## Ciclo de responsabilidade

1. O gestor abre **BI Comercial > Previsão**, escolhe consultor e faixa, busca os negócios e seleciona os elegíveis.
2. `POST /api/commercial/directives/point` revalida tenant, dono, estado aberto, valor positivo e etapa incluída. A transação grava a diretriz do dia, o retrato do negócio, a nota e o evento do CRM. A chave tenant + negócio + data impede duplicidade mesmo em requisições concorrentes.
3. **BI Comercial > Responsabilidades** mostra execução, cobranças de hoje e vencidas. O consultor recebe a diretriz no Início Comercial.
4. O consultor conclui com evidência interna vinculada ou relato manual. Para continuidade, pode selecionar uma tarefa futura existente ou criá-la junto da evidência, na mesma transação. Ganho e perda devem estar registrados no CRM antes da conclusão.

O retrato da pontuação depende da migração aditiva `0029_commercial_directive_snapshot.sql`. A taxonomia de perdas depende de `0030_commercial_loss_taxonomy.sql`; ambas estão registradas no migrador da plataforma. O catálogo de categorias começa vazio e é configurado em **Gestão Comercial > Configurações**, com motivos do CRM local. Motivos não mapeados permanecem em “Sem categoria”; não há classificação presumida.

## Verificação e limites atuais

`npm run build`, `npx tsc --noEmit` e os 15 testes comerciais com Bun passaram após a implementação. Não foi executado teste contra o banco de produção, nem migração de dados históricos. Os gráficos de rosca, a apresentação de TV em colunas fixas, o PDF da pontuação e o acabamento móvel ainda precisam de interface própria; os contratos e registros correspondentes estão disponíveis no backend. A taxonomia de perdas só exibirá categorias após configuração dos motivos locais.

# Mapa das análises do Tecfag Analytics para o Tecfag Chat

**Escopo:** inventário funcional das telas analíticas do Analytics, lido no código em 07/10/2026. A origem `C:/Users/TEC FAG/Documents/antigravity/fearless-pythagoras` foi consultada somente em leitura. O destino é este repositório, no módulo comercial do tenant Tecfag. Dados históricos do Analytics ficam fora deste porte.

**Estado:** especificação de migração, não declaração de paridade. O BI atual do Chat é um primeiro corte; os detalhamentos e vários gráficos abaixo ainda não existem. As fórmulas e os estados precisam ser reconciliados com dados de teste do CRM próprio.

**Atualização da implementação:** o estado das tabelas abaixo descreve o inventário antes da ampliação do backend. Consulte [Implementação das análises comerciais](IMPLEMENTACAO-ANALISES-TECFAG-CHAT-2026-10-07.md) para os contratos já aplicados, testes e limites que permanecem.

## 1. Mapa de navegação e encaixe

| Superfície do Analytics | Conteúdo real | Lugar no Tecfag Chat | Estado atual |
|---|---|---|---|
| BI para TV, coluna fixa **Diretrizes CRM** | Total sob gestão, execução, atraso, barras por consultor/equipe, fila de cobrança e modais | **War Room > Responsabilidades**, painel lateral da TV e aba própria de gestão | Dados de diretrizes existem; análise consolidada falta |
| BI para TV, coluna fixa **TMA WhatsApp** | Média do dia, transferências, SLA, barras por faixa/consultor, fila de espera e clientes por faixa | **War Room > Atendimento comercial**, painel lateral alternável | Média/ranking básicos existem; faixas, fila e detalhe reais faltam |
| Módulo 0 **Oportunidades & Pipeline por Fase** | Matriz consultor × sete etapas para Personnalité e Máquinas; quantidade, valor, participação e total; clique abre negócios | **BI Comercial > Pipeline**; TV usa a mesma projeção | Apenas total por etapa existe |
| Módulo 1 **Responsabilidades por De-Para CWR** | Cinco degraus de maturidade por consultor/equipe, valor maduro, meta, conversão, promessa, cobertura, fora de maturidade; clique abre negócios | **BI Comercial > Maturidade** | Faixas e lista plana parciais |
| Módulo 2 **Responsabilidades previstas CWR** | Cinco horizontes de fechamento: Hoje/prontos, até 15/30/60/90 dias; valor a faturar, promessa e cobertura por consultor/equipe | **BI Comercial > Previsão e pontuação** | Coortes planas e seleção simples parciais |
| Módulo 3 **Cockpit de Metas & Pacing** | Global/equipe/consultor, dias úteis, realizado, gap, ritmo diário e semanal, oportunidades hábeis | **BI Comercial > Metas e ritmo**; edição em **Gestão Comercial > Metas** | Meta, realizado e ritmo mensal parciais |
| Módulo 4 **Perdas** | Três donuts selecionáveis: mês atual, anterior e histórico; categorias, porcentagens, submotivos e barras | **BI Comercial > Perdas** | Contagens e motivos atuais parciais |
| Módulo 5 **Ranking Geral de Resposta & SLA** | Pódio com TMA e índice por consultor | **BI Comercial > Resposta e SLA** | Ranking por média parcial |
| Gráfico extra **Safras & Régua De-Para** | Seis meses de criação, linhas por faixa de valor, cards classificados/sem valor, detalhe mensal dos sem classificação | **BI Comercial > Safras** como visão própria e opção de tela cheia | Ausente |
| BI móvel | Cinco abas: Maturidade, Pipeline, Metas, TMA/SLA, Perdas; tabelas/cards e detalhamentos móveis | As mesmas visões do BI Comercial, adaptadas ao móvel | Layout responsivo básico, sem equivalência de conteúdo |
| Calendário comercial analítico | Dia a dia de ganhos, meta, feriados, detalhe das vendas e **Curva S** acumulada | **Gestão Comercial > Calendário**, com ligação ao BI de metas | Grade e fechamentos básicos; Curva S ausente |
| Metas Comerciais | KPIs mensais e tabela por consultor com meta, conversão, realizado, cobertura e gap | **Gestão Comercial > Metas** | CRUD e KPIs parciais |
| Status Operacional | Consultores ativos/na TV, dias úteis, alertas, alterações recentes e saúde das fontes | **Gestão Comercial > Operação** | Ausente; sincronização RD não será portada |

Origem principal: `app/components/TecfagApp.tsx:23`, `app/components/pages.tsx:964`, `app/components/BITVMobile.tsx:860`, `app/components/hub-pages.tsx:49`, `app/components/MaturityCohortFullscreenModal.tsx:582`. Destino atual: `src/components/commercial/CommercialBiView.tsx`, `CommercialManagementView.tsx`, `CommercialHomeView.tsx` e `src/lib/commercial/bi-service.ts`.

## 2. Todos os gráficos e detalhamentos do War Room

### 2.1. Coluna fixa: responsabilidades

- **Três KPIs clicáveis:** negócios/valor sob gestão, taxa de execução (concluídas ÷ atribuídas) e negócios/valor em atraso.
- **Geral de todos:** Personnalité e Máquinas separadas; para cada consultor, barra empilhada de concluídas, pendentes hoje e atrasadas, com quantidade, valor e taxa individual.
- **Mais atrasados:** fila ordenada por dias de atraso, depois maior valor; consultor, equipe, negociação, cliente, telefone, etapa, data, tempo de atraso e prioridade visual.
- **Detalhamento do consultor:** total, concluídas, pendentes hoje e atrasadas; abas Todas/Atrasadas/Hoje/Concluídas; linha de cada negociação com instrução, valor, status e acesso ao CRM/portal.
- **Detalhamento da taxa:** modal com barra e percentual de execução de cada consultor.
- **Rotação interna:** as duas visões da coluna alternam automaticamente; clique manual também é aceito.

Fonte legada: `app/components/pages.tsx:1055`, `:1098`, `:1150`, `:3711`, `:3969`; agregação em `app/api/tv/route.ts:1058–1180`. O Chat precisa de agregação de `commercialDirectives` por tenant, período e operador, com snapshots de valor/etapa para preservar o que foi cobrado. A consulta atual de diretrizes lista registros, mas não fornece esse painel.

### 2.2. Coluna fixa: TMA comercial

- KPI de TMA médio do dia, transferências e SLA.
- Barras empilhadas por consultor/equipe nos quatro intervalos configuráveis de tempo; clique em faixa ou total abre os atendimentos.
- Fila de transferências ainda sem primeira resposta, ordenada pelo maior tempo, com cliente/telefone, consultor e semáforo de SLA.
- Modal por consultor/faixa com busca e cartões/linhas dos atendimentos.

Fonte legada: `app/components/pages.tsx:1400–1740`, `app/api/tv/route.ts:1022`. **Atenção:** em `app/api/tv/route.ts:1022–1055`, a divisão por faixas é estimada a partir de totais; `app/lib/mock-bi-data.ts:1000` fabrica até 18 clientes por faixa para o modal. No Chat, as faixas e as linhas devem vir somente de `commercialTransferResponseEvents` e de conversas reais, seguindo a decisão do usuário: **atribuição ao consultor → primeira resposta dele**. Ausência de resposta permanece pendente, sem tempo final fictício.

### 2.3. Módulo 0: pipeline

- Duas matrizes, uma para cada equipe. Linhas por consultor e total da equipe; colunas Requalificação, Esfriando, Leads Recebidos, Abordagem Comercial, Qualificado, Proposta Enviada, Fechamento e Total Funil.
- Cada célula mostra **quantidade + valor**. A porcentagem da célula é participação no valor da carteira; o Total Funil mostra participação no valor da equipe.
- Clique na célula abre negócio por consultor/equipe/etapa; modal oferece filtro de etapa, busca e acesso ao card local.
- A Requalificação aparece na matriz, mas fica fora do total ativo no legado. O mapeamento no Chat deve usar IDs/configuração de etapas, sem comparar nomes aproximados.

Fonte: `app/components/pages.tsx:1784–1894`, `:3504–3705`; `app/api/deals/by-phase/route.ts`. Atual: `bi-service.ts` agrega por etapa, sem matriz por consultor, percentuais ou drilldown.

### 2.4. Módulo 1: maturidade atual

- Cinco degraus configuráveis por **valor da negociação e dias desde criação**. Negócios de valor zero são separados; negócios ainda jovens são “fora de maturidade”.
- Por consultor/equipe: meta, taxa de conversão, valor maduro por faixa, total maduro, promessa (`valor maduro × conversão`) e cobertura da meta.
- Clique no nome/total/faixa abre a lista do consultor; abas Todas, cada faixa e Fora de Maturidade; busca por negócio, cliente, empresa, telefone, equipamento e etapa; links ao card.

Fonte: `app/components/pages.tsx:1895–2142`, `:3144–3497`; classificação em `app/api/tv/route.ts:95–163`, detalhe em `app/api/deals/maturity/route.ts`. Atual: `classifyMaturity` e coortes existem, mas faltam a grade por consultor/equipe, a faixa fora de maturidade e o detalhe completo.

### 2.5. Módulo 2: previsão e pontuação do gestor

- Cinco horizontes pelo **tempo restante até a maturidade**: Hoje/prontos ou atrasados, até 15, 30, 60 e 90 dias. A faixa de previsão é diferente da faixa de valor que definiu a maturidade.
- Por consultor/equipe: meta, total a faturar, quantidade, conversão, promessa (`pipeline × conversão`) e cobertura.
- O gestor clica em um consultor ou degrau. O modal mostra todas as oportunidades ou uma faixa; busca e detalhe de cliente/empresa/telefone, valor, idade/horizonte, etapa e link ao card.
- **É nesse modal, no modo Previsão, que o gestor pontua responsabilidades:** marca negócios individualmente ou seleciona todos os disponíveis na aba, vê quantidade e valor selecionados e confirma. Negócios já pendentes hoje ficam bloqueados; linhas exibem “Sinalizada Hoje”, “Atrasada no Consultor” ou “Diretriz Concluída”. O legado grava a cobrança do dia, cria nota no CRM e baixa PDF por consultor.

Fonte: `app/components/pages.tsx:2143–2369`, `:3144–3497` e `:176–230`; `app/api/deals/guidelines/route.ts`; `app/lib/export-guidelines-pdf.ts`. No Chat, o endpoint `POST /api/commercial/directives/point` e uma seleção básica nas listas de Maturidade atual e Previsão já existem. Essa posição ainda difere do fluxo original, concentrado no **detalhamento da Previsão por consultor**. **Ainda faltam** o modal por consultor/faixa, seleção de todos os resultados elegíveis, status por negociação, totais da seleção, snapshot da pontuação e PDF. A pontuação deve permanecer ligada ao negócio e ao consultor por IDs locais, nunca por nome.

### 2.6. Módulo 3: metas e ritmo

- Banner global: dias úteis restantes, meta, percentual realizado, valor necessário por dia e ganho hoje.
- Duas visões alternáveis: **meta diária recalculada** e **meta semanal**. Por consultor/equipe há barra de avanço mensal, gap, ritmo esperado, meta/realizado do dia ou da semana, estado à frente/no ritmo/atrás e botão para oportunidades hábeis do dia.
- O botão de oportunidades abre o mesmo detalhamento de maturidade; assim o gestor sai da meta e chega aos negócios que podem movê-la.

Fonte: `app/components/pages.tsx:2370–2757`, cálculo em `app/api/tv/route.ts:785–900`. Atual: meta mensal, realizado e ritmo diário básico. Faltam semanal, ganho hoje, estado, conexão aos negócios hábeis e apresentação por equipe.

### 2.7. Módulo 4: perdas

- **Três gráficos de rosca:** mês atual, mês anterior e histórico. Selecionar um muda a lista da direita.
- Lista: categoria, contagem, percentual, barra proporcional e todos os submotivos com respectivas contagens. No histórico, aparecem total acumulado, média mensal e primeiro mês.
- Fonte temporal e categorização no Chat: `crmDeals.status = lost`, `closedAt` em São Paulo e catálogo/motivo local; não copiar cache RD.

Fonte: `app/components/pages.tsx:2758–2903`, `app/api/tv/route.ts:233–267`, `:755–780`. Atual: totais dos dois meses, contagem histórica e motivos do mês atual. Faltam três períodos completos, categorias/submotivos e gráficos.

### 2.8. Módulo 5: ranking de resposta

- Pódio visual dos três primeiros e cartões dos demais; consultor, equipe, TMA, índice e posição.
- O legado deriva o índice de uma fórmula aplicada ao TMA médio, com limites próprios; essa pontuação não é a porcentagem real de conversas dentro do SLA. No Chat, apresentar fórmula explícita e preferir o **percentual real de eventos dentro do SLA**, mantendo o TMA separado.

Fonte: `app/components/pages.tsx:2904–2965`, `app/api/tv/route.ts:905–960`. Atual: ordenação por média e quantidade; faltam índice definido e detalhe por evento.

## 3. Análises fora dos seis módulos rotativos

| Visão | Gráficos, filtros e ações | Destino e lacuna |
|---|---|---|
| **Safras & Régua De-Para** | Gráfico multilinhas dos últimos seis meses por cinco faixas de valor, filtro de faixa, totais/classificados/sem valor/volume, tooltip mensal, rastreador automático de TV; grid de seis meses de negócios sem valor e modal com busca/acesso ao negócio | **BI Comercial > Safras**. Ausente. Fonte: `MaturityCohortFullscreenModal.tsx:582–1906`, `api/deals/cohorts/route.ts`. Não confundir com a maturidade atual: aqui a coorte é o **mês de criação**. |
| **Calendário e Curva S** | Filtro empresa/equipe/consultor, mês, meta/realizado/necessário, grade por dia, detalhe dos fechamentos, feriados/expediente; gráfico SVG de meta acumulada esperada versus ganho acumulado | **Gestão Comercial > Calendário**, com acesso também em Metas. Grade básica existe; Curva S e detalhamento completo faltam. Fonte: `hub-pages.tsx:1007–1885`. |
| **Metas Comerciais** | Quatro KPIs, tabela consultor/equipe com meta, conversão, meta diária, realizado, atingimento e gap; edição inline | **Gestão Comercial > Metas**. CRUD existe; completar tabela, filtro e reconciliação. Fonte: `hub-pages.tsx:623–995`. |
| **Status Operacional** | Consultores ativos/TV, dias úteis, alertas e alterações recentes. “Última sincronização” e botão Sync são específicos do RD | **Gestão Comercial > Operação** com saúde de dados locais, sem sync RD. Fonte: `hub-pages.tsx:49–225`. Parte do legado contém valores fixos/fallback; não tratar como métrica real. |
| **Configuração da análise** | Parâmetros SLA e quatro buckets, régua de cinco faixas, etapas incluídas, painel lateral, módulos, intervalo, aviso ao vivo | **Gestão Comercial > Configurações** ou ajustes comerciais do BI, em seções próprias. Modelo parcial existe; UI de buckets, coluna fixa e aviso falta. Fonte: `config-pages.tsx:64–806`. |
| **BI móvel** | Cinco abas de análise; cards de maturidade, pipeline, metas, TMA/SLA e perdas, com filtros e toques para detalhes | Reusar contratos da versão desktop e compor telas móveis próprias; não criar cálculos divergentes. Fonte: `BITVMobile.tsx:860–1880`. Previsão/pontuação permanece acessível ao gestor em interface responsiva, mesmo que não seja uma das cinco abas legadas. |

## 4. Contratos de dados necessários no Chat

1. **Dimensões únicas:** `tenantId`, `operatorId`, `division`, `pipelineId`, `stageId`, data/mês de São Paulo. Todos os agregados e detalhes aplicam os mesmos filtros; a TV e o móvel consomem os mesmos serviços.
2. **Pipeline:** `count`, `value`, participação por etapa/consultor/equipe, total ativo e lista paginada dos IDs de negócios. Requalificação/exclusões são configuração de IDs, não busca pelo nome.
3. **Maturidade e previsão:** por consultor e faixa: quantidade, valor, dias faltantes, meta, conversão, promessa, cobertura e negócios sem valor/fora de maturidade. O detalhe deve ter paginação/busca no servidor e retornar status da última diretriz e da diretriz de hoje.
4. **Pontuação:** selecionar IDs elegíveis no modal de previsão; validar autoria e dono no servidor, registrar data comercial, snapshot de título/valor/etapa/idade/faixa, nota no CRM local, resultado por ID e trilha auditável. O lote precisa ser idempotente por tenant + negócio + data. PDF usa o resultado persistido, para retratar exatamente o que foi atribuído.
5. **Execução:** resumo por status e consultor, fila atrasada, detalhe das diretrizes e evidências; a próxima ação deve ser criada/atualizada junto à conclusão, sem exigir preparação manual prévia no CRM.
6. **Metas/calendário:** negócios ganhos com `closedAt` real no fuso comercial, alvo mensal, dias úteis e ajustes, ritmo diário/semanal, ganhos por data e séries acumuladas da Curva S. **Faturado** mantém o rótulo escolhido pelo usuário e significa soma dos negócios ganhos nesta fase.
7. **Perdas:** mês atual/anterior/histórico, categoria, submotivo, valor e contagem. A taxonomia vem do CRM local e o histórico somente dos dados novos disponíveis no Chat.
8. **TMA:** evento individual de transferência → primeira resposta do consultor; bucket configurável calculado por duração real, fila pendente calculada pelo relógio atual, ranking ponderado por evento e lista de conversas reais. Nunca preencher visual vazio com exemplos.
9. **Safras:** agrupar negócios pelo mês de criação, inclusive sem valor, e classificar pelas regras vigentes. Se a régua mudar, definir se o gráfico reclassifica o passado com a regra atual ou usa versão histórica da regra; documentar a escolha antes da implementação.

## 5. Ordem de construção para evitar telas desconectadas

1. **Contratos e reconciliação:** fixar filtros, definições e consultas detalhadas por dimensão; validar números contra o CRM local em banco de teste. Priorizar IDs e isolamento de tenant.
2. **Ciclo de responsabilidade:** modal de previsão → seleção → pontuação → nota/snapshot → painel de execução → evidência → próxima ação. Essa é a principal rotina do gestor e consultor.
3. **Análises por negócio:** matriz de pipeline, maturidade e previsão completas, com detalhamento real e navegação ao CRM.
4. **Análises de desempenho:** metas diária/semanal e Curva S; perdas em três períodos; TMA por evento e ranking.
5. **Safras, TV e móvel:** gráfico de seis meses, coluna fixa, rotação, avisos, tela cheia e adaptação móvel, todos sobre os contratos já reconciliados.

**Critério de aceite por visão:** para cada total ou gráfico, o gestor deve conseguir chegar aos registros de origem, aplicar o mesmo filtro e obter a mesma soma/contagem; nenhum agregado exibe sucesso quando a fonte falha. Pontuação repetida no mesmo dia não duplica diretriz nem nota. Consultor só acessa os próprios dados; gestão só acessa o tenant da sessão. Valem deve permanecer funcional durante o porte.

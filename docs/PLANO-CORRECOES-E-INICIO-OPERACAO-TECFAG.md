# Plano de correções e início da operação Tecfag

Atualizado em 27/10/2026. Base: auditorias de completude e go-live de 27/10/2026; revalidar cada achado contra o código atual antes de editar, pois há trabalho concorrente na árvore local.

## Escopo acordado

Nesta fase ficam de fora **Voice Score, Supervisor (aba e motor), Vendedor, Ligações e Voz**. Nenhuma ativação/configuração desses recursos faz parte desta entrega. Permanecem no escopo Chat, Fagner interno, SDR industrial, Rodízio, Fluxos, KB, CRM, Carteira, Contatos, Tarefas, Monitor operacional (Ao Vivo, alertas de SLA, ranking, QA e Visitantes), Estatísticas, Relatórios, Custos e configurações relacionadas.

O motor Supervisor continua fora mesmo quando uma correção ocorrer em outra aba de arquivo compartilhado. QA da Tecfag mantém o bloqueio de implantação até sua própria homologação; a tela deve informar o estado, sem nota fabricada. Não ativar IA ou dados reais para preencher painéis. Canal vem da configuração; tenant da sessão; Vertex é a central de IA; Valem deve continuar operando.

## Estratégia de entrega

**Marco A: habilitar piloto operacional após os bloqueadores. Marco B: completar a gestão e relatórios com a operação já produzindo dados reais.** O piloto não depende de terminar BI, PDF ou QA; depende de comunicação confiável, acesso correto e identificação honesta do que ainda não tem cobertura. Teste passando localmente não é autorização automática de produção.

Trabalhar em lotes pequenos revisáveis; sem reescrita de histórico Git, deploy automático ou migração destrutiva. Preservar alterações locais existentes e revalidar arquivos tocados por outro trabalho. Testes com banco/transportes isolados; homologação de canal no ambiente designado, sem mensagens ou seeds no tenant de produção como efeito de teste.

## Ordem de execução

| Lote | Entrega | Resultado verificável | Relação com auditoria |
|---|---|---|---|
| 1 — Segurança e operação básica | Autorização e contexto do assistente, respostas rápidas desktop/mobile, CNPJ/conta, conclusão de tarefas com rollback; corrigir SQL de desempenho | Operador só consulta o que pode ler; seleção/CRUD e cadastro funcionam; erro HTTP não vira sucesso; endpoint não mascara SQL quebrado | R01, R15, R16, R18, parte R21; go-live C06/M01/M02/M03 |
| 2 — Comunicação e recuperação, bloqueador do piloto | Workers de recuperação no runtime; reconexão com lease; mídia por conteúdo/identidade; envio bot e site duráveis; outbox/ACK do widget; prontidão de schema/canal | Sem perda silenciosa; sem anexo trocado; sem duplicação após retry; estado do envio verificável; reinício recupera trabalho pendente | go-live C01–C05, C07–C08 e fragilidades médias aplicáveis; não inclui módulos adiados |
| 3 — Métricas verdadeiras e Monitor | SLA Meta/Baileys/site; TMA no handoff industrial/rodízio; filtros de data/última mensagem; tarefas CRM no monitor; carteira por contatos; ranking e overview sem mocks; isolamento/cache | Cada número possui amostra/definição; vazio, desativado e indisponível são distintos; mesmos fatos conciliados entre telas | R02–R03, R10–R13, R17, R22–R23; D01–D07, D10–D11, D16–D18; E01–E02, E05, E07, E09–E10; alertas operacionais de E06 sem alterar Supervisor |
| 4 — Relatórios, custos e gestão | IDs únicos; período persistido/re-síntese correta; distribuição real por canal; estados por destinatário; cruzamento CRM↔Chat; exportação/agendamento; custo SQL completo e premissas explícitas | Dois tenants geram mesmo período; falha não marca enviado; valor/conversão explicados por negócios; totais sem teto de 500 | R05–R09; D08–D09, D12–D13 (somente caminhos no escopo), D17–D18; E03–E04, E08 |
| 5 — Profundidade e fechamento | QA industrial independente após homologação; KB com fontes/versões; contexto Fagner completo; filtros/calendário comuns; design system e diagnósticos; ajustes comerciais | Escopo restante da auditoria entregue com evidências; nenhuma função exposta como pronta sem estar implementada | R04, restante R21; E07–E12 exceto módulos adiados; demais fragilidades de go-live aplicáveis |

Não abrir módulos novos. Quando um achado envolve dois lotes, primeiro restaurar o fluxo mínimo e depois acrescentar a profundidade; a correção parcial não encerra o achado inteiro.

## Marco A — Critérios para iniciar o piloto da Tecfag

Todos precisam ter evidência na release e no ambiente de destino:

- [ ] Lotes 1 e 2 concluídos para a modalidade habilitada; revisão dos riscos de acesso e comunicação sem pendências críticas. Piloto exclusivamente humano pode manter automações/SDR/site desligados e usar a homologação específica descrita ao final; isso não encerra os achados dos recursos desligados.
- [ ] Schema/migrações e configuração de canal oficial/conexões conferidos; `connected` não basta sem dependências exigidas.
- [ ] Operador autorizado recebe cliente novo, responde texto/anexo correto, cria/vincula negócio, registra tarefa, transfere e encerra/reabre.
- [ ] Agente sem acesso não lê conversa, anexo, contexto IA ou negócio alheio; tenant do cliente não amplia autoridade.
- [ ] Grupos reais e negação para agente sem grupo conferidos no ambiente Tecfag (`ACCESS_CONTROL_STRICT_TENANTS`); o fallback legado apontado em C06 não foi alterado por este lote. Manter rollout Valem independente.
- [ ] SDR industrial desativado não responde. Quando homologado/ativado explicitamente: triagem→revisão quando necessária→atribuição/CRM→primeira resposta humana, sem prometer transferência antes do commit.
- [ ] Simulações isoladas de rede, perda de ACK, banco temporariamente indisponível e reinício comprovam recuperação sem sucesso falso ou duplicação evitável.
- [ ] Worker tem inicialização/encerramento observáveis e saúde separada da aplicação HTTP.
- [ ] Telas gerenciais sem cobertura indicam indisponibilidade/amostra ausente; dados mockados não servem para acompanhar o piloto.
- [ ] Regressão Valem passa e plano de retorno da release está definido, preservando compatibilidade do schema.
- [ ] Homologação operacional do canal e da release registrada antes da liberação efetiva.

Piloto sugerido: equipe reduzida e conexões já homologadas; ampliar somente após conferir atendimento real, entregas, pendências e erros. Não fixar datas antes da conclusão dos bloqueadores. Os lotes 3–5 seguem sem esperar completar histórico, que passará a ser gerado pela operação.

**Regra da interface do piloto:** antes do Marco A, retirar/sinalizar os indicadores fictícios ou restringir pelas permissões existentes as abas ainda não homologadas. O perfil piloto pode usar Chat, CRM, Contatos, Tarefas e os fluxos SDR explicitamente homologados, sem depender de ranking/QA/BI incompletos. Não habilitar distribuição automática de relatórios enquanto o lote 4 não comprovar envio real. Voice Score, Supervisor, Vendedor e Ligações/Voz permanecem fora da homologação e não são exigências do piloto. Essa configuração será conferida na homologação, não alterada em produção por este plano.

## Marco B — Conclusão do escopo

- [ ] Estatísticas, monitor, CRM e exportações conciliados para os mesmos períodos e permissões.
- [ ] Zero real, ausência de amostra, recurso desativado e falha técnica distintos; nenhum fallback fictício.
- [ ] Custos completos sobre o conjunto filtrado; estimativas rotuladas; uso atribuído ao tenant/feature corretos.
- [ ] Relatórios cruzam atendimento e resultado comercial, preservam janela/snapshot e comprovam distribuição.
- [ ] QA parametrizado pela Tecfag e habilitado somente após validação; Supervisor permanece adiado.
- [ ] Carteira e tarefas completas/paginadas, fontes da KB verificáveis e contexto Fagner coerente com schema.
- [ ] Regressões de acesso/triagem/conexões e verificações dirigidas aprovadas; erros TypeScript do escopo resolvidos.

## Acompanhamento desta execução

- [x] Escopo e sequência registrados; módulos adiados separados.
- [x] Lote 1: correções locais implementadas e testes dirigidos aprovados; nenhum diagnóstico TypeScript nos dez arquivos operacionais alterados.
- [x] Lote 2, primeira parte: recuperação industrial registrada, retomada de posse das conexões pessoais, confirmação/reenvio do widget, históricos atômicos do envio humano ao site e probe estrutural ampliado; validações locais aprovadas.
- [x] Lote 2, segunda parte: fila durável para textos/fotos do SDR industrial, confirmações e follow-ups; validação do contexto ao retomar e tratamento de resultado desconhecido. Correção local do C04 para texto/imagem implementada; homologação de canal continua pendente.
- [ ] Lote 2 pronto para homologação.
- [ ] Marco A liberado — **ainda não homologado**.
- [ ] Lotes 3–5 concluídos.

Achados que permanecem adiados: R14/R19/R20; D14/D15; partes de E06/E12 e D13 pertencentes exclusivamente ao Supervisor/voz. Falhas de UI compartilhada serão corrigidas somente nos fluxos incluídos. Não remover ou ativar funcionalidades adiadas sem pedido posterior.

## Entrega inicial implementada

1. **Respostas rápidas:** contrato dos callbacks e filtro corrigido no desktop/mobile; variáveis recebem nome do operador e cliente.
2. **CNPJ/conta:** usa `valid/details`, preenche ficha, preserva telefone já digitado, usa endereço do DTO correto e mantém QSA/atividades no formato textual esperado.
3. **Tarefas:** HTTP 403/404/500 reverte alteração otimista e informa erro; `completed` também pode ser reaberto, nas telas operacional e Monitor.
4. **Assistente:** exige permissão funcional e acesso ao atendimento antes de consultar contexto/Vertex; tenant e identidade vêm da sessão. O carregador reaplica visibilidade e limita negócios por responsável/funil/permissões CRM.
5. **Contexto do Fagner:** campos de triagem/produtos/campos personalizados alinhados ao schema; transcript e contexto CRM exercitados com PostgreSQL embarcado.
6. **Desempenho por setor:** agregação SQL corrigida, ausência de amostra representada por null, setores fictícios removidos, indisponibilidade devolve 503 com erro visível.
7. **Anexos WhatsApp (antecipação do lote 2/C07):** upload recebe UUID próprio; nome+tamanho não selecionam mais mídia de outra conversa. Reuso explícito continua sujeito à autorização; retry de mensagem já persistida não reenvia nem recria anexo.

Testes reproduzíveis: `npm run test:tecfag-foundation`. Cobre query real por setor, isolamento de tenant/conversa/CRM, bloqueio do assistente antes de IA, callbacks de respostas rápidas, rollback de tarefas, consulta CNPJ e anexo com nome/tamanho iguais mas bytes diferentes. Banco embarcado/transportes isolados, sem acesso operacional.

Validações: `npm run test:tecfag-foundation` (25 passaram), `npm run test:access` (188 passaram), `npm run test:triage` (341 passaram) e seleção de entrega/conexões (77 passaram; inclui cenários também presentes na suíte de acesso, não somar como testes únicos). A checagem `tsc --noEmit --pretty false` terminou com saída 2 e **104 diagnósticos globais**, sem diagnóstico nos dez arquivos operacionais alterados nesta entrega. O projeto ainda não tem checagem TypeScript global aprovada; há trabalho concorrente e os demais erros não foram tratados como resolvidos por este lote. Logs em `.codex-audit/functional-completeness-2026-10-27/`.

**Sequência da entrega inicial:** recuperação e durabilidade, detalhadas abaixo. O ajuste de anexos não encerra o lote 2. Nenhum deploy, migração, ativação de SDR/QA ou envio real foi executado por esta entrega. Marco A continua não homologado.

## Lote 2 — Primeira parte implementada em 27/10/2026

| Achado | Correção local | Estado e limite |
|---|---|---|
| C01 — recuperação fora do runtime | Plugin industrial incluído na lista explícita do Nitro; ciclos sem sobreposição na execução periódica, registro compartilhado entre chunks, encerramento e timestamps de execução/falha. Inclui handoff, efeitos pendentes, turnos interrompidos e silêncio industrial. | Implementação e ciclo do plugin testados isoladamente. Só processa persona industrial com SDR já habilitado no banco. Não registra o plugin legado de follow-up nem ativa SDR. Ainda falta comprovar o boot/restart da release real e expor saúde administrativa dos workers; timestamp do ciclo não comprova entrega ao cliente. |
| C02 — perda de posse da conexão pessoal sem retomada | Falha de renovação fecha socket, libera lease e agenda retomada com backoff, consultando configuração por tenant/ID e readquirindo posse antes do socket. Pausa manual, desconexão e shutdown cancelam a tentativa. | Testes de falha temporária, posse ocupada, configuração desativada/Meta/sem credencial e cancelamento aprovados. Este novo ciclo não se aplica à conexão oficial existente. |
| C03 — widget sem outbox/ACK | Intenção persistida em armazenamento local por origem/backend/tenant/visitante, uma chave por mensagem para preservar envios de abas diferentes. ID estável, confirmação somente pelo ACK do servidor, retry na reconexão, expiração em 24h com tentativa explícita e estado visível no balão. | Offline, perda de ACK, remontagem do componente, recarga/reabertura e duas instâncias de fila testados. Falha de armazenamento impede transmissão e mostra tentativa falha. **Upload anterior à formação da mensagem ainda precisa de recuperação própria do arquivo**; não declarar esse trecho durável. |
| C05 — envio humano ao site sem histórico do visitante | `messages` e `lc_messages` gravados na mesma transação; posse e visitante revalidados por tenant. Retry repara linha legada incompleta, usa conteúdo/IDs originais e não sobrescreve preview recente. Rota não devolve sucesso antecipado para esse retry. | Falha em cada gravação reverte tudo; repetição não cria novo par. Publicação no socket ocorre após commit e notificação SSE não desfaz sucesso persistido. `delivered` do site continua significando publicação no socket, **sem confirmação de leitura pelo visitante**. Respostas bot do site pertencem ao C04. |
| C08 — probe aceita schema insuficiente | Probe exige colunas de conexões, identidade por canal, contexto comercial, acesso e site, além dos campos de entrega. Confere índices únicos válidos, tabela/colunas e predicado de idempotência. | PostgreSQL embarcado aceita estrutura mínima e rejeita coluna ausente ou índice de definição incorreta. Não certifica credenciais, webhook, saúde do canal ou migrações do ambiente de destino. Conferir schema antes de publicar a release compartilhada com Valem. |

A varredura de turnos interrompidos também passou a enumerar empresas e consultar `agentConfigs` com filtro explícito de tenant; o novo follow-up industrial segue o mesmo padrão. A execução e os testes não alteram dados/configurações reais.

Validações reproduzíveis desta etapa:

- `npm run test:tecfag-recovery`: **27 passaram**. Banco PostgreSQL embarcado, transportes isolados, métodos reais de conexão e componente real do widget com hooks/socket controlados. Sem chamada a WhatsApp, Vertex ou banco operacional.
- `npm run test:tecfag-foundation`: **25 passaram**; `npm run test:access`: **188 passaram**; `npm run test:triage`: **341 passaram**; `npm run test:whatsapp-connections`: **28 passaram**.
- Widget: checagem TypeScript dedicada sem diagnósticos e build Vite aprovado. Artefatos gerados somente em `.codex-audit/functional-completeness-2026-10-27/widget-recovery-build/`; bundles publicados em `public/` não foram substituídos.
- A checagem TypeScript global continua reprovada; há **102 diagnósticos** nesta revisão, incluindo a nulabilidade preexistente na geração de texto do follow-up legado. Não há diagnóstico nas linhas novas desta etapa. O erro legado não foi corrigido como efeito da ativação do worker industrial.
- Evidências: `.codex-audit/functional-completeness-2026-10-27/*-recovery.txt` e `recovery-tests.txt`. Estes testes não equivalem a um restart real do Nitro, homologação de canal ou validação no Railway.

## Lote 2 — Segunda parte: respostas automáticas duráveis

Implementação do C04 no perfil industrial, usando as tabelas existentes. A fila não habilita SDR e não altera o caminho legado da Valem. Áudio, voz e os demais módulos adiados permanecem fora desta correção.

1. **Turno persistido antes do envio:** saudação, resposta e fotos são reunidas na engine; todos os fragmentos, envelopes, contexto, ordem e bytes das imagens entram numa transação antes do primeiro despacho. IDs determinísticos por tenant/conversa/ciclo/mensagem de origem e grupo. Retry/reclassificação reutiliza o grupo original, sem substituir texto confirmado ou acrescentar fragmentos a um lote parcialmente enviado.
2. **Recuperação com contexto:** revalida SDR habilitado, tenant, contato/destinatário, identidade Meta, responsável, fila, ciclo, desfecho, última mensagem do cliente, resposta humana, canal e janela Meta. Resposta anterior falha/desconhecida bloqueia continuação do mesmo turno. Recuperação fora do expediente configurado fica pendente; intenção vencida ou contexto alterado fica falha com motivo.
3. **Resultado desconhecido preservado:** aceitação externa seguida de queda da conexão, falha de gravação do resultado ou lease abandonada não produz reenvio cego. O registro permanece `unknown`, com identidade original e necessidade de revisão. A correção não promete entrega exatamente uma vez pelo provedor.
4. **Site e fotos:** registro canônico e histórico do widget confirmados na mesma transação antes de publicar nos dois protocolos de socket. Visitante offline encontra a resposta no histórico ao reconectar. Falha no segundo histórico conserva a intenção pendente; o worker retoma sem criar outro ID. Aceitação no histórico não significa leitura pelo visitante.
5. **Engine, transferência e silêncio:** confirmação pós-commit e follow-ups passam pela fila. Silêncio e recuperação de turnos aguardam entregas pendentes/desconhecidas/falhas do ciclo; histórico do SDR não apresenta intenção de bot não confirmada como resposta entregue. A engine interrompe a continuação quando um despacho requer recuperação/revisão. Falha de SSE não altera um resultado já confirmado no banco.

Validações: `npm run test:industrial-outbound` cobre persistência/rollback, reinício antes e entre fragmentos, turno misto com imagem, repetição concorrente, perda da confirmação, falha de banco após aceitação, contexto alterado e isolamento, interrupção, socket offline e integração dos métodos reais da engine/silêncio. Usa PostgreSQL embarcado e transportes controlados, sem credenciais ou chamadas externas. As regressões legadas do despachante continuam separadas e foi acrescentado teste de delegação industrial; não foram substituídas por testes de mocks da fila.

Resultados registrados: **34 testes de durabilidade**, **342 de triagem**, **27 de recuperação**, **188 de acesso** e **53 na seleção fundação/conexões** aprovados. A validação de empacotamento do plugin de recuperação e suas dependências com esbuild também passou, com saída apenas na pasta de evidências; o bundle não foi executado. A última checagem TypeScript global registrou **148 diagnósticos na árvore compartilhada**, que também recebeu trabalho concorrente. O TypeScript global continua reprovado; estes resultados não representam homologação da release. Mensagens do mesmo lote com timestamp empatado e rollback de follow-up após interação concorrente também foram exercitados.

Evidências desta parte: `bot-durability-tests.txt`, `triage-bot-durability.txt`, `recovery-bot-regression.txt`, `access-bot-durability.txt`, `foundation-connections-bot.txt` e `typescript-bot-durability.txt` em `.codex-audit/functional-completeness-2026-10-27/`. A release real, as credenciais e o restart do servidor hospedado ainda exigem homologação. Nenhum deploy, ativação, migração ou envio operacional foi executado por esta etapa. Alterações concorrentes de onboarding/schema presentes na árvore não pertencem a esta entrega.

## Próxima execução e início da operação

1. **Homologar a correção C04:** código e cenários isolados de texto/imagem implementados. Comprovar na release de teste a retomada pelo worker após encerramento do processo e os estados reais retornados pelo canal. Voz não faz parte da cobertura. O lote 2 ainda depende das etapas seguintes.
2. **Completar recuperação de upload do widget e saúde operacional:** preservar arquivo ainda não enviado, tornar falhas das etapas de recuperação observáveis e comprovar boot/shutdown/restart da release.
3. **Homologar ambiente destinado à Tecfag:** schema/migrações compatíveis com Valem, configuração real do canal, webhook, grupos estritos, anexos e fluxo humano completo. Não preencher tenant com seeds nem habilitar SDR como teste.
4. **Início antecipado possível:** piloto humano de WhatsApp, CRM, Contatos, Tarefas e Fagner interno pode ter homologação própria, com SDR e automações do site desativados. Exige comprovar os itens de acesso, canal, schema e entrega humana do Marco A; não depende de aprovar respostas automáticas que permanecerão desligadas. O piloto com SDR/site exige também homologar a correção C04 nesses canais. **Nenhuma das duas modalidades está liberada por esta execução local.**
5. Depois da liberação correspondente, seguir lotes 3–5 com a operação gerando histórico real. Voice Score, Supervisor, Vendedor, Ligações e Voz continuam adiados.

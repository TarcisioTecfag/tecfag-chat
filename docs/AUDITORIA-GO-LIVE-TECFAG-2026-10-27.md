### 1. 🚨 BLOQUEADORES CRÍTICOS (Severidade Alta — Obrigatório corrigir ANTES do Go-Live)

**Parecer: NÃO APTO para a virada completa no escopo solicitado. Nota de prontidão: 6,2/10.** A arquitetura é compatível com uma operação pequena, mas há falhas de autorização, continuidade das mensagens e retomada dos números individuais que precisam ser corrigidas.

Auditoria realizada em **27/10/2026**, para **Tecfag/Fagner, até 20 operadores simultâneos**. Não se exigiu arquitetura para milhares de empresas. Foram inspecionados frontend, APIs, schema/migrações, recebimento/envio, SSE/WebSocket, Baileys, triagem, CRM, distribuição, tarefas e serviços de background.

**Limites da evidência:** as execuções foram locais. O banco operacional encontrado no `.env` é `valemchat`, em loopback; nele foram feitas somente consultas com `transaction_read_only=on`, sem importar o servidor. Os testes com escrita usaram outro cluster PostgreSQL 18, dedicado, em `127.0.0.1:55447/tecfag_audit_test`, com credenciais de teste. Não houve migration/seed no banco operacional, envio WhatsApp, chamada real de IA, alteração em provedores ou implantação. Railway, dispositivos físicos, áudio em quatro sistemas operacionais e ensaios reais de perda de energia não foram homologados. Portanto, isto não certifica atendimento ponta a ponta em produção.

**Rastreabilidade:** o checkout começou em `43e7923` e recebeu alterações concorrentes, chegando a `faf5cb2`, além de mudanças não commitadas em sete arquivos. Nenhuma dessas alterações operacionais foi feita por esta auditoria. Fontes para o TypeScript e um bundle para o ensaio HTTP foram congelados separadamente; hashes, revisão e arquivos modificados estão em `.codex-audit/2026-10-27/manifest.json`. Os números abaixo não constituem aprovação de uma release única e imutável.

| Verificação executada | Resultado | O que comprova |
|---|---|---|
| Build de produção no checkout | Passou | Geração do pacote, sem equivaler a typecheck ou homologação dos canais |
| Build da cópia fixada, com scripts e assets | **Passou** | Repetição em diretório isolado das edições concorrentes |
| TypeScript inicial | 118 diagnósticos | Estado durante alterações concorrentes |
| TypeScript da cópia fixada | **108 diagnósticos** | Falhas de contratos/tipos permanecem; algumas foram reproduzidas funcionalmente |
| `npm run test:access` | **188 passaram** | Contratos e cenários isolados de autorização |
| `npm run test:triage` | **341 passaram** | Políticas, classificação, encaminhamento e componentes com transportes isolados |
| `npm run test:whatsapp-connections` | **26 passaram** | Múltiplos números e isolamento com banco embarcado/mocks |
| Resiliência, fila otimista, cache/índices, recuperação de assets, identidade/templates/telefones | **37 passaram** | Sete arquivos selecionados; parte testa contratos e algoritmos, sem canal real |
| Integração industrial em PostgreSQL dedicado | **55 cenários passaram; suíte interrompida por uma falha** | Inclui concorrência na atribuição, rollback e isolamento; a suíte completa não passou |
| HTTP com 20 sessões administrativas + 20 SSE | **120 consultas retornaram 200**; SSE: **20/20 HTTP 200** | Carga curta de leitura local; não inclui tráfego real de WhatsApp/Vertex |
| Reproduções dirigidas | **4 falhas reproduzidas** | Autorização do assistente, seleção de mídia, confirmação do site e respostas rápidas |

Logs e scripts estão em `.codex-audit/2026-10-27/`. O banco de teste foi encerrado ao final.

**C01 — Recuperação industrial e follow-up não entram no runtime publicado**

- **Problema e impacto real:** existem checkpoints e outbox de handoff, mas o serviço que deveria retomá-los periodicamente não está registrado no bundle inspecionado. Uma triagem interrompida, um encaminhamento aguardando equipe ou um aviso pós-commit pode permanecer pendente. O motor de silêncio também não inicia pelo caminho configurado. Na conexão oficial Meta, não se pode depender do evento `connection.open` do Baileys para recuperar atendimento.
- **Onde:** `vite.config.ts:31`, `server/plugins/industrial-triage-recovery.ts:36`, `server/plugins/sdr-followup.ts:9`. A lista compilada em `bundle/index.mjs` contém somente `websocketPlugin`, `orphanCleanupPlugin` e `recoveryPlugin`. Além da ausência na lista, follow-up depende do hook `listen`, que não disparou no startup Nitro observado; o WebSocket iniciou pelo fallback de `request`.
- **Solução técnica recomendada:** registrar explicitamente os dois serviços; iniciar de forma idempotente no carregamento do plugin, com encerramento e heartbeat. Testar reinício enquanto há debounce, handoff preparado, ausência de equipe e aviso pendente. Manter a ativação por tenant/configuração, sem ligar funcionalidades na Valem por consequência.

**C02 — Falha temporária no banco pode deixar o WhatsApp individual parado**

- **Problema e impacto real:** o heartbeat de posse da conexão adicional pausa a sessão e encerra o lease quando a renovação falha. `pauseSession` retira o socket do mapa antes de fechá-lo; o listener de fechamento ignora sockets que já não são os atuais. Esse caminho não agenda uma nova inicialização. A sessão pode continuar desconectada depois de o PostgreSQL voltar, interrompendo recebimento e deixando saídas pendentes.
- **Onde:** `src/lib/baileys/session-manager.ts:423`, `:512`, `:798`; `bootAdditionalConnection`, `ensureConnectionOwnership` e `stopLease`.
- **Solução técnica recomendada:** separar pausa intencional, perda real de posse e indisponibilidade temporária. Agendar retomada com backoff/jitter enquanto a conexão estiver habilitada e houver credenciais; readquirir lease antes de abrir socket. Preservar o fencing para não disputar a sessão com outra instância. Validar queda do banco durante uma sessão já conectada.

**C03 — Widget pode perder o envio do visitante após uma oscilação**

- **Problema e impacto real:** o cliente acrescenta a bolha e tenta transmitir. Se o socket estiver fechado, existe uma tentativa atrasada; a reconexão posterior não reenvia uma intenção durável. Quando o socket aparenta estar aberto e cai durante o envio, não há confirmação confiável na UI. O servidor implementa `message_ack`, mas esse widget não o utiliza para concluir/repetir o envio.
- **Onde:** `tecfag-widget/src/components/ChatWidget/ChatWidget.tsx:639`, `:650`, `:659`; confirmação em `src/lib/livechat/livechatWs.ts:507`.
- **Solução técnica recomendada:** outbox local com ID estável, conteúdo/anexos e estados pendente/confirmado/falhou. Remover somente após ACK de persistência; reenviar o mesmo ID depois da reconexão. Testar offline antes do clique, queda logo após `send`, perda do ACK e fechamento/reabertura da página.

**C04 — Respostas automáticas do SDR não têm a durabilidade do envio humano**

- **Problema e impacto real:** os caminhos do SDR chamam o provedor antes de gravar a mensagem. Crash após aceitação externa e antes do registro deixa uma resposta sem histórico/correlação; uma recuperação pode repeti-la. Se o envio falha, fragmentos podem ser pulados sem existir uma intenção persistida para recuperação. Os locks da atribuição CRM não resolvem a entrega externa.
- **Onde:** `src/lib/valentina/sdr-engine.ts:2405`, `:2425`, `:2448`; `src/lib/valentina/sdr-channel-sender.ts:172`, `:191`, `:201`, inclusive caminhos de imagens.
- **Solução técnica recomendada:** persistir envelope e identidade do fragmento antes do despacho; usar fila durável também para bot, imagens e confirmações. Diferenciar pendente, confirmado, falho e desconhecido. Antes de retomar, revalidar proprietário, ciclo, canal, expediente e janela Meta. Não prometer entrega exatamente uma vez quando o provedor aceitou e a confirmação se perdeu.

**C05 — Envio ao site pode retornar sucesso sem entrar no histórico do visitante**

- **Problema e impacto real:** `sendSiteOperatorText` grava `messages.status='accepted'` antes de persistir em `lc_messages`. Se a segunda gravação falha ou ocorre crash nesse intervalo, repetir a chave encontra o primeiro registro e retorna sucesso sem concluir a entrega/histórico do widget. O recovery de WhatsApp não seleciona esse registro já aceito.
- **Onde:** `src/lib/livechat/site-delivery.ts:260`, `:279`, `:294`, `:305`; `src/lib/whatsapp/durable-recovery.ts:62`.
- **Reprodução:** falha injetada na gravação do histórico; primeira chamada falhou, repetição retornou `success=true`, status `accepted`, e o histórico continuou com apenas uma tentativa de gravação. Sem chamadas externas.
- **Solução técnica recomendada:** gravar os dois históricos atomicamente ou persistir uma entrega pendente recuperável e idempotente. Um retry deve completar etapas faltantes. Separar persistência no histórico, transmissão ao socket e confirmação pelo cliente.

**C06 — Assistente contorna autorização por atendimento; fallback de grupo exige fechamento**

- **Problema e impacto real:** `/api/valentina/assistant` exige sessão, mas não verifica permissão da IA nem acesso à conversa solicitada. O carregador consulta pelo tenant/ID, sem a política de visibilidade do operador. Assim, um agente pode consultar dados de contato de um atendimento alheio dentro da Tecfag. Isso **não é evidência de vazamento entre tenants**. Separadamente, agentes sem grupo recebem permissões administrativas no modo legado, se `ACCESS_CONTROL_STRICT_TENANTS` não estiver habilitado para sua empresa.
- **Onde:** `src/routes/api/valentina/assistant.ts:26`, `:133`, `:187`; `src/lib/valentina/assistant-engine.ts:111`; `src/lib/access-control/legacy-session-group.ts:11`, `rollout.ts:2`.
- **Reprodução:** handler real com principal sem permissão de chat/IA e sem ser dono do atendimento; contexto real consultado em banco de teste, Vertex substituído por transporte que ecoa o prompt. Retorno **HTTP 200 com contato alheio no prompt**. Nenhuma IA externa foi acionada.
- **Solução técnica recomendada:** validar permissão funcional e `requireConversationAccess`/acesso aos negócios antes de montar contexto. Adicionar filtro de tenant também ao join de contatos. Mapear os grupos reais e habilitar negação para agentes sem grupo na Tecfag, verificando o ambiente publicado. Não alterar o rollout da Valem incidentalmente.

**C07 — Deduplicação por nome e tamanho pode selecionar o anexo errado**

- **Problema e impacto real:** um upload novo reutiliza o primeiro `mediaFiles.id` do tenant com o mesmo nome e tamanho, sem comparar conteúdo nem limitar a conversa de origem. Dois PDFs diferentes podem colidir. Pode sair o arquivo anterior; se o cache local estiver ausente, bytes novos podem ser escritos sob o ID antigo, divergindo do base64 no banco e alterando a mídia vista em outro histórico.
- **Onde:** `src/routes/api/whatsapp/send.ts:220`, especialmente `:228` e `:234`; uso posterior do ID no cache de disco e nos adaptadores.
- **Reprodução:** buffers `AAAA` e `BBBB`, ambos com quatro bytes e nome `contrato.pdf`; o predicado real selecionou o arquivo da outra conversa.
- **Solução técnica recomendada:** ID próprio por upload ou deduplicação por hash criptográfico do conteúdo e metadados adequados. Separar blob compartilhado da autorização de cada vínculo e manter igualdade entre banco e cache. Testar nomes/tamanhos iguais com conteúdos e proprietários diferentes.

**C08 — Ambiente inspecionado não está preparado; readiness aceita schema insuficiente**

- **Problema e impacto real:** o banco local passa no probe atual, embora faltem tabelas/colunas usadas nas consultas normais: `whatsapp_connections`, `conversation_deal_contexts`, `contact_channel_identities`, permissões de grupos, `conversations.whatsapp_connection_id` e outras. Operações podem falhar com erro SQL mesmo com health verde. Na configuração local Tecfag, Meta aparece conectado sem `phone_number_id`, sem app secret e sem webhook observado; não existe configuração SDR habilitada. Isso impede certificar o ambiente encontrado e **não demonstra que o Railway tenha os mesmos problemas**.
- **Onde:** `src/lib/readiness.ts:11`; divergências em `.codex-audit/2026-10-27/schema.log`; configuração em `operational.log`; migrador `scripts/apply-platform-access-migration.mjs`.
- **Solução técnica recomendada:** validar migrações/constraints e configuração da release no ambiente de destino; readiness deve verificar versão estrutural mínima e dependências essenciais. Expor saúde dos canais e heartbeat dos workers separadamente. Habilitar SDR Tecfag somente depois da homologação autorizada; não ligar o recurso como efeito da auditoria.

### 2. ⚠️ PONTOS DE ATENÇÃO E CORRIGINDO FRAGILIDADES (Severidade Média — Risco em quedas de rede/energia ou picos de uso)

| Achado e efeito operacional | Evidência exata | Correção recomendada |
|---|---|---|
| **M01. Respostas rápidas quebradas no desktop e mobile.** O pai passa `onSelect`, mas o componente chama `onSelectResponse`; callbacks de criação/edição também divergem. Erro reproduzido: `TypeError: onSelectResponse is not a function`. | `src/components/chat/ChatPanel.tsx`, chamada de `QuickResponsesPopover`; `src/components/mobile/MobileMessageInput.tsx:265`; `src/components/chat/QuickResponsesPopover.tsx:28`, `:515`, `:568`. | Alinhar as props e testar selecionar/criar/editar/excluir nos dois layouts. Há contorno digitando manualmente; por isso não foi classificado como indisponibilidade total do chat. |
| **M02. Assistente perde histórico e contexto CRM silenciosamente.** Usa campos inexistentes: `extractedData`, `currentStage`, `updatedAt` do flow, `crmDealProducts.total` e `crmCustomFieldDefinitions.entity`. O catch devolve contexto parcial. | `src/lib/valentina/assistant-engine.ts:234`, `:244`, `:271`, `:305`, `:418`; reprodução com contato encontrado e transcript vazio apesar de mensagens no banco. | Usar `collectedData`, `currentStep`, `lastInteractionAt`, `totalPrice`, `entityType`; testar conteúdo realmente disponível no prompt. Falha de enriquecimento não deve ser apresentada como contexto completo. |
| **M03. Consulta de CNPJ da conta rejeita resposta válida.** A UI testa `info.found`, mas `fetchCnpjInfo` retorna `valid`, dados principais e `details`. | `src/components/crm/AccountDetailModal.tsx:175`; `src/lib/valentina/cnpj-service.ts:32`, `:108`. | Corrigir o contrato e o preenchimento de telefone/email/detalhes. Validar retorno conhecido por fixture; não chamar Receita real para testar. |
| **M04. Rascunhos ainda se perdem com F5/queda de energia.** O envio já clicado tem IndexedDB; texto/anexos ainda em composição ficam em `transientChatPanelCache`, um Map em memória. Edições não salvas de formulários CRM também não têm recuperação comprovada. | `src/components/chat/ChatPanel.tsx`, `transientChatPanelCache.set`; proteção dos envios em `src/lib/browser-outbox.ts`. | Persistir rascunhos por tenant/operador/conversa, com descarte e expiração. Incluir anexos e política para formulários; não disparar automaticamente conteúdo antigo ao restaurar. |
| **M05. Há chamadas sem prazo e sem limitação de concorrência.** Envios no hook podem manter a fila do painel esperando; melhor resposta/resumo chamam Vertex com `signal=undefined`. Não foi localizado semáforo central. Cache RAG de 60 s não agrega carregamentos simultâneos. | `src/hooks/useChatState.tsx`, `sendMessage`; `src/routes/api/valentina/assistant.ts:149`, `:201`; `src/lib/vertex-ai.ts:271`; `knowledge-service.ts:656`. | Definir deadlines e cancelamento propagado, mostrando resultado desconhecido quando necessário. Limitar IA/conversões por processo, agregar carregamento de cache por tenant e colocar teto em upload/payload. Não aumentar pool antes de medir. |
| **M06. Leituras amplas ficam lentas com 20 sessões.** O pool é `max:10` por cliente; o bundle contém dois módulos de DB, para runtime e SSR, portanto dez não é um teto global garantido. Cada evento SSE revalida sessão e acesso por destinatário. Mini chat consulta 100 mensagens a cada 4 s; `getDeals` admite limite até 100.000. | `src/db/index.ts:24`; bundle `_chunks/db.mjs` e `_ssr/db-*.mjs`; `src/routes/api/events.ts:43`, `:57`; `CrmChatWidget.tsx:1393`, `:1418`; `src/lib/crm/crm-service.ts:2547`. | Compartilhar/contabilizar pools; deadlines de SQL; limitar páginas; medir planos das consultas reais. Reduzir trabalho repetido por evento sem enfraquecer revogação. Manter polling como fallback e impedir chamadas sobrepostas. |
| **M07. Rodízio não garante operador online.** A seleção geral carrega só ID/nome dos operadores e usa participação/férias/penalização/funil; não usa presença atual. Pode atribuir lead a alguém offline. Carteira existente tem política específica de ausência, que deve ser preservada. | `src/lib/triage/industrial-handoff-store.ts:531`, `:541`; `src/lib/triage/industrial-policy.ts:475`. | Definir presença com TTL e critério para elegibilidade geral, espera por equipe e retomada. Uma queda do vendedor não deve redistribuir sua carteira silenciosamente. |
| **M08. Persistência Baileys tolera erro de credenciais sem retry durável.** `performSave` captura a falha e resolve; pode parecer que chaves foram salvas. Cada reconexão cria novo NodeCache sem fechar o anterior. Promises de `initSession` em timers não são tratadas no ponto de chamada. | `src/lib/baileys/drizzle-auth.ts:67`, `:83`, `:149`; `session-manager.ts:478`, `:625`, `:632`. | Manter estado sujo até confirmação no banco, retentar e sinalizar degradação; fechar caches/timers ao substituir sessão; tratar rejeições e retomar inicialização. Nitro captura rejeições globais, portanto não foi afirmado que toda rejeição derruba o processo. |
| **M09. Multimídia do atendimento humano no site está incompleta.** A rota retorna `SITE_TEXT_ONLY` para anexos/template. O caminho WhatsApp tem gravação com MIME negociado e conversão OGG/Opus, mas reprodução em Windows/Mac/iOS/Android não foi testada fisicamente. | `src/routes/api/whatsapp/send.ts:201`; `src/components/chat/ChatPanel.tsx`, gravação de áudio; `src/components/mobile/MobileMessageInput.tsx:172`; `src/lib/whatsapp/audio-convert.ts`. | Completar entrega de mídia no site ou definir explicitamente um escopo inicial somente texto. Homologar áudios e anexos nos dispositivos alvo, incluindo conversão que falha e mídia recebida depois de reinício. |
| **M10. Voz automática ainda usa outro provedor.** É uma divergência explícita da regra de IA exclusiva pelo Vertex, embora o fluxo principal de texto use o serviço central. | `src/lib/valentina/sdr-engine.ts:77`, `:2039`, `:2091`; `src/lib/voice/elevenlabs-dynamic-tts.ts:82`. | Migrar o caminho de IA de áudio para a integração central autorizada ou mantê-lo desabilitado na implantação Tecfag. Planejar separadamente qualquer alteração que possa afetar a Valem. Não considerar a simples troca de nome/feature como resolução. |
| **M11. Recuperação de desastre ainda exige prova operacional.** Existe `scripts/backup-database.mjs`; não foi validado backup/restore da instância de produção, retenção externa nem recuperação da chave de criptografia dos números individuais. | Script de backup; `src/lib/whatsapp/connection-crypto.ts:4`; `railway.json`. | Definir RPO/RTO aceitáveis, comprovar restore em banco separado e restaurar também os segredos necessários às sessões. Monitorar fila, idade da pendência, erros e heartbeat fora da própria aplicação. Não confundir existência de script com backup operacional comprovado. |

A falha da suíte PostgreSQL ocorreu em `test/industrial-handoff-postgres.test.ts:2671`, com `Missing expected rejection`: o teste injeta erro na atividade de revisão, mas não seleciona o contexto de negociação exigido pelo caminho atual. `industrial-triage-journal-store.ts:128` só grava essa atividade para o negócio que também é o contexto atual. **O resultado exige corrigir/alinhavar fixture e contrato e repetir a suíte; não comprova, sozinho, que o rollback de revisão esteja quebrado.** Os cenários restantes não executaram.

### 3. 🔧 MELHORIAS RECOMENDADAS (Severidade Baixa — Refinamento de UX, performance e manutenção)

- **Gate de release com contratos reais.** `package.json` usa Vite no build, sem typecheck obrigatório. Acrescentar verificação dos tipos e testes de interação dos componentes, em vez de depender apenas de inspeção textual ou simulações que copiam algoritmos. Separar testes de banco dos testes puros e alinhar arquivos que importam `vitest` sem essa dependência instalada.
- **Observabilidade enxuta por tenant/conversa/mensagem.** Mostrar idade da fila, status desconhecido, tentativas, último erro, canal e worker responsável. Há boa base em `messages`, `pending_inbounds`, leases e outbox industrial; faltam evidências de um painel/alerta operacional cobrindo todos os caminhos identificados. Evitar logs de conteúdo de clientes onde basta uma identidade técnica.
- **Design system no widget.** Substituir o `alert` de upload em `tecfag-widget/src/components/ChatWidget/ChatWidget.tsx:632` por feedback do sistema, preservando texto/anexo para nova tentativa.
- **Configuração e documentos de implantação.** Atualizar a matriz de recursos de `AGENTS.md` quando a habilitação de SDR Tecfag for autorizada: o documento ainda descreve apenas chat interno, enquanto o código já suporta triagem industrial. Documentar flags, migrações e rollback por tenant, preservando o serviço da Valem.

**Proteções existentes que foram consideradas nas notas:**

- O envio humano usa intenção no IndexedDB, chave estável, envelope de mídia/template no servidor, reserva com lease e estado `unknown`, com recuperação/revisão. Os problemas de outbox antiga em memória não foram repetidos como se continuassem iguais.
- Entrada Meta valida HMAC, percorre o lote e persiste mensagens com lock/transação e identidade determinística; status órfãos são retidos. Baileys já trata `append`, histórico e mensagens do aparelho vinculado. Reconexão não foi tratada como sinônimo de recuperação integral dos efeitos de IA.
- Captura manual exige `expectedVersion` e transação em `src/routes/api/chats/update-queue.ts`. O handoff industrial e rodízio usam locks de banco, verificação de ciclo, CRM/atribuição transacionais e outbox pós-commit. Não há fundamento para afirmar dupla captura inevitável ou ausência geral de transações.
- SSE tem reconexão com backoff, encerramento de listeners e consulta de reconciliação. Existe proteção contra stale chunk em `src/lib/asset-recovery.ts`. A reconciliação de 150 conversas é limitada e não equivale a replay completo de todos os eventos.
- Existem índices por tenant/conversa e consultas em lote/LATERAL nas listagens de chat. O RAG possui cache por tenant e evita carregar o base64 inteiro das fotos nessa consulta. Os assets inspecionados contêm **1.037 máquinas e 210 manuais**, estes com aproximadamente **5,65 milhões de caracteres extraídos**; isso comprova presença do material, não precisão de todas as respostas da IA.
- A configuração Railway atual chama `npm run start`; o migrador é versionado e tem lock de startup. A antiga configuração de reset/seed no boot não foi apresentada como defeito atual.

### 4. 📊 MATRIZ DE PONTUAÇÃO DE PRONTIDÃO (0 a 10)

| Pilar Avaliado | Peso | Nota (0 a 10) | Justificativa Técnica Resumida |
| :--- | :---: | :---: | :--- |
| **1. Estabilidade & Resiliência (Quedas de Energia/Internet)** | 35% | **5,8** | Boa recuperação do envio humano e persistência de entrada, mas widget, saídas automáticas, entrega ao site e retomada dos números individuais têm lacunas; workers industriais não iniciam pelo bundle inspecionado. |
| **2. Funcionalidades Operacionais (Chat, Fagner IA, CRM, RBAC)** | 40% | **6,0** | Fluxos e transações substanciais, com testes úteis, mas autorização do assistente, seleção de anexos, contexto da IA, respostas rápidas e CNPJ apresentam falhas. Ambiente de destino ainda não homologado. |
| **3. Escalabilidade Operacional (20 Usuários Simultâneos `tecfag`)** | 25% | **7,0** | Leitura com 20 sessões/SSE concluiu sem erro HTTP; índices e paginação existem. Latência ampla ainda alta; CPU/RAM com 10–20 Baileys e IA concorrente não foram medidos. |
| **NOTA FINAL PONDERADA** | **100%** | **6,2 / 10** | **NÃO APTO PARA OPERAÇÃO completa no escopo solicitado.** |

Cálculo: `5,8 × 0,35 + 6,0 × 0,40 + 7,0 × 0,25 = 6,18`, arredondado para **6,2**. As notas são julgamento de engenharia apoiado nas evidências, não uma probabilidade estatística de disponibilidade.

O ensaio HTTP usou bundle de produção, PostgreSQL dedicado, **20 sessões administrativas de visibilidade ampla**, 20 streams SSE abertos, 200 conversas, 10.000 mensagens e 30.000 negócios sintéticos. Foram três rodadas concorrentes; cada sessão consultou chat e CRM sequencialmente. A consulta sem sessão retornou 401.

| Rota | Requisições | HTTP 200 | p50 | p95 | Máximo | Payload médio |
|---|---:|---:|---:|---:|---:|---:|
| `/api/chats?limit=150` | 60 | 60 | 2,87 s | **5,78 s** | 6,20 s | 147 kB |
| `/api/crm/deals?pipelineId=…&limit=50&previewOnly=true` | 60 | 60 | 2,21 s | **5,06 s** | 5,59 s | 33 kB |

São resultados curtos, neste computador, em rede local; o schema da fixture deriva do Drizzle e índices, sem todas as migrations/triggers de produção. As 20 sessões têm escopo mais amplo que vendedores restritos. Não foram simulados 2 Mbps/4G, webhooks externos simultâneos, gerações Vertex ou 20 sockets Baileys. Logo, os resultados mostram atendimento das consultas medidas, **não folga comprovada da operação completa**. O pool de dez conexões por cliente não é, por si, um defeito para vinte usuários: conexões são reutilizadas. É preciso medir espera do pool, planos, latência e recursos na infraestrutura final.

### 5. 🏁 VEREDITO FINAL DE GO-LIVE E PLANO DE AÇÃO IMEDIATO

🔴 **NÃO APTO PARA OPERAÇÃO — 6,2/10.** Não recomendar a virada completa da Tecfag com SDR, Meta, números individuais e site no estado inspecionado. Não é necessário reescrever a plataforma para vinte operadores; é necessário fechar os caminhos que podem perder mensagens, confirmar entrega inexistente, expor dados a operador sem acesso ou deixar números desconectados.

Checklist ordenado para buscar **9,5+**, condicionado a comprovação por testes e operação assistida:

1. [ ] **Fixar uma release de homologação**, com fontes, bundle, migrações e configurações da mesma revisão. Validar schema e Meta no ambiente alvo; restaurar backup em ambiente separado antes de qualquer mudança estrutural compartilhada. Preservar Valem e seus canais.
2. [ ] **Fechar autorização do assistente e fallback de grupos.** Testar vendedor sem grupo, vendedor de outra carteira, gestor, admin e tenant estrangeiro; nenhum contexto deve ser montado antes da autorização.
3. [ ] **Corrigir identidade dos anexos**, com hash/ID e autorização do vínculo; comprovar consistência do conteúdo após reinício e colisões de nome/tamanho.
4. [ ] **Registrar e monitorar os serviços industriais** de recovery/follow-up. Testar interrupção em cada etapa do handoff e retomada sem repetir card, atribuição ou aviso.
5. [ ] **Unificar a durabilidade das saídas** de humano, SDR, foto e site. Testar crash antes/depois da aceitação externa e antes/depois de cada gravação; incerteza deve aparecer para revisão, sem reenvio cego.
6. [ ] **Completar outbox/ACK do widget e recuperação de rascunhos**, com perdas de rede, perda de ACK, reload e alteração de dono/canal durante a pendência.
7. [ ] **Recuperar automaticamente as sessões individuais após falha do banco/rede**, com lease, credenciais e timers corretos. Parear números de homologação e testar logout intencional, substituição, crash e retorno sem QR quando aplicável.
8. [ ] **Corrigir contratos funcionais e de IA:** respostas rápidas desktop/mobile, CNPJ, contexto CRM/SDR do assistente, deadlines, cancelamento e uso exclusivo do Vertex nos caminhos de IA autorizados. Completar ou delimitar multimídia do site.
9. [ ] **Repetir a suíte PostgreSQL completa e ensaio misto de 20 operadores** na infraestrutura equivalente à final: vendedores restritos + gestores, tráfego Meta, números Baileys e 5–10 pedidos simultâneos de IA. Registrar p95/p99, erros, espera do banco, event-loop lag, CPU/RSS, crescimento de timers e idade das filas. Como meta inicial acordada de UX, buscar p95 de leituras abaixo de 1 s e feedback imediato de envio, sem converter essa meta em garantia sem medição.
10. [ ] **Executar piloto assistido e ensaio de recuperação**, com dispositivos alvo, rede limitada, reinício do servidor e queda de energia no operador; verificar mensagem por mensagem nos dois lados, CRM/escala, restore e alertas. Liberar a virada somente com bloqueadores encerrados e sem regressão na Valem.

Corrigir o código sem repetir a homologação não justifica elevar a nota para 9,5. O critério de saída deve ser a ausência de perda nas falhas ensaiadas, autorização consistente e latência/recuperação dentro dos objetivos acordados na operação real.

# Plano executável — MVP Tecfag e Valem Chat

## Mandato para a IA desenvolvedora

Implemente este plano sobre o projeto existente. A prioridade de entrada em operação é Tecfag, seguida de Valem. Preserve os dados e qualquer operação Valem já existente durante a implementação. O resultado deve atender aproximadamente 20 atendentes simultâneos no total, distribuídos entre as empresas, e permitir que o administrador de cada empresa escolha Baileys ou WhatsApp Cloud API da Meta.

A estrutura continua sendo uma aplicação TanStack Start/React, um servidor Node persistente e PostgreSQL/Drizzle. O MVP terá uma conexão WhatsApp ativa por tenant. São combinações válidas: ambos com Baileys; ambos com Meta; Tecfag com Baileys e Valem com Meta; e o inverso. Não implementar múltiplos números por empresa nesta entrega.

O nome da empresa não determina o provedor. O provedor não determina a persona. Tecfag usa Fagner; Valem usa Valentina. As funcionalidades de IA têm habilitação própria por tenant. Tecfag deve conseguir operar atendimento humano mesmo sem configurar IA.

Este documento especifica o trabalho; não representa implementação ou validação em produção. As constatações abaixo vêm da leitura do código local. Reconfira o estado atual antes de editar, pois outro desenvolvedor pode ter avançado.

## Diagnóstico que orienta as mudanças

| Área | Evidência no código lido | Consequência |
|---|---|---|
| Login | `src/routes/api/auth/login.ts` lê operadores sem tenant, compara diretamente `passwordHash` e devolve o registro | Não há sessão de servidor estabelecida por esse fluxo; credenciais aparecem no cliente |
| Estado do painel | `src/hooks/useChatState.tsx` usa localStorage para autenticação e tem fallback local de login | O navegador controla o estado que aparenta ser autenticação |
| Envio | O mesmo hook envia texto e mídia com tenant Valem fixo | Tecfag não tem um fluxo independente de envio real nesse caminho |
| Conexão e eventos | O hook abre SSE Baileys apenas para Valem; `/api/baileys/connect` também inicializa a sessão | Ouvir eventos está acoplado à conexão WhatsApp |
| Meta | `SettingsView.tsx` marca a configuração como conectada no estado local; não foi encontrado conector/webhook Meta funcional | A tela não comprova integração operacional |
| Concorrência | `chats/update-queue.ts` atualiza por ID sem comparação atômica de responsável/versão | Duas capturas podem sobrescrever uma à outra |
| Histórico | `chats.ts` lista conversas e carrega todas as mensagens de cada uma | Custo de consultas e resposta cresce com todo o histórico |
| Envio no painel | O hook adiciona mensagens locais mesmo depois de tratar erro no envio | O operador pode confundir mensagem visível com mensagem enviada |
| Mídias | `mediaFiles` no schema não contém tenantId | O isolamento também precisa alcançar os arquivos |
| Histórico destrutivo | `SessionManager.handleIncomingMessage` interpreta `!reset` e apaga mensagens | Uma mensagem recebida pode destruir histórico operacional |
| Inicialização | `src/db/index.ts` executa DDL ao importar; há jobs iniciados por importação de rotas e limpeza no startup | Migração e tarefas precisam ter execução previsível |
| Manutenção | `api/admin/reset.ts` inclui operações destrutivas e autenticação por token fixo | Ferramentas de manutenção não podem ficar disponíveis dessa forma em produção |

O AGENTS.md contém itens desatualizados: o GET de operadores já exige tenant, o SDR já filtra sua configuração e o Supervisor já restringe tenants na consulta principal. Revalidar problemas concretos, sem recriar correções que já existem.

## Decisões de arquitetura

1. Usar inicialmente um processo da aplicação para HTTP, eventos e conectores, com reinício automático. Vinte atendentes não significam vinte sessões Baileys: haverá uma sessão por conexão da empresa.
2. Usar PostgreSQL para sessões de login, dados operacionais, mensagens pendentes e recebimentos que aguardam processamento. Não introduzir Redis, Kafka, Kubernetes ou microsserviços para esta entrega.
3. Criar uma camada pequena de WhatsApp, compartilhada por atendimento humano e automações. Ela consulta a conexão do tenant e chama o adaptador correspondente.
4. Usar eventos SSE autenticados para atualizar o painel independentemente de Baileys ou Meta. O banco é a fonte de verdade; reconectar exige sincronização do estado.
5. A seleção inicial do canal pelo administrador pode exigir leitura de QR ou credenciais Meta. Selecionar uma opção não significa que a conexão foi validada.

Fluxo de saída: operador autenticado → permissão/conversa do tenant → mensagem pendente no banco → adaptador da conexão → confirmação ou falha → atualização no banco → evento para atendentes autorizados.

Fluxo de entrada: evento Baileys ou webhook Meta validado → identificação confiável da conexão/tenant → registro durável e deduplicação → contato/conversa/mensagem → evento ao painel → automação opcional.

## Entrega A — identidade, isolamento e migrações

### Autenticação e autorização

- Implementar sessão de servidor com identificador aleatório em cookie HttpOnly, Secure em produção, expiração e revogação. Persistir somente o hash do identificador da sessão no banco.
- Disponibilizar login, consulta da sessão e logout. A sessão deve carregar operador e tenant a partir de registros do servidor. Revogar sessões ao remover operador ou redefinir senha.
- Para o login inicial, permitir escolher a empresa e buscar o e-mail somente naquele tenant. Essa escolha serve para localizar credenciais; o acesso só é concedido após validar senha e operador.
- Migrar senhas existentes para hash com salt e algoritmo apropriado, por exemplo scrypt do Node. Identificar o formato legado antes da conversão. Se forem texto simples, migrar de forma controlada, sem imprimir valores. Não inventar senhas padrão nem bloquear todos os usuários sem estratégia de transição.
- Retirar passwordHash das respostas, logs, tipos públicos e caches do navegador. Limpar as chaves legadas de localStorage que contêm operadores/senhas durante a atualização do cliente.
- Remover autenticação local de contingência, impersonação disponível ao usuário comum e fallback para outro tenant.
- Criar helpers reutilizáveis para exigir sessão, validar tenant solicitado e exigir permissões. Verificar permissões também no servidor: captura, transferência, encerramento, envio, leitura de outras carteiras e administração.
- Atualizar o AGENTS.md: nas APIs do painel, a sessão é a autoridade. Enquanto clientes existentes enviarem tenantId, exigir consistência com a sessão. Webhooks usam a conexão identificada e verificada; jobs recebem tenant explicitamente. Nenhum desses caminhos usa um tenant padrão.
- Sem sessão: 401. Sem permissão: 403. Recurso de outro tenant: 404, sem expor sua existência. Concorrência: 409. Entrada inválida: 400.
- Revisar CORS e proteção contra CSRF de acordo com a implantação real. Preferir painel e API na mesma origem. Se VITE_BACKEND_URL exigir origens distintas, usar lista explícita e cookies/credenciais configurados corretamente.
- Aplicar limitação de tentativas de login. Proteger SSE e WebSockets de operador com a mesma sessão. Em livechatWs.ts, a mera presença de operatorToken não deve conceder acesso.

### Isolamento de dados

- Inventariar todas as rotas que leem ou alteram dados, incluindo gestão, IA, voz, livechat, CRM, push e downloads. Cada rota deve ter autorização aplicável ou estar explicitamente desabilitada em produção.
- Filtrar SELECT, UPDATE e DELETE por tenantId e ID. Em INSERT, obter o tenant do contexto confiável.
- Validar referências: contato, conversa, operador, setor, grupo, arquivo, tarefa e configuração precisam pertencer ao mesmo tenant. Uma FK simples por ID não garante essa regra.
- Corrigir POST de operadores e grupos para impedir que um ID existente seja transferido para outro tenant. O tenant de um recurso existente não é editável pelo formulário.
- Não permitir que allowedTenants no cliente conceda acesso transversal. No MVP, cada sessão opera a empresa do operador. Um acesso administrativo entre empresas, se necessário no futuro, precisa de autorização específica de servidor.
- Desabilitar rotas de reset/manutenção destrutiva em produção e retirar tokens fixos. Remover o efeito destrutivo de !reset em mensagens recebidas. Reiniciar uma triagem não deve apagar mensagens.
- Revisar jobs de limpeza e relatórios: iterar tenants elegíveis e executar cada operação com tenantId, sem misturar listas de operadores ou contatos.

### Alterações mínimas no banco

Usar migrações versionadas, aditivas e revisáveis. Conferir o schema físico antes de aplicar constraints. Não executar db:seed/db:push sem revisar seus scripts: os comandos atuais encadeiam cleanup.

| Estrutura | Mudança necessária |
|---|---|
| Sessões de autenticação | Tenant, operador, hash do token, expiração, revogação e índices de consulta/limpeza |
| channelConfigs | Uma configuração por tenant; provedor ativo, identificação da conexão, estado e geração/versão da conexão |
| tenants.connectionType | Eliminar duas fontes de verdade: migrar para a configuração de canal ou manter apenas como compatibilidade derivada, sem escrita independente |
| messages | ID interno estável para novas mensagens; ID externo separado; conexão/provedor de origem; direção; estado de envio; chave de idempotência; erro resumido; tentativas e datas necessárias |
| conversations | updatedAt e version para concorrência; índices por tenant, fila, operador e última atividade |
| mediaFiles | tenantId, vínculo com mensagem/conversa e tamanho. Preencher tenant de arquivos antigos por vínculos comprovados antes de exigir NOT NULL |
| Recebimentos pendentes | Caixa de entrada durável simples, com identidade do evento, tenant/conexão, estado, tentativas e próxima tentativa |

Preservar IDs antigos e referências existentes. Não refazer todo o histórico para introduzir UUIDs. Antes de índices únicos, diagnosticar duplicatas; não apagar registros automaticamente para fazer a migração passar. Arquivos com proprietário não comprovado ficam indisponíveis até classificação, nunca atribuídos ao Valem por padrão.

Criar índices adequados às consultas efetivas, incluindo messages(tenantId, conversationId, sentAt, id) e conversations(tenantId, queueState, lastMessageTime, id). Deduplicar IDs externos no escopo da conexão, provedor e tenant. Tornar chaves de idempotência únicas por tenant quando preenchidas.

Remover o DDL automático de importação somente depois que migrações equivalentes cobrirem o schema necessário. A aplicação deve verificar compatibilidade ao subir, sem alterar silenciosamente o banco a cada importação.

## Entrega B — WhatsApp real para qualquer tenant

### Camada comum

Criar módulos pequenos sob src/lib/whatsapp, com nomes ajustáveis: service, types, inbound, outbound, events e os adaptadores baileys/meta. Reutilizar o código funcional existente; não duplicar o processamento de conversa em dois conectores.

O contrato deve incluir envio de texto, mídia, resposta a mensagem e consulta de estado. Capacidades como templates, presença e QR devem ser explícitas por provedor. A interface não pode fingir suporte a uma função ausente.

O cliente envia conversationId, conteúdo e clientMessageId. O servidor resolve tenant, operador, destinatário e conexão. Não confiar em phone ou senderName enviados pelo navegador para decidir destino ou autoria. Nota interna nunca passa pelo conector externo.

SDR, follow-up, bridge do livechat e disparo de relatórios também devem usar esse serviço, quando habilitados. Não basta mudar apenas o envio humano e deixar automações chamando SessionManager.sendMessage diretamente.

### Baileys

- Reutilizar SessionManager e drizzle-auth, retirando condicionais que ligam Baileys exclusivamente a Valem.
- Restaurar no startup apenas conexões cujo provedor ativo seja Baileys. Iniciar reconexão no servidor, sem depender de algum atendente abrir a tela.
- Separar assinatura de eventos da ação de conectar. GET de eventos não pode apagar credenciais, gerar nova sessão ou executar force reset.
- Restringir conectar, desconectar e gerar novo pareamento ao administrador autorizado. Preservar chaves em falhas transitórias.
- Serializar gravações de credenciais por tenant para evitar uma gravação antiga sobrescrever uma nova. Persistência falhou: registrar e tratar a falha, sem declarar sucesso silenciosamente.
- Garantir um único proprietário da sessão por conexão, inclusive durante sobreposição de processos em deploy. Pode usar lock de PostgreSQL em conexão dedicada, com liberação e encerramento do socket ao perder propriedade.
- Tratar eventos fromMe e ecos do painel sem duplicar mensagens. Uma mensagem enviada diretamente pelo celular não pode atribuir arbitrariamente um atendente.
- Validar recebimento de texto, imagem, documento, áudio e resposta a mensagem, além de reconexão e reinício.

### Meta Cloud API

- Implementar o conector real com versão de API configurada e validada contra a documentação oficial vigente. Conferir antes de codificar os requisitos atuais de conta, identificação de destinatário, templates, mídia e janela de atendimento; não fixar regras antigas por memória.
- Configuração administrativa: identificadores exigidos pela conta, número/conexão, token de acesso e dados necessários à validação do webhook. App Secret é segredo de servidor. Nunca retornar esses segredos em GET nem registrar em logs.
- Implementar verificação inicial do webhook e assinatura do POST sobre o corpo bruto. Identificar o tenant pelo identificador de conexão/número previamente cadastrado. Não aceitar tenantId arbitrário no payload como autoridade.
- Só confirmar recebimento depois de gravar o evento duravelmente. Se o banco não puder persistir, responder erro recuperável, permitindo repetição pelo provedor.
- Processar o evento fora da resposta do webhook; suportar lotes, repetição e eventos fora de ordem. Falha de IA não pode invalidar recebimento de mensagem.
- Implementar envio de texto, mídia, resposta e template quando exigido. Integrar consulta/seleção de templates aprovados ao fluxo necessário. As respostas rápidas internas do projeto não equivalem a templates Meta aprovados.
- Controlar no servidor quando texto livre é permitido. Se não for, apresentar o caminho de template e um motivo claro. Não simular envio bem-sucedido.
- Processar confirmações de envio, entrega, leitura e falha. Não rebaixar status por evento atrasado. Aceitação HTTP pelo provedor não equivale a entrega ao destinatário.
- Persistir ou armazenar de forma durável mídias recebidas; não depender apenas de URLs externas temporárias. Para o MVP, pode reutilizar armazenamento atual com limite de tamanho e consultas separadas, sem carregar Base64 na listagem.
- Tratar token inválido, número não configurado, limite do provedor, erro temporário e mídia incompatível. Separar falhas definitivas das que permitem retry.

### Envio confiável

1. Registrar a mensagem e clientMessageId antes de tentar o envio. Repetir a mesma requisição deve retornar a mesma mensagem, sem novo disparo.
2. Usar messages como fila de saída simples, com estado pending/sending/accepted/delivered/read/failed/unknown e campos de tentativa. Um worker toma a mensagem atomicamente. Não manter transação aberta durante chamadas externas.
3. Preservar ordem por conversa e limitar concorrência por conexão. Um tenant congestionado não deve impedir o outro de enviar.
4. Timeout com resultado externo desconhecido não é falha comprovada. Marcar unknown, tentar reconciliar com eventos/IDs e não reenviar cegamente. Não prometer entrega exatamente uma vez quando o provedor não oferece essa garantia.
5. Retomar itens pendentes após reinício. Itens presos em sending exigem tratamento de resultado desconhecido, não repetição automática indiscriminada.
6. O painel usa o ID interno retornado pelo servidor para reconciliar atualização otimista e eventos. Anexo com falha deve continuar marcado como falha, mesmo se o texto do mesmo envio tiver sido aceito.

### Escolha e mudança de provedor

A tela deve permitir ao administrador configurar e validar a opção nova antes de ativá-la. Salvar formulário não muda status para conectado. Para Meta, mostrar separadamente validação de credenciais e recebimento confirmado de webhook; para Baileys, mostrar o estado real do pareamento.

Ao trocar: suspender novos envios da conexão antiga, verificar mensagens pendentes e resolver estados desconhecidos. Ativar a nova configuração atomicamente e impedir envios de workers antigos com uma versão de conexão obsoleta. Eventos tardios de entrega ainda devem reconciliar mensagens da conexão original, sem reativar o conector anterior.

Preservar histórico. Mensagens pendentes mantêm o vínculo com a conexão original; não devem ser redirecionadas automaticamente pela nova conta. O número só é considerado migrado após validar os requisitos reais do provedor. A tela não pode prometer troca instantânea ou coexistência irrestrita do mesmo número.

## Entrega C — operação simultânea e estabilidade

### Filas, responsabilidade e histórico

- Manter os estados atuais: fila, meus, automacao e finalizados. Validar transições no servidor.
- Captura: UPDATE condicionado ao tenant, estado elegível, responsável e versão esperada. Apenas um vencedor; os demais recebem 409 e o estado atual autorizado.
- Transferência/encerramento: validar permissão e responsável atual; rejeitar versão antiga. Mensagem de sistema e mudança de fila devem ser gravadas na mesma transação.
- Revalidar permissão de envio quando a mensagem é aceita. Não permitir que uma tela antiga envie como responsável depois de uma transferência, salvo permissão explícita de intervenção.
- Rodízio, quando habilitado, também precisa de alocação atômica e atualização consistente dos contadores.
- Mensagem nova não deve sobrescrever transferência recente por usar um snapshot antigo da conversa. Usar incremento atômico para unreadCount e preservar lastMessageTime contra eventos atrasados.
- Encerrar/reabrir não apaga histórico. Preservar o modelo atual de conversa por contato no MVP e documentar a regra de reabertura; não introduzir tickets como nova entidade sem necessidade.
- Sem automação habilitada, contatos novos vão para fila ou carteira válida do próprio tenant. Configuração ausente de IA não pode deixar atendimento preso em automacao.

### Consultas e eventos

- GET de chats retorna resumo paginado, com filtros de fila, operador e busca. Padrão sugerido: 50 itens, máximo 100. Paginação estável com cursor de data e ID.
- Histórico tem endpoint próprio: últimas 50 mensagens e carregamento das anteriores. Notas internas seguem as permissões do painel e nunca chegam ao visitante/cliente.
- Aplicar filtro de visibilidade antes de retornar os dados. Filtrar apenas no React não protege mensagens de outros operadores.
- Substituir acesso direto de componentes a conversations[].messages por cache/hook de histórico por conversa. Inventariar os componentes consumidores para não quebrar busca, anexos, notas e visão mobile.
- SSE transmite IDs e alterações autorizadas. Remover conteúdo desnecessário dos eventos enviados a operadores sem acesso à conversa. QR e credenciais de pareamento só podem chegar a administradores autorizados.
- Ao reconectar, recarregar página atual, contadores e conversa aberta, incluindo alterações/exclusões relevantes. Isso cobre eventos perdidos sem exigir um servidor de eventos adicional.
- Heartbeat e limpeza de listeners devem impedir conexões abandonadas. Atualização repetida deve ser idempotente no frontend.
- Troca de tenant, logout ou sessão expirada fecha streams, cancela requisições antigas e limpa caches. Uma resposta atrasada do tenant anterior não pode preencher a nova tela.

### IA e integrações existentes

- Preservar getAiPersona como fonte de nome, empresa e gênero. Fagner é o assistente interno do Tecfag inicialmente; habilitar SDR/supervisão para Tecfag exige configuração própria.
- Remover tenant/feature opcionais do contexto das chamadas Vertex onde isso permite cobrança atribuída ao tenant errado. Rejeitar contexto ausente.
- Serviços de IA usam timeout e concorrência limitada. Falha ou lentidão de IA não bloqueia receber, abrir, assumir e responder chats humanos.
- Cancelar/revalidar resposta pendente da IA quando um humano assume. Uma geração iniciada antes da captura não pode enviar depois sem conferir o estado atual.
- Revisar jobs que são iniciados ao importar rotas. Inicializar uma vez no servidor, com elegibilidade por tenant e proteção contra execução sobreposta.
- Não ativar voz, campanhas, CRM ou follow-ups de Tecfag automaticamente. Recursos existentes da Valem devem conservar suas configurações e usar o novo transporte quando aplicável.
- Auditar rotas auxiliares: desativar explicitamente recursos não prontos é aceitável; deixá-los expostos sem isolamento não é.

### Operação e implantação

- Um servidor Node persistente, PostgreSQL com backup e armazenamento durável das mídias. Medir CPU, memória, uso do pool e latência antes de decidir aumentar recursos.
- Endpoint simples de saúde e prontidão: processo, banco e esquema compatível. Estado individual de conectores é mostrado por tenant; Meta indisponível não deve tornar Baileys indisponível.
- Registrar eventos operacionais com tenant, conexão, conversa, mensagem e resultado. Não incluir senhas, tokens, QR, arquivos de credenciais ou conteúdo integral de conversas nos logs.
- Encerramento do processo: parar novas tarefas, finalizar tarefas curtas, persistir estado e liberar a conexão Baileys. Planejar uma breve reconexão durante deploy; não prometer interrupção zero.
- Não depender de memória para a única cópia de mensagem pendente. Backups devem incluir dados e credenciais necessárias à restauração, com acesso restrito.

## Contratos de API propostos

Os caminhos são sugestões de implementação; manter convenções do TanStack Start e atualizar todos os consumidores. Não editar manualmente a árvore de rotas gerada.

| Endpoint | Finalidade e autorização |
|---|---|
| POST /api/auth/login | Empresa, e-mail e senha; cria cookie e devolve operador sanitizado |
| GET /api/auth/session | Sessão atual, tenant, operador, permissões e configuração pública do canal |
| POST /api/auth/logout | Revoga sessão e expira cookie |
| GET /api/chats | Lista paginada limitada ao tenant e à visibilidade do operador |
| GET /api/chats/{id}/messages | Histórico paginado e autorizado |
| POST /api/chats/{id}/messages | Texto/mídia/nota, clientMessageId; devolve ID e estado persistidos |
| POST /api/chats/{id}/actions | Capturar, transferir, finalizar ou reabrir, com versão esperada |
| GET /api/events | SSE autenticado independente do provedor |
| GET/PUT /api/settings/whatsapp | Ler dados sanitizados e salvar configuração; escrita administrativa |
| POST /api/settings/whatsapp/actions | Validar, ativar, conectar, desconectar; ações administrativas auditáveis |
| GET/POST /api/webhooks/meta | Verificação e recebimento autenticados pelo mecanismo Meta |
| GET /api/media/{id} | Download com sessão e pertença ao tenant/conversa |

Não manter endpoints Baileys legados como atalhos públicos para contornar o novo serviço. Adaptá-los com a mesma autorização durante a transição ou removê-los após atualizar consumidores. Para mídia Meta que precise de acesso externo, usar upload ao provedor; não tornar o download do painel público para resolver a integração.

## Arquivos que devem ser considerados

| Área | Arquivos existentes mais relevantes |
|---|---|
| Diretrizes | AGENTS.md |
| Banco | src/db/schema.ts, src/db/index.ts, src/db/migrations, package.json |
| Identidade/permissões | src/routes/api/auth/login.ts, src/lib/rbac.ts, src/hooks/usePermissions.ts, src/routes/api/operators.ts, src/routes/api/groups.ts |
| Estado/interface | src/hooks/useChatState.tsx, src/components/chat/Login.tsx, SettingsView.tsx, ChatList.tsx, ChatPanel.tsx e componentes mobile |
| Atendimento | src/routes/api/chats.ts, chats/update-queue.ts, contacts.ts, contacts/$contactId.ts, contacts/update-wallet.ts |
| WhatsApp | src/lib/baileys/session-manager.ts, drizzle-auth.ts, src/routes/api/baileys/* |
| IA e automações | src/lib/valentina/*, src/lib/vertex-ai.ts, src/lib/report-dispatcher.ts, src/lib/livechat/livechat-bridge.ts |
| Execução | src/start.ts, src/server.ts, server/plugins/*, vite.config.ts |
| Superfícies auxiliares | src/routes/api/admin/reset.ts, livechat/*, gestao/*, voice-*, src/lib/livechat/livechatWs.ts |

## Verificação obrigatória e definição de pronto

Criar testes focados nos riscos abaixo. Testes de concorrência/transação devem usar PostgreSQL de teste, e não apenas mocks que ignoram locks e constraints. Dados de carga ficam em ambiente isolado; nunca popular Tecfag ou Valem de produção para simular volume.

| Cenário | Resultado obrigatório |
|---|---|
| Operador Tecfag solicita IDs Valem, e vice-versa | Nenhuma leitura, alteração, download, evento ou envio cruzado |
| Requisição altera tenantId, operatorId ou senderName | Não muda identidade nem concede permissão |
| Senha inválida/API indisponível | Não autentica por cache local; resposta não contém credenciais |
| Duas capturas simultâneas | Uma vence; outra recebe 409; apenas um responsável e registro de captura |
| Transferência durante mensagem recebida/geração IA | Responsável não regride; IA respeita tomada humana |
| Duplo clique/repetição do mesmo clientMessageId | Um registro e um disparo, quando o resultado é conhecido |
| Timeout depois de possível aceitação externa | Estado desconhecido explícito; sem reenvio cego |
| Evento/webhook repetido | Não duplica mensagem, contato, conversa ou contador |
| Atualizações de entrega fora de ordem | Estado não regride indevidamente |
| Reinício com pendências | Pendentes recuperados; desconhecidos tratados; histórico preservado |
| Queda de SSE e reconexão | Tela recupera mensagens, fila e responsável atuais |
| Falha de token Meta/queda Baileys | Tenant afetado recebe diagnóstico; o outro continua operando |
| Dois processos durante deploy | Não há duas sessões Baileys proprietárias nem dois workers enviando o mesmo item |
| Texto !reset vindo de cliente | Nenhum histórico apagado |
| Troca de provedor | Histórico permanece; envio antigo não sai pela conexão nova |
| Mídia e mobile | Arquivos autorizados, falhas visíveis e fluxo funcional no layout mobile |

Executar build, checagem de tipos e testes pertinentes. Distinguir regressões introduzidas de problemas anteriores. Registrar comandos/resultados sem expor segredos.

Validar as quatro combinações de provedores com testes de adaptadores e integração. Realizar envio e recebimento reais em números autorizados de teste quando as credenciais estiverem disponíveis. Se faltar uma conta Meta ou pareamento, declarar esse cenário como pendente; testes simulados não comprovam conexão real.

### Ensaio de 20 atendentes

Usar como cenário inicial proposto: 20 sessões simultâneas, primeiro 10 por tenant e depois 20 em Tecfag; 10 mil contatos e 100 mil mensagens sintéticas no total; 500 conversas ativas; uma hora de uso com abertura de chats, captura, transferência, texto e anexos. Incluir rajadas de entrada e uma reinicialização. Anotar hardware e volume utilizados.

Metas iniciais de aceite no ambiente de teste: p95 abaixo de 1 segundo para listagem/histórico paginado e aceitação local de texto; p95 abaixo de 2 segundos para evento aparecer após persistência; nenhum acesso cruzado ou perda de mensagem já confirmada como persistida; nenhuma duplicação evitável por reenvio de requisição; ausência de crescimento contínuo de memória/conexões. Latência do provedor, upload e geração de IA devem ser medidas separadamente. Não anunciar capacidade para 20 usuários apenas porque a aplicação compilou.

## Ordem de execução e liberação

**Primeira entrega:** inventário breve, migrações aditivas, sessão, permissões, isolamento e remoção dos atalhos destrutivos. Atualizar backend e frontend juntos para evitar clientes novos em rotas antigas sem proteção. Validar restauração de backup em ambiente isolado.

**Segunda entrega:** transporte compartilhado, Baileys para ambos, Meta real, estados de envio e eventos independentes. A primeira operação assistida será Tecfag no provedor escolhido pelo administrador. A opção alternativa só aparece como disponível quando realmente implementada e validada.

**Terceira entrega:** concorrência, paginação, recuperação, ensaio de 20 sessões e implantação controlada. Executar as verificações da operação Valem antes da liberação conjunta.

Preparar backup e migrações antes do deploy. Não executar reset, seed de produção, troca de número ou desconexão real da Valem como passo de desenvolvimento. Não reescrever histórico Git publicado, pois o projeto está conectado ao Lovable. Não usar rollback que reexponha APIs sem autenticação; ter versão de contingência compatível com o esquema aditivo e com a proteção de acesso.

Antes de qualquer ação dependente de conta externa, informar os dados mínimos faltantes: qual provedor será ativado primeiro em Tecfag, número autorizado, credenciais Meta se aplicável e ambiente de implantação. Avançar nas partes independentes enquanto esses dados não chegam. Nunca inventar credenciais nem usar a linha Valem para testar Tecfag.

Ao entregar, apresentar: mudanças realizadas; migrações; instruções de configuração para ambos os provedores; evidências dos testes; resultado medido de concorrência; pendências externas; instruções de recuperação de sessão, banco e envio. Só classificar como pronto para operação o que tiver evidência de funcionamento.

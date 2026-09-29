# Plano de correção do isolamento Valem × Tecfag

**Data da auditoria de código:** 29/09/2026  
**Objetivo:** fazer Valem e Tecfag compartilharem infraestrutura e código sem compartilhar dados, permissões, configurações, chamadas, arquivos, cards ou contexto de IA.

> Este arquivo é uma instrução de execução para a IA que fará as correções. Leia `AGENTS.md` antes de editar. A análise foi estática: os defeitos abaixo são verificáveis no código, mas a existência de registros já contaminados exige uma auditoria separada e somente de leitura do banco.

## Instrução pronta para enviar à IA

> Corrija o isolamento multi-tenant deste repositório seguindo este plano até cumprir todos os critérios de aceite. Implemente e verifique em entregas pequenas, começando pelas rotas que permitem vazamento ou alteração entre empresas. Use `AGENTS.md` como regra obrigatória. Preserve a operação da Valem e não execute seeds, resets, migrações destrutivas ou testes de escrita no banco operacional. Há mudanças locais de CRM em andamento: não as descarte, reverta ou sobrescreva. Não faça force push, rebase ou amend de commits publicados. Em cada entrega, mostre arquivos alterados, risco, testes executados e pendências; não declare o isolamento concluído antes de passar na matriz de testes dos dois tenants. Não pare após apenas elaborar outro plano: implemente as correções de código e os testes seguros.

## Regras de implementação

1. Rota interna: `requireSession(request)` em **cada método**; o tenant operacional é `session.tenantId`. `tenantId` recebido por URL ou body nunca concede acesso. Se existir por compatibilidade, compare com a sessão e rejeite divergência.
2. Toda leitura, atualização, exclusão e join de entidade de negócio deve comprovar o tenant da linha. Em mutações, validar também o tenant de cada ID relacionado. Não confiar no filtro da interface.
3. Rotas realmente públicas — login, webhook, callback OAuth, widget e participante de chamada — exigem autenticação própria explícita: assinatura, estado assinado, token de acesso limitado ou vínculo de domínio/conexão. Um identificador ou `tenantId` na URL não é credencial.
4. Um usuário pode ter acesso autorizado às duas empresas pela plataforma; cada sessão e cada requisição operam em **uma** empresa. Trocar de empresa cria contexto novo e elimina dados em memória/cache da anterior.
5. Canal WhatsApp é configuração por tenant. Não codificar Valem como Baileys ou Tecfag como Meta na lógica de roteamento.
6. IA usa somente `vertexAi`, com `tenantId` e `feature` obrigatórios. Persona vem de `getAiPersona(tenantId)` e configuração de `agentConfigs` filtrada pelo tenant. Tecfag permanece apenas com Fagner no chat interno até ativação explícita das outras features.

### Critério obrigatório de persona: Valentina e Fagner

| Tenant da sessão | IA correta | Empresa e especialidade no contexto | Feature do chat do operador | Recursos habilitados agora |
|---|---|---|---|---|
| `valem` | **Valentina** | Valem Válvulas e Embalagens; atendimento comercial e produtos da Valem | `valentina_chat` | Valentina do operador e recursos de IA da Valem configurados para esse tenant |
| `tecfag` | **Fagner** | Tecfag Informática; atendimento técnico e soluções de TI | `fagner_chat` | Somente Fagner no chat interno do operador; SDR, Supervisor e Auditorias desativados até ativação autorizada |

- Nome, avatar, gênero gramatical, saudação, rótulos de botões, indicadores de digitação, notificações, prompts, RAG e contexto operacional devem corresponder ao tenant da **sessão**. O nome de arquivo ou rota legada `valentina` não autoriza exibir Valentina para Tecfag.
- Configuração, histórico de conversas com a IA e base de conhecimento devem ficar separados por `tenantId` e, quando aplicável, por operador. Fagner nunca recebe prompt, catálogo, produto ou histórico da Valem; Valentina nunca recebe os da Tecfag.
- Não usar `"valem"` como fallback quando o tenant estiver ausente ou desconhecido. Falhar explicitamente antes de montar prompt, buscar dados ou registrar custo.
- Testar os dois sentidos com sessões reais de teste: login Valem exibe e consulta somente Valentina; login Tecfag exibe e consulta somente Fagner; após alternar a empresa, a interface, o histórico, o contexto RAG e a feature de custo mudam juntos, sem mostrar dados da sessão anterior. Verificar também que Tecfag não inicia SDR, Supervisor ou Auditorias.

## Entrega 0 — Inventário e proteção do trabalho existente

- Registrar o estado de Git e distinguir alterações existentes das novas. O CRM possui arquivos modificados e não rastreados; trabalhar sobre o estado atual sem limpar, trocar branch às cegas ou aplicar migração em produção.
- Inventariar os métodos das 116 rotas em `src/routes/api/`: interna, pública validada ou obsoleta. Registrar método, autoridade do tenant, permissão, tabelas consultadas e teste esperado. Não classificar uma rota como segura apenas porque o arquivo importa `requireSession`; conferir todos os handlers.
- Levantar consumidores frontend de cada rota a corrigir para atualizar cliente e servidor na mesma entrega.
- Preparar banco de testes realmente isolado. Antes de qualquer teste com escrita, confirmar a conexão efetiva e suas credenciais, não apenas a palavra `test` na URL. Nunca usar `db:seed`, `db:push`, `db:reset-data` ou scripts de migração contra Valem.

## Entrega 1 — Fechar acessos diretos de maior risco

**1A. Gestão e configurações internas.** Aplicar sessão e permissões em `src/routes/api/gestao/*` e `src/routes/api/settings/reports.ts`. Começar por `gestao/messages.ts`, `costs.ts`, `live.ts`, `audits.ts`, `tasks.ts`, `reports-v2.ts`, `report-workflow.ts`, `my-metrics.ts` e `operator-history.ts`. Proibir consulta global de custos quando o tenant estiver ausente. Não devolver `smtpPass` ao navegador; tratar gravação de SMTP como ação admin.

**1B. IA interna.** Proteger `src/routes/api/valentina/config.ts`, `agents.ts`, `messages.ts`, `assistant.ts`, `knowledge.ts`, `catalog-images.ts`, `rodizio.ts`, `sdr.ts` e `supervisor.ts`. Leitura de mensagens do operador deve usar o operador da sessão, salvo permissão administrativa explícita. Configuração, rodízio, base de conhecimento e habilitação de agentes exigem admin. No `sdr.ts`, a ação `stop` deve localizar conversa/estado por ID **e tenant** antes de mudar qualquer linha.

**1C. Arquivos.** Em `valentina/knowledge.ts` e `catalog-images.ts`, exigir tenant e autorização em `getContent`, `getFileData`, `rawImage`, upload, move, atualização e exclusão. Checar tenant da pasta de origem e destino. Em `baileys/media.ts`, não servir arquivo a quem não tiver sessão ou acesso público específico; consultar o registro por `id + tenant`, rejeitar registro sem tenant e evitar cache em disco identificável apenas por `messageId` quando puder haver colisão.

**1D. Live Chat.** Em `src/lib/livechat/livechatWs.ts`, substituir o `operatorToken` arbitrário por autenticação real da sessão do servidor e comparar o tenant da conexão. Para visitantes, usar token de sessão do widget e vínculo verificável ao site/tenant; limitar leitura ao próprio visitante. Proteger `src/routes/api/livechat/visitors.ts`, `visitor/$visitorId.ts`, `metrics.ts` e a escrita de `tray-config.ts` como APIs internas.

**1E. Voz e notificações.** Proteger rotas administrativas de `voice-*`, `elevenlabs-*`, `calls.ts` e `push.ts`. Separar endpoints de participante de chamada dos endpoints de operador; o link da sala deve conceder apenas as ações necessárias àquele participante. GET por `callId` e histórico de áudio/transcrição devem validar tenant. Campanhas e agendas exigem permissão adequada. Webhooks de voz exigem verificação da assinatura/segredo do provedor.

**Aceite da entrega 1:** sem sessão, cada rota interna retorna 401; uma sessão Valem não lê nem altera IDs Tecfag, e vice-versa; ações admin retornam 403 para operador comum; webhooks e widget só funcionam com a validação pública específica.

## Entrega 2 — Eliminar associações cruzadas e fontes compartilhadas

- Revisar consultas por ID sem `tenantId` em `src/lib/valentina/`, `src/lib/audit-service.ts`, `src/lib/baileys/session-manager.ts`, `src/lib/livechat/`, rotas de voz, relatórios e serviços de CRM. Corrigir também `UPDATE`/`DELETE` e joins, mesmo quando o ID atual parece globalmente único.
- Em `src/routes/api/elevenlabs-conversations.ts` e `voice-clients.ts`, não consultar um agente externo global e depois atribuir os resultados ao tenant pedido. Remover associação por posição, proximidade de horário e telefone fixo de fallback. Exigir uma conexão/identificador externo próprio e comprovado para cada tenant; até isso existir, desativar a listagem cruzada nesse tenant. O mesmo vale para áudio e transcrição por ID externo.
- Remover do fluxo operacional mapeamentos fixos entre identidades das empresas, como o mapeamento de e-mails em `src/routes/api/tasks.ts`. Se houver integração RD distinta por tenant, usar credenciais e IDs de usuário daquele tenant.
- Fazer auditoria **somente de leitura** para localizar dados existentes com `tenant_id` diferente entre relações: conversa→contato/operador/setor, mensagem→conversa, auditoria→conversa/operador, mídia→mensagem/conversa, card→funil/etapa/contato/conversa/operador, Live Chat e voz. Emitir contagens e IDs para revisão; não corrigir registros automaticamente.

**Aceite da entrega 2:** IDs de uma empresa não retornam dados nem produzem efeitos na outra; chamadas externas só aparecem na empresa da conexão comprovada; relatório de anomalias existente é separado das mudanças de código.

## Entrega 3 — Persona, features e interface

- Parametrizar todos os prompts e textos operacionais com `getAiPersona(tenantId)` e `agentConfigs` do tenant. Corrigir especialmente `src/routes/api/valentina/assistant.ts`, `messages.ts`, `src/lib/valentina/sdr-engine.ts` e componentes `ChatList.tsx`, `ChatPanel.tsx`, `Sidebar.tsx`, `ValentinaAssistantModal.tsx`, `ProductCatalogPicker.tsx` e `MonitorView.tsx`. A identidade Fagner/Tecfag não pode receber instruções comerciais da Valem.
- Remover o uso de Valem como fallback em `src/lib/vertex-ai.ts`, `src/lib/valentina/knowledge-service.ts`, rotas e componentes. Tenant ausente ou inválido deve falhar de modo explícito. Usar a feature de custo correta: `fagner_chat` para Tecfag, `valentina_chat` para Valem.
- Fazer habilitação de SDR, Supervisor, Auditorias e rodízio depender de configuração/feature flag do tenant com padrão seguro. Tecfag não deve ganhar essas features apenas por POST em uma rota. Jobs devem processar tenants elegíveis separadamente.
- Em `src/hooks/useChatState.tsx`, usar sessão como fonte inicial de autoridade, isolar caches/localStorage por tenant e operador quando apropriado, e zerar dados sensíveis e requisições pendentes na troca/logout. Não construir card/chat de Valem enquanto o tenant real ainda é desconhecido.
- Remover o auto-seed de relatórios fictícios em `src/routes/api/gestao/reports-v2.ts`. GET sem dados retorna vazio com estado explicativo, nunca cria dados para Valem ou Tecfag.
- Substituir integrações diretas de IA/voz fora de Vertex conforme `AGENTS.md`. Remover credenciais literais do código e planejar rotação de qualquer segredo que tenha sido usado. Preservar a função de voz da Valem durante a transição, com teste de integração antes da troca.

**Aceite da entrega 3:** todos os casos do **Critério obrigatório de persona: Valentina e Fagner** passam em teste; custos são atribuídos à feature e ao tenant corretos; GET não cria relatórios fictícios.

## Entrega 4 — Defesa no banco e validação final

- Após revisar anomalias e preparar migração aditiva, criar unicidade `(tenant_id, id)` e FKs compostas para relações críticas que ainda usam somente ID. Avaliar `NOT NULL` em mídia após resolver registros legados. Verificar índices para filtros por tenant. Considerar RLS como proteção adicional, sem substituir filtro nas queries.
- Migração de dados existentes deve ser proposta com inventário, backup testado, estratégia de rollback e janela compatível com a Valem. Não mover nem excluir dados de produção por inferência de nome, telefone ou e-mail.
- Adicionar testes de integração para dois tenants com **o mesmo telefone de contato**, nomes semelhantes e IDs de recursos conhecidos. Cobrir 401 sem sessão, 403 de permissão, 404 de recurso de outro tenant, CRUD, joins, SSE/WebSocket, troca de empresa, mídia, IA, cards, chamadas e jobs. Incluir testes de não regressão para a Valem.
- Executar build e testes relevantes em ambiente isolado. Revisar o diff antes de publicar. Implantar em etapas que mantenham o canal ativo da Valem; monitorar autenticação, ingestão e envio de mensagens após cada etapa.

**Aceite final:** nenhum endpoint ou evento permite ler, criar, alterar ou excluir dados de outro tenant; nenhum prompt ou tela mistura personas; nenhuma integração externa compartilha resultados sem vínculo de tenant; o banco rejeita relações cruzadas críticas; Valem continua recebendo e enviando mensagens durante a implantação.

## Saída esperada da IA executora

Para cada entrega, informar: (1) defeitos corrigidos e arquivos, (2) evidência dos testes dos dois tenants e sem sessão, (3) riscos operacionais remanescentes, (4) mudanças de banco propostas versus aplicadas, (5) qualquer dado suspeito encontrado apenas em auditoria de leitura. Se houver bloqueio real, apontar o contrato ou credencial que falta e continuar as partes independentes.

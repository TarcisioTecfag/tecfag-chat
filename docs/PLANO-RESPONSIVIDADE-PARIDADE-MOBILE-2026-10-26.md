# Plano de responsividade e paridade funcional entre desktop e celular

Data: 26/10/2026. Base examinada: commit `d627345`, de 23/10/2026, e arquivos presentes no checkout.

Este documento é um plano, sem implementação. A análise foi estática, a partir do código, das rotas, dos componentes, das permissões e da estrutura dos testes. Não houve acesso ao banco, execução dos workers, envio de mensagens, alteração de configurações, build, testes em navegador ou validação em aparelhos. Os arquivos de trabalho preexistentes foram preservados.

## 1. Resultado da análise

A versão mobile não está apenas com estilos antigos: ela mantém uma composição própria de navegação, cabeçalho e envio de mensagens. As funcionalidades acrescentadas ao desktop não entram automaticamente nessa composição.

O registro central contém **14 módulos**. A estrutura mobile possui ramificações explícitas para sete deles, mas uma dessas ramificações substitui o módulo completo de IA por um feed. Outros sete módulos não possuem renderização própria nessa estrutura e caem na lista de conversas. Isso não significa que todos os seus componentes sejam incompatíveis com celular: alguns já têm adaptações locais, e o detalhe da negociação possui uma rota independente.

Consequentemente, a implementação precisa tratar quatro frentes:

1. Acesso a todos os módulos, abas e ações autorizados.
2. Regras e resultados iguais nos fluxos de negócio, especialmente atendimento e CRM.
3. Layout, toque, teclado virtual, arquivos, áudio e navegação adequados ao celular.
4. Uma estrutura compartilhada que impeça nova divergência a cada atualização.

**Objetivo de conclusão:** toda função efetivamente disponível no desktop para determinado tenant e perfil deve poder ser concluída no celular pelo mesmo perfil, com as mesmas permissões, validações e efeitos. A apresentação e o número de passos podem mudar. Restrições do navegador precisam de alternativa funcional ou de limitação documentada e validada; esconder uma função não atende à paridade.

## 2. Limites e regras de proteção

- Priorizar a implantação Tecfag e preservar a operação contínua da Valem.
- Usar dados sintéticos e credenciais de homologação. Não criar dados de teste nos tenants de produção.
- Não conectar ou desconectar WhatsApp, disparar campanhas, enviar e-mails, ativar automações ou acionar IA real durante a validação de interface.
- Manter tenant da sessão no servidor, filtros de tenant nas consultas e verificações de permissão por ação. Um menu escondido não substitui autorização da API.
- Obter identidade visual e persona por `getAiPersona(tenantId)`. Canal depende da configuração do tenant; a interface não deve deduzi-lo pelo nome da empresa.
- Manter Vertex AI como integração central e preservar os contextos de custo `feature` e `tenantId` nas chamadas existentes.
- Não alterar recursos habilitados por tenant como consequência de expor um módulo no celular. O AGENTS.md restringe SDR, Supervisor e Auditorias para Tecfag; o código atual contém referências mais recentes a SDR industrial nesse tenant. Essa divergência precisa ser conciliada antes de liberar essas funções. Até lá, a implementação de responsividade não deve ativá-las.
- Manter histórico Git publicado e sincronização Lovable. Fazer entregas pequenas, sem force push nem reescrita de commits publicados.

## 3. Evidências e lacunas encontradas

Legenda: **confirmado** = verificável no código; **risco** = depende de reprodução e validação funcional. Prioridade P0 bloqueia liberação do fluxo afetado; P1 cobre a operação principal; P2 cobre as demais áreas, ainda obrigatórias para concluir a paridade.

| ID | Prioridade | Constatação | Consequência e tratamento planejado | Evidência |
| --- | --- | --- | --- | --- |
| A01 | P1 | Confirmado: renderizadores separados para desktop e mobile. | Centralizar o catálogo e a resolução de módulos, mantendo composições específicas quando necessárias. | `src/routes/index.tsx:189`; `src/components/mobile/MobileLayout.tsx:80` |
| A02 | P1 | Confirmado: CRM, Tarefas, Ligações, Monitorar, Estatísticas, Acessos e Ajustes não têm ramificação mobile. | Links podem manter o endereço do módulo e mostrar conversas. Remover esse fallback silencioso e adicionar cada módulo após homologação. | `src/components/mobile/MobileLayout.tsx:80` |
| A03 | P1 | Confirmado: navegação inferior tem apenas parte dos módulos e não possui menu completo. | Criar acesso a todos os destinos permitidos, incluindo IA para Tecfag e War Room. O War Room já tem ramificação mobile, mas não item próprio nessa navegação. | `src/components/mobile/MobileBottomNav.tsx:16` |
| A04 | P1 | Confirmado: `activeView === "valentina"` mostra `ValentinaFeed`, e não `ValentinaView`. | Feed não equivale às abas Chat, SDR, Rodízio, Fluxos, Supervisor, Vendedor e Conhecimento. Separar o destino do feed e o acesso ao módulo de IA. | `src/components/mobile/MobileLayout.tsx:86`; `src/components/valentina/ValentinaView.tsx:29` |
| A05 | P0 | Confirmado: callback de envio mobile aceita apenas texto e flag de nota. | No envio normal por esse callback, anexos selecionados não são repassados a `sendMessage`. Unificar contrato incluindo anexos; testar arquivo sozinho e com legenda. A nota interna segue outra ramificação. | `src/components/mobile/MobileMessageInput.tsx:128`; `src/components/mobile/MobileLayout.tsx:35` |
| A06 | P1 | Confirmado: busca do cabeçalho apenas alterna `searchOpen` local. | Não há conexão desse estado com a busca do `ChatPanel`. Compartilhar controle, resultados e navegação entre ocorrências. | `src/components/mobile/MobileLayout.tsx:33` e `:59` |
| A07 | P1 | Confirmado: resposta citada fica no estado do `ChatPanel`, cujo compositor está oculto no celular. | O compositor mobile não recebe nem envia esse contexto. Compartilhar seleção, prévia, cancelamento e envio da citação. | `src/components/chat/ChatPanel.tsx:1024`, `:2125`, `:3154`; `MobileMessageInput.tsx:128` |
| A08 | P0 | Confirmado: bloqueios de responsável, fila e templates Meta estão na composição do compositor desktop. O mobile externo condiciona principalmente a exigência de negociação. | Reproduzir os mesmos estados antes do envio: outro responsável, fila, finalizado, negociação pendente, janela Meta fechada e carregamento da política. A API já faz verificações; não é evidência de bypass no servidor. | `src/components/chat/ChatPanel.tsx:3154`; `src/components/mobile/MobileLayout.tsx:126`; `src/routes/api/whatsapp/send.ts:159` |
| A09 | P0 | Confirmado: aba de nota mobile não usa `canSendInternalNotes` para sua apresentação; desktop usa. | Compartilhar disponibilidade da ação e explicação de bloqueio. Preservar a recusa da API para quem não tem permissão. | `src/components/mobile/MobileMessageInput.tsx`; `src/components/chat/ChatPanel.tsx:3455`; `src/routes/api/whatsapp/send.ts:165` |
| A10 | P0 | Confirmado: desktop preserva intenções de envio em armazenamento do navegador antes de processar a fila; o envio mobile não passa por essa mesma fila. | Avaliar e reaproveitar durabilidade, idempotência, recuperação e vínculo ao tenant/conversa. Evitar criar uma segunda fila concorrente. | `src/components/chat/ChatPanel.tsx:2155`; `src/components/mobile/MobileMessageInput.tsx:124` |
| A11 | P1 | Confirmado: modal mobile transfere para operador; desktop também oferece setor e seleção de contexto de negociações. | Usar o mesmo serviço e a mesma seleção de destinos/contexto nas duas apresentações. | `src/components/mobile/MobileActionsModal.tsx:80`; `src/components/chat/ChatPanel.tsx:4078` e `:4153` |
| A12 | P1 | Confirmado: gerenciador completo de respostas rápidas usa `setActiveView("configuracoes")`. | Esse valor não é um `ViewId` registrado; o módulo canônico é `settings`. Definir o destino real do gerenciador, considerando globais em Acessos e pessoais em Carteira. | `src/components/mobile/MobileMessageInput.tsx:270`; `src/lib/app-routes.ts` |
| A13 | P1 | Risco: ações de mensagens dependem de `group-hover:opacity-100`. | Tornar responder, reagir e marcar evidência descobríveis por toque, preservando restrições de cada mensagem. | `src/components/chat/ChatMessageBubble.tsx:230`, `:248`, `:257`, `:1072` |
| A14 | P1 | Confirmado: componente mobile de áudio usa `MediaRecorder` e identifica o resultado como `audio/webm` fixo. | Detectar formato suportado e conservar MIME/extensão reais; validar prévia, cancelamento, falha, retorno de segundo plano e liberação do microfone. Não presumir falha universal por navegador sem teste. | `src/components/mobile/MobileMessageInput.tsx:163`, `:189` |
| A15 | P1 | Confirmado: composer usa `input` de uma linha e diversas ferramentas na mesma linha. | Planejar texto multilinha, expansão controlada e agrupamento de ferramentas, sem reduzir ações nem limpar conteúdo ao falhar. | `src/components/mobile/MobileMessageInput.tsx:468` |
| A16 | P1 | Risco: offsets fixos `pt-14`, `pb-20` e `pb-16` convivem com compositor de altura variável. | Medir regiões ocupadas; testar anexos, catálogo, nota, negociação obrigatória e teclado para não encobrir mensagens nem botões. | `src/components/mobile/MobileLayout.tsx:67`; `MobileMessageInput.tsx:215` |
| A17 | P1 | Confirmado: hook divide mobile em menos de 768px; CSS global inclui regras em até 768px e densidade de desktop a partir de 768px. | Resolver fronteira e tratar tablet, paisagem e toque independentemente da largura. Testar exatamente 767, 768 e 769px. | `src/hooks/use-mobile.tsx:3`; `src/styles.css:187`, `:202`, `:222` |
| A18 | P1 | Confirmado: `html/body` fixos com overflow oculto e viewport com zoom do usuário bloqueado. | Rever acessibilidade e estratégia de rolagem sem quebrar o shell desktop, portais e teclado. Não aplicar remoção global sem regressão. | `src/styles.css:160`; `src/routes/__root.tsx:240` |
| A19 | P1 | Confirmado: `shouldShowMiniChatWidget` retorna falso em mobile. | Preservar atendimento no contexto do CRM, Início, Tarefas, Clientes e Carteira por apresentação compacta ou transição reversível com retorno ao contexto. | `src/lib/widget-visibility.ts:53`; `src/routes/__root.tsx` |
| A20 | P2 | Confirmado: Tarefas e Monitorar têm calendários e painéis laterais fixos; Kanban CRM tem colunas de no mínimo 330px. | Transformar em composições mobile, sem apenas reduzir escala ou liberar rolagem da página inteira. | `src/components/chat/TasksView.tsx:925`; `MonitorView.tsx:2700`; `src/components/crm/PipelineColumn.tsx:132` |
| A21 | P1 | Confirmado: validação de destino permitido também acontece em efeito da `Sidebar`, que não é montada no mobile. | Levar a proteção de navegação para camada comum, incluindo acesso direto e mudança de permissão. Não atribuir autorização de API ao componente visual. | `src/components/chat/Sidebar.tsx:66`; `src/routes/index.tsx:189` |
| A22 | P2 | Confirmado: manifest tem marca única e orientação portrait; service worker é voltado a push. | Definir identidade da instalação e comportamento em paisagem, validar atualização. Não tratar instalação como suporte offline de negócios: não há implementação de cache offline nesse SW. | `public/manifest.json`; `public/sw.js` |

Essas constatações são de leitura do código. Não se atribui taxa de falha, impacto real em produção ou compatibilidade de aparelho sem reprodução.

## 4. Matriz de cobertura dos 14 módulos

“Compartilhado” significa que o componente é chamado no mobile, não que todas as suas ações estejam homologadas.

| Módulo | Situação mobile encontrada | Escopo obrigatório de paridade | Adaptação principal | Prioridade |
| --- | --- | --- | --- | --- |
| Início comercial | Compartilhado; navegação condicionada a consultor Tecfag. | Abas Todas, Atrasadas, Alta, Hoje e Concluídas; tarefas, indicadores, calendário, diretrizes/evidências e abertura das negociações. | Cards legíveis, filtros recolhíveis, detalhes em tela própria, retorno à posição original. | P1 |
| Atendimentos | Lista e mensagens compartilhadas; cabeçalho, ações e compositor separados. | Filas, canais, busca, paginação, não lidas, fixação, captura/assunção, transferência, finalização, estados de responsável, histórico, mensagens e ficha. | Resolver A05–A16 antes de ampliar exposição. | P0/P1 |
| Negociações / CRM | Não renderizado no shell mobile; detalhe tem rota própria. | Quadro e lista, pesquisa, filtros/ordenação, paginação, criação, movimentação, ganho/perda, ações em lote, configurações autorizadas e detalhes completos. | Lista de cards e quadro navegável por etapa; filtros em painel; mover por ação explícita além do gesto. | P1 |
| Tarefas | Não renderizado. | Mês, semana, dia; filtros, criação, edição, conclusão, reagendamento e vínculos ao cliente/negociação. | Agenda legível como entrada compacta; manter acesso a mês/semana/dia, com seleção e detalhe sequenciais. | P1 |
| Base de Clientes | Compartilhado; já possui cards mobile de contatos e empresas. | Todos, WhatsApp, Instagram, Messenger e Empresas; busca, criação, edição, exclusão/exportação autorizadas, contas, vínculos e históricos. | Comparar card e tabela campo a campo e ação a ação; evitar perder dados e vínculos nos cards. | P1 |
| Minha Carteira | Compartilhado; já possui cards mobile. | Clientes, filtros, retomada de contato, contexto do responsável, templates/respostas pessoais e operações já existentes. | Aproveitar adaptação atual e revisar menus, formulários, estados vazios e paginação. | P1 |
| Gestão Comercial | Compartilhado; item inferior apenas para admin Tecfag. | Consultores, Perfis, Metas, Calendário, Diretrizes, Evidências, Operação e Configurações. | Tabelas operacionais em cards/detalhes; manter edição, associação e ações administrativas com as permissões atuais. | P2 |
| War Room / BI | Renderização prevista; sem item próprio na barra inferior. | Pipeline, De/Para, Previstas, Pacing, Perdas, Ranking, Diretrizes, TMA e Safras; filtros, detalhamentos e controles existentes. | Navegação por nomes, tabelas consultáveis, detalhe completo e rolagem interna controlada. Preservar rotação, pausa e acesso à tela cheia quando suportado. | P2 |
| IA do tenant | Feed no lugar do módulo completo; Tecfag não tem item direto de IA na barra inferior. | Chat e demais abas efetivamente autorizadas: SDR, Rodízio, Fluxos, Supervisor, Vendedor e Conhecimento; histórico/revisão/configurações internas quando habilitados. | Preservar feed como recurso distinto; conversas em tela própria, painéis sequenciais, mover arquivos/pastas sem exigir arrastar. Respeitar o bloqueio de ativação por tenant. | P1/P2 |
| Ligações | Não renderizado; componentes de Voice Score já contêm media queries e regras para toque. | Performance Comercial, Por Vendedor, Análise da Ligação; Dashboard, Agenda, Histórico/Transcrições, Clientes, Campanhas e Objetivos conforme permissões. | Reutilizar o trabalho responsivo existente; assegurar acesso aos dados que o CSS esconde em telas estreitas; validar player e detalhe. | P2 |
| Monitorar | Não renderizado. | Ao Vivo, Alertas, Operadores, Auditorias, Tarefas Globais e Visitantes do site conforme autorização/tenant. | Indicadores empilhados, lista→detalhe, filtros e agenda sem painéis fixos simultâneos. | P2 |
| Estatísticas | Não renderizado; várias grades internas já têm breakpoints. | Visão Geral, Desempenho, SLA/Tempos, Clientes, Relatórios IA e Custos. | Filtros compactos, valores legíveis, gráficos com consulta por toque e tabelas de detalhes. | P2 |
| Acessos | Não renderizado. | Operadores/Usuários, Grupos, Setores, Carteiras Globais e Templates Globais; acesso multiempresa e permissões onde presentes. | Formulários por seções, ações explícitas, revisões antes de salvar permissões e feedback de erro. Manter restrições administrativas. | P2 |
| Ajustes | Não renderizado; seções internas têm adaptação parcial. | WhatsApp Meta/Baileys, Voz, RD Station, CRM, E-mail/Automações, Live Chat e MCP, conforme autorização. | Formulários e diagnósticos em coluna; QR code, copiar configuração, catálogos/campos/funis e ações sensíveis acessíveis. | P2 |

O registro de rotas é referência de inventário, mas não prova sozinho que uma função está ativa. A linha de base deve marcar recursos indisponíveis no próprio desktop e restrições por tenant para não transformar a atualização mobile em ativação de funcionalidades.

## 5. Fluxos transversais que não podem ficar fora do escopo

### 5.1 Sessão, conta e navegação

- Login, restauração da sessão, expiração, acesso negado e retorno ao destino após autenticação.
- Perfil, avatar, senha, status disponível/pausa/desconectado, tema, preferências e logout.
- Troca de empresa somente entre tenants autorizados, com limpeza do contexto anterior e revalidação de dados/cache. Deve existir um caminho acessível independentemente da tela inicial disponível ao perfil.
- URLs diretas de módulos/abas, `/chat/$chatKey`, aliases de assistente, `/crm/deals/$dealId` e `/call/$roomId`.
- Voltar/avançar do navegador, voltar do Android, recarregar, abrir em nova aba e abrir por notificação.
- Retorno CRM↔atendimento e Início↔negociação preservando filtro, etapa, posição, registro e contexto de origem.
- Troca de largura/orientação sem perder rascunho, anexos, seleção, gravação ou ação em andamento. Hoje a troca de composição pode desmontar componentes locais.
- Estados sem módulos autorizados, permissão revogada durante uso e sessão de outra empresa. Nenhum deles deve abrir uma lista alternativa como se fosse o destino solicitado.

### 5.2 Atendimento e mensagens

- Texto curto/longo/multilinha, emojis, links, documentos, imagens, vídeos, áudio, stickers e arquivos do catálogo conforme suporte do canal.
- Seleção múltipla, arquivo sem legenda, arquivo com legenda, cancelamento, progresso e erro; não apagar o rascunho antes de preservá-lo e/ou confirmar aceite.
- Resposta citada, navegação até a mensagem original, reações, evidências e exclusão quando a ação existir e for permitida.
- Respostas rápidas, substituição de variáveis e templates pessoais/globais; não confundir esses textos com templates aprovados da Meta.
- Janela de atendimento Meta aberta/fechada/desconhecida, seleção de template aprovado, parâmetros e resultado do envio.
- Conversa atual versus nota geral do contato; negociação obrigatória, seleção entre múltiplas negociações e mudança de versão/contexto enquanto o operador digita.
- Fila sem responsável, conversa própria, conversa alheia, transferência concorrente, finalizada e eventual retomada pelo fluxo já permitido no desktop.
- Datas, carregamento de histórico antigo, posição na rolagem, novas mensagens enquanto lê o histórico, entrega/leitura, presença e digitação.
- Uma intenção de envio deve continuar ligada ao tenant, operador e conversa de origem mesmo após navegar. Falha ou confirmação ambígua exige recuperação sem envio duplicado.
- Captura, transferência e finalização devem mostrar estado pendente/erro/sucesso real; o fechamento imediato do modal não deve mascarar falha.
- Identificar conversa da IA por identidade estável; revisar a heurística atual que também considera o nome do contato.

### 5.3 CRM, cadastro e contexto comercial

- Manter coerência entre pessoa/empresa, contatos participantes, contato principal, negociação e conversa atual. Testar contatos duplicados vinculados à mesma conta.
- Detalhe da negociação: cabeçalho, responsável, valor, qualificação, etapas, dados laterais, conta e contatos; abas Histórico, E-mails, Tarefas, Questionários, Produtos/Serviços, Arquivos, Conversas e Evidências.
- Incluir proposta comercial, condições/prazo, geração e acesso ao documento nos pontos já existentes; validar upload, visualização e download dos arquivos.
- Jornada RD Marketing, vínculo/sincronização RD CRM, critérios de ganho/perda, motivos e atividades sem alterar contratos do backend.
- Ações em lote: seleção compreensível, escopo, prévia e resultado; não deixar a ação disponível só na tabela desktop.
- Calendários: mês/semana/dia, filtro por responsável, datas, horários, atrasos e reagendamento; manter calendário comercial e tarefas sincronizados com seus contratos atuais.
- Mini chat: garantir abertura da conversa vinculada e retorno ao contexto de origem. Escolher apresentação mobile com o mesmo motor de envio, evitando um quarto fluxo independente.

### 5.4 Notificações, instalação, mídia e rotas independentes

- Validar cadastro da assinatura push, permissão negada, assinatura existente, troca de tenant, logout e clique com sessão expirada ou tenant diferente. O frontend envia identificadores em alguns payloads; a revisão deve confirmar que o servidor continua derivando a autoridade da sessão.
- Conferir os dois formatos atuais de entrada: URL de chat e `/?chatId=...`. Não presumir que a notificação chegará ou navegará corretamente só porque o SW existe.
- Testar navegador normal e instalação na tela inicial, atualização com sessão aberta e carregamento de chunks após deploy.
- Não prometer operação offline. Definir mensagem de desconexão, preservação de rascunhos e revalidação ao reconectar. A fila durável não deve disparar efeitos externos sem política explícita de recuperação.
- Validar microfone, gravador, reprodução, formatos reais, interrupção de gravação, troca de aplicativo, tela bloqueada e retomada. Encerrar tracks e timers ao sair do fluxo.
- `/call/$roomId`: entrada, permissão do microfone, conexão, falha, controles, áudio e encerramento em retrato/paisagem. A chamada usa WebRTC; homologar em ambiente isolado com usuários de teste.
- O widget público em `valem-widget/` tem CSS mobile próprio. Fazer regressão separada se houver mudanças em contratos de mensagens/site; não confundir seu layout com o mobile do operador nem presumir que herda o CSS principal.

## 6. Arquitetura proposta para evitar nova defasagem

### 6.1 Catálogo comum de navegação e resolução de módulos

Criar uma definição compartilhada de módulo: `ViewId`, rótulo, ícone, rota, componente, ordem, seção e regra de disponibilidade. Usar `MODULE_ROUTE_SPECS` e RBAC existentes como base, sem criar outro conjunto de regras de autorização.

Desktop e mobile consomem esse catálogo. A validação de acesso ao destino deve funcionar fora da `Sidebar`, incluindo links diretos, sessão restaurada e alterações de permissões.

No celular, usar barra inferior com poucos destinos frequentes e entrada “Mais” para todos os demais destinos autorizados. A composição exata deve ser validada com os perfis reais; o critério é não haver módulo sem caminho de acesso. Menu e autorização são responsabilidades distintas.

### 6.2 Lógica compartilhada; apresentação adaptável

Extrair incrementalmente políticas e estado do atendimento: disponibilidade do envio, responsável/fila, canal, janela Meta, contexto da negociação, nota, citação, anexos, gravação, fila, pendências e feedback.

O objetivo é o mesmo motor para `ChatPanel`, `MobileMessageInput` e ações equivalentes do `CrmChatWidget`. Primeiro caracterizar o comportamento atual; depois extrair uma responsabilidade por vez. Não reescrever de uma vez o `useChatState` e o `ChatPanel`.

Mesmo quando houver cabeçalho ou compositor próprios para celular, usar o mesmo contrato tipado de envio, incluindo destinatário lógico estável, arquivos, citação, template, intenção e contexto. Preservar idempotência e tratamento de falha já existentes.

### 6.3 Padrões visuais compartilhados

- Página compacta com cabeçalho, filtros, conteúdo e ações; altura disponível e rolagem definidas.
- Lista→detalhe para conteúdos que hoje disputam colunas; preservar acesso a todos os dados e ações.
- Modal/drawer com largura/altura limitadas ao viewport, cabeçalho e rodapé acessíveis, conteúdo rolável, foco e fechamento consistentes. Reutilizar primitivas acessíveis e revisar modais manuais.
- Filtros em painel com quantidade aplicada, limpar/aplicar e estado preservado.
- Tabelas operacionais em cards mais detalhe. Para comparação realmente tabular, permitir rolagem somente dentro da tabela, com identificação de colunas e acesso a todos os campos.
- Quadro Kanban com etapa selecionável e rolagem local; movimentação explícita como alternativa a arrastar. Pointer events já existem no CRM: validar o conflito entre toque, scroll e drag antes de trocar tecnologia.
- Gráficos com consulta por toque e acesso a valores; esconder eixos ou colunas não pode eliminar informação sem um detalhe equivalente.
- Botões com área de toque interna adotada de pelo menos 44×44 CSS px sempre que possível, rótulo acessível e sem dependência exclusiva de hover, tooltip ou clique direito.
- Tipografia legível, foco visível, contraste nos temas, leitor de tela, zoom do usuário e preferência de movimento reduzido.

### 6.4 Larguras, teclado e camadas

Manter a fronteira de 768px inicialmente para limitar impacto, mas uniformizar a inclusão/exclusão do limite e separar três decisões: largura disponível, capacidade de toque e composição da tela. Tablet/paisagem não deve receber automaticamente uma tela desktop espremida.

Tratar altura dinâmica, áreas seguras superior/inferior/laterais e teclado virtual como parte do layout. O espaço reservado deve acompanhar a altura real do compositor e dos banners. Avaliar `VisualViewport` apenas se os testes mostrarem necessidade; `100dvh` sozinho não constitui validação do teclado.

Auditar portais, animações com transform, elementos fixed, z-index, foco e bloqueio de scroll. Um elemento fixed dentro de uma árvore animada precisa ser testado para não sobrepor menus, formulários ou teclado.

Não usar `zoom` global para resolver celular. Preservar os modos de densidade do notebook e testar a interação deles com a fronteira de largura e a orientação.

## 7. Execução em etapas e critérios de passagem

| Etapa | Entrega | Dependência | Critério para avançar |
| --- | --- | --- | --- |
| E0 — Linha de base | Matriz função×tenant×perfil, roteiro desktop atual, estados e telas com dados sintéticos; reconciliação dos recursos habilitados por tenant. | Ambiente isolado e contas de homologação. | Cada função classificada como operante, indisponível no desktop ou proibida para o perfil/tenant. Nenhum teste depende de produção. |
| E1 — Fundação | Catálogo comum, proteção de destino, menu completo, rotas/voltar, padrões de página/modal e layout com teclado/áreas seguras. | E0. | Os 14 módulos estão mapeados; cada destino homologado abre o módulo correto. Destino não habilitado mostra estado explícito, sem cair em conversas. Desktop preservado. |
| E2 — Atendimento | Contrato de envio, anexos, citação, busca, notas, regras de canal/Meta, responsabilidade, transferência/setor, finalização, durabilidade e áudio. | E1; caracterização das regras existentes. | Todos os P0 e fluxos de atendimento passam em Android/iPhone e desktop com os mesmos efeitos e bloqueios. |
| E3 — CRM e tarefas | Quadro/lista, filtros, detalhes, contexto, empresas/contatos, ações em lote, propostas, arquivos, e-mails, agenda e atendimento vinculado. | E2 para ações que enviam mensagens. | Completar criação→movimentação→atividade→contato→conversa→fechamento no celular, com retorno ao contexto e sem perda de dados. |
| E4 — Operação comercial | Início, Carteira, Clientes, oito abas da Gestão Comercial e nove visões do War Room. | E3 para navegação/vínculos; padrões de tabela e calendário da E1. | Todas as ações desktop dessas áreas acessíveis, inclusive detalhamentos, configurações e evidências. |
| E5 — Gestão e recursos especializados | IA autorizada, Ligações, Monitorar, Estatísticas/Relatórios/Custos, Acessos e Ajustes. | E1 e regras/padrões já estabilizados. | Sem função permitida restrita a desktop; sem ativação acidental de IA/canal/campanha. |
| E6 — Dispositivos e resiliência | Push, instalação, rotas independentes, retomada, rede instável, sessão, desempenho, acessibilidade e atualização de versão. | E2–E5; testes de teclado, toque e rede começam desde E1. | Matriz de aparelhos e cenários concluída, falhas documentadas e corrigidas; zero bloqueador de operação/isolamento. |
| E7 — Liberação gradual | Entregas por módulo/tenant/perfil, observação e reversão validada. | Critérios de aceite e regressão aprovados para o lote. | Valem operante, sem regressões desktop, e evidências de uso do lote liberado. |

P2 indica ordem de execução, não exclusão. “Plano concluído” exige fechar todas as etapas. Não fixar prazo antes da E0 e de validar o esforço de CRM, regras de envio, Voice Score e War Room.

### Fatiamento recomendado das alterações

Cada entrega deve ser pequena e revisável: catálogo/permissões; navegação; primitivas compactas; contrato de envio; anexos/citação; política Meta/fila; CRM lista; CRM detalhe; tarefas; demais módulos. Uma mudança de CSS global não deve ser misturada a mudanças extensas de regras de negócio.

Registrar para cada item: responsável, arquivos, dependências, risco, cenário desktop de referência, cenário mobile correspondente, evidência e mecanismo de reversão. Atualizações desktop ocorridas durante a execução entram na matriz para não criar uma nova defasagem antes do término.

## 8. Plano de testes e evidências

### 8.1 Matriz de telas e dispositivos

Larguras em CSS px: 320 como prova de estresse, 360, 375/390, 412/430, 767, 768, 769, 820, 1024, 1366 e 1920. Combinar com alturas reduzidas, retrato/paisagem e teclado aberto; não basta capturar uma imagem por largura.

Homologar em pelo menos um Android físico com Chrome e um iPhone físico com Safari, incluindo navegação instalada quando disponível. Incluir tablet/paisagem, toque em largura grande e desktop com densidades auto/75/85/100. Registrar modelos, versões e dimensões reais utilizadas. Emulação cobre layout; aparelho físico cobre teclado, microfone, arquivos, retomada e permissões.

Usar ambos os tenants e perfis representativos: admin, consultor comercial, operador padrão, perfil sem notas/transferência e perfil com acesso limitado a CRM/abas. Recursos exclusivos são “não aplicáveis” para o outro tenant, e nunca considerados falha de paridade.

### 8.2 Casos obrigatórios de ponta a ponta

| ID | Cenário | Resultado a demonstrar |
| --- | --- | --- |
| T01 | Entrar, restaurar sessão, trocar tenant autorizado, sair e voltar. | Identidade, dados e permissões corretos; nada do tenant anterior permanece visível ou é reenviado. |
| T02 | Abrir cada módulo/aba pelo menu, URL direta e recarregar; usar voltar/avançar. | Destino correto, sem fallback silencioso, sem bloqueio exclusivo do mobile. |
| T03 | Atendimento próprio com texto, multilinha, emoji, arquivo, vários arquivos e legenda. | Todos os conteúdos chegam ao transporte simulado com destinatário/contexto corretos. |
| T04 | Responder mensagem citada, reagir, marcar evidência e consultar original. | Ação acessível por toque e efeito equivalente ao desktop. |
| T05 | Conversa de outro operador, fila, finalizada, permissão de nota ausente e sessão expirada. | UI coerente e API recusando ações proibidas; rascunho preservado. |
| T06 | Meta aberto/fechado e Baileys configurado em ambiente de teste, sem inferir canal pelo tenant. | Fluxo adequado ao canal, template aprovado e parâmetros; não enviar texto comum onde houver bloqueio. |
| T07 | Exigir negociação, selecionar entre várias, registrar nota específica/geral e trocar contexto durante digitação. | Sem notas ou mensagens vinculadas à negociação/contato errado. |
| T08 | Capturar, assumir quando permitido, transferir por operador/setor e finalizar com sucesso/erro/concorrência. | Resultado real confirmado, bloqueios e contexto preservados. |
| T09 | Perder rede antes/depois do aceite, tocar enviar repetidamente, mudar conversa/tenant e recarregar. | Conteúdo recuperável e sem duplicação; confirmação ambígua tratada sem reenvio cego. |
| T10 | Gravar, ouvir quando houver prévia, cancelar, enviar, negar microfone e sair durante gravação. | Arquivo com formato válido, feedback e recursos liberados, sem envio involuntário. |
| T11 | Buscar/paginar conversas e ler histórico enquanto chegam mensagens novas. | Busca funcional, posição coerente e todas as ações acessíveis. |
| T12 | Criar/editar contato e empresa, associar participantes e negociação; consultar histórico e exportar quando permitido. | Mesmos campos, validações e efeitos do desktop. |
| T13 | Criar negociação, filtrar quadro/lista, mover etapa e registrar ganho/perda com validações. | Toque e scroll não causam movimentação involuntária; alternativa explícita funciona. |
| T14 | Usar todas as abas do detalhe, proposta, arquivos/e-mails/questionários/evidências e retornar ao CRM/chat. | Conteúdo e ações completos; retorno conserva contexto. |
| T15 | Criar, concluir e reagendar tarefas em dia/semana/mês; cruzar com calendário comercial. | Datas, responsáveis e vínculos corretos. |
| T16 | Consultar/operar Início, Gestão, War Room, Monitorar, Estatísticas e Relatórios. | Filtros, valores, dados ocultos em telas estreitas e detalhamentos continuam consultáveis. |
| T17 | Administrar acessos/ajustes com perfil autorizado e tentar com perfil restrito. | Mesmas verificações de módulo, aba e ação; sem permissões ampliadas pelo menu mobile. |
| T18 | Usar IA e Ligações autorizadas, player, transcrição e rota de chamada de teste. | Persona correta, navegação completa e mídia funcional; integrações substituídas por doubles quando apropriado. |
| T19 | Receber/clicar push com aplicativo aberto/fechado, tenant diferente e sessão expirada. | Abertura autorizada do destino correto, sem exposição prévia de dados do outro tenant. |
| T20 | Abrir teclado com modal, select, calendário, anexos, catálogo e banner de negociação. | Campo, último conteúdo e ação principal visíveis, sem rolagem presa ou sobreposição. |
| T21 | Girar aparelho, cruzar 768px, alternar aplicativo, bloquear/desbloquear e retomar após inatividade. | Estado consistente, reconciliação de responsável/negociação e ausência de envios tardios indevidos. |
| T22 | Atualizar versão com aba antiga, validar recuperação de chunk, push e sessão. | Atualização recuperável sem perda de rascunho ou confusão de destino. |

### 8.3 Automação e regressão

- A estrutura examinada não apresenta configuração dedicada de Playwright/Cypress nem script E2E de navegador no `package.json`. Implantar cobertura de navegador com dados e rede controlados; não tratar testes estáticos de fonte como comprovação de layout ou toque.
- Reaproveitar `npm run test:access` e testes relevantes de contexto de negociação, mensagens/fila, templates Meta, rotas, persistência de funil, Kanban, comercial, identidade de contatos e recuperação de assets. Antes de executá-los, confirmar os requisitos do runner: há arquivos `.mjs` e `.ts`, e parte dos testes usa imports de Vitest, sem uma configuração correspondente evidente no manifesto analisado.
- Fazer testes de contrato para o envio compartilhado: texto+anexo, citação, nota com versão, template e idempotência. Não criar apenas testes que verificam a presença de classes CSS.
- Em navegador, testar os fluxos T01–T22 com APIs simuladas ou backend de homologação, além de capturas de regressão das telas densas e estados de erro.
- Medir antes/depois: tempo para abrir lista/conversa/detalhe, resposta ao digitar, scroll, memória, requisições e quantidade de listeners/conexões. Definir orçamento com a linha de base, sem inventar limites sem medição.
- Carregar módulos pesados sob demanda. Verificar se esconder um painel apenas por CSS mantém polling, timers ou IA em execução; evitar duplicidade de estruturas e conexões.
- Validar build, tipagem/lint aplicáveis e regressão desktop a cada lote. Para os testes que dependem de banco/integração, confirmar isolamento antes de rodar.

## 9. Riscos de implantação e mitigação

| Risco | Mitigação | Sinal para interromper a liberação |
| --- | --- | --- |
| Alterar lógica compartilhada prejudica atendimento Valem. | Extrair uma responsabilidade por entrega, caracterizar antes e comparar desktop/mobile. | Falha de envio, captura/transferência, contexto ou regressão de operação Valem. |
| Expor no mobile funções desabilitadas ou com acesso indevido. | Catálogo central com política existente; conciliar divergência AGENTS/código; testar sessão/tenant/perfil/aba. | Dados ou ação disponíveis fora do escopo autorizado. |
| Anexos, notas ou mensagens vão para contexto incorreto. | Contrato completo e intenção ligada ao destino; revalidar contexto antes de enviar. | Qualquer perda, duplicação ou associação incorreta. |
| Mudança global em body, zoom ou portais quebra telas antes operantes. | Ajustes locais primeiro; testes de largura/altura/densidade e componentes flutuantes. | Campo/CTA inacessível, scroll preso ou menu fora da tela. |
| Kanban interpreta scroll como movimentação. | Gesto com limiar apropriado e ação explícita; testar cancelamento e concorrência. | Movimentação involuntária ou perda do controle de rolagem. |
| Tabelas/gráficos “adaptados” escondem informações essenciais. | Card/detalhe equivalente; inventário de campos e ações por visão. | Coluna/dado/ação do desktop sem caminho equivalente no celular. |
| Rotação do War Room prejudica consulta e filtros. | Pausa acessível e estado estável durante detalhamento; manter controles existentes. | Tela muda enquanto o usuário executa uma ação. |
| Sessão em segundo plano retorna desatualizada. | Reconciliar sessão, responsável, política Meta e contexto ao retomar; preservar rascunho. | Ação usa dados antigos sem revalidação. |
| API do navegador não cobre determinado recurso em aparelho. | Detectar suporte e testar alternativa; documentar a combinação validada. | Recurso essencial sem alternativa utilizável. |
| Atualização desktop durante o projeto cria nova defasagem. | Matriz e critério de PR obrigatórios para função nova/alterada nos dois formatos. | Entrega nova sem cobertura mobile correspondente. |

A reversão deve ser por módulo/lote, usando sinalizador da interface quando necessário. Não confundir esse sinalizador com habilitação de SDR, canal ou autorização de acesso. Se uma reversão voltar ao mobile antigo, registrar suas lacunas conhecidas; ela recupera a linha de base, não demonstra paridade.

Não planejar migração de banco para resolver layout. Se uma lacuna real exigir alteração de API, separá-la, aplicar o checklist do AGENTS.md e manter compatibilidade com desktop e abas antigas. A alteração do frontend não deve reiniciar canais nem modificar sessões WhatsApp.

## 10. Critérios finais de aceite

- [ ] Os 14 módulos têm decisão registrada de disponibilidade por tenant/perfil, e todos os autorizados têm entrada e renderização corretas no celular.
- [ ] Cada aba, campo relevante e ação desktop operante tem caminho equivalente mobile, inclusive administração e detalhamentos.
- [ ] A05–A10 e demais bloqueadores de atendimento estão resolvidos e cobertos por testes de comportamento.
- [ ] Não há perda/duplicação de conteúdo, envio para destino errado ou perda do contexto de negociação.
- [ ] Não existe ação essencial dependente exclusivamente de hover, atalho de teclado, clique direito ou arrastar.
- [ ] Teclado, áreas seguras, paisagem, densidade e fronteira de 768px estão homologados; não há overflow horizontal na página, exceto regiões deliberadas como quadros/tabelas.
- [ ] APIs continuam aplicando sessão, tenant e permissão; nenhum recurso de IA/canal foi ativado por efeito colateral.
- [ ] Push, rotas diretas, retorno entre módulos, atualização e retomada foram verificados nos aparelhos registrados.
- [ ] Desempenho foi comparado à linha de base; não há novos carregamentos, polling ou listeners duplicados sem necessidade.
- [ ] Desktop continua operante, especialmente Valem, e a reversão do lote foi validada.
- [ ] A matriz de paridade e o roteiro de testes passam a integrar a manutenção das próximas funcionalidades.

## 11. Mapa técnico para a implementação

| Frente | Arquivos e diretórios principais |
| --- | --- |
| Shell, catálogo e rotas | `src/routes/index.tsx`, `src/routes/__root.tsx`, `src/routes/$.tsx`, `src/lib/app-routes.ts`, `src/components/chat/Sidebar.tsx` |
| Shell mobile | `src/components/mobile/MobileLayout.tsx`, `MobileBottomNav.tsx`, `MobileHeader.tsx`, `MobileActionsModal.tsx`, `MobileMessageInput.tsx`, `ValentinaFeed.tsx` |
| Políticas e estado | `src/hooks/usePermissions.ts`, `src/lib/rbac.ts`, `src/hooks/useChatState.tsx`, `src/lib/ai-persona.ts` |
| Atendimento | `src/components/chat/ChatList.tsx`, `ChatPanel.tsx`, `ChatMessageBubble.tsx`, `SharedFiles.tsx`, `MetaTemplateSelectModal.tsx`, `QuickResponsesPopover.tsx`, `ProductCatalogPicker.tsx` |
| CRM e contexto | `src/components/crm/CrmView.tsx`, `CrmToolbar.tsx`, `PipelineBoard.tsx`, `PipelineColumn.tsx`, `DealCard.tsx`, `DealList.tsx`, `DealDetailModal.tsx`, `ConversationDealContext.tsx`, `ConversationDealRequirement.tsx`, `CrmChatWidget.tsx`, demais dialogs/drawers em `src/components/crm/` |
| Clientes/carteira/tarefas | `src/components/chat/ContactsView.tsx`, `WalletView.tsx`, `TasksView.tsx`, `src/components/crm/AccountDetailModal.tsx`, `CreateTaskModal.tsx` |
| Comercial | `src/components/commercial/` — Home, Management, Bi, tabelas, filtros, configurações e detalhamentos |
| IA e voz | `src/components/valentina/`, `src/components/voice/`, incluindo `voice-score/voice-score.css` e `VoiceScoreModule.tsx` |
| Gestão e administração | `src/components/chat/MonitorView.tsx`, `AnalyticsView.tsx`, `GroupsView.tsx`, `SettingsView.tsx`, `src/components/reports/`, componentes de integrações relacionados |
| Layout e acessibilidade | `src/styles.css`, `src/hooks/use-mobile.tsx`, `src/hooks/useDensity.ts`, primitivas em `src/components/ui/` |
| Contexto e instalação | `src/lib/widget-visibility.ts`, `src/components/chat/ProfileModal.tsx`, `PushNotificationPrompt.tsx`, `public/manifest.json`, `public/sw.js`, recuperação de assets e filas locais existentes |
| Rotas independentes | `src/routes/chat/$chatKey.tsx`, `src/routes/crm/deals/$dealId.tsx`, `src/routes/call/$roomId.tsx` |
| Widget público e validação | `valem-widget/src/`, `test/`, scripts de teste do `package.json` |

As linhas das evidências são referências do checkout analisado e podem mudar durante a execução. O próximo trabalho previsto é E0/E1, começando pela matriz verificável e pelos fluxos de envio que bloqueiam uma liberação segura; este documento não autoriza nem executa a implementação.

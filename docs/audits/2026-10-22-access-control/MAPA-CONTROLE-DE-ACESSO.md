# Mapa de controle de acesso — Valem Chat / Tecfag Chat

Data: 22/10/2026. Escopo: código presente neste checkout, incluindo alterações locais preexistentes.

## Conclusão

O sistema possui uma base de grupos e permissões, mas **ainda não oferece um controle de acesso completo, uniforme e confiável por módulo, ação e registro**. A preocupação levantada procede: visualizar, editar, excluir e administrar dados de terceiros são conceitos que hoje aparecem misturados ou são verificados somente em alguns caminhos.

O principal problema não é apenas faltar opções na tela. Há três problemas simultâneos:

1. Permissões necessárias ainda não existem no modelo, como excluir negociações separadamente de editar, acesso a funis específicos e seleção das filas visíveis.
2. Permissões existentes não chegam corretamente ao painel ou não são respeitadas por todas as APIs.
3. Existem exceções e padrões permissivos que podem prevalecer sobre a restrição configurada.

**Ocultar um módulo atualmente não constitui garantia de impedir acesso aos seus dados ou ações.** Também não é possível tratar dois administradores como perfis administrativos restritos de forma consistente: várias verificações dão passe livre ao papel `admin`.

## O que foi efetivamente analisado

- Inventário de **163 arquivos em `src/routes/api/` e 273 handlers HTTP**, excluindo OPTIONS: 126 GET, 95 POST, 21 PATCH, 26 DELETE e 5 PUT.
- Modelo central de **78 campos de permissão**, em dez blocos: 77 booleanos e um escopo de contatos.
- Sessão, resolução de grupo, compatibilidade com grupos antigos, papéis e grupos multiempresa.
- Painel de grupos, navegação desktop/mobile, links diretos, controles de chat e principais telas de CRM.
- Serviços de CRM, filtros, ações em massa, exportação, histórico, anexos, vínculos e agenda.
- Fluxo de conversas, captura, transferência, encerramento, mensagens, mídias, SSE e WebSocket do Live Chat.
- APIs de contatos, carteiras, tarefas, gestão, IA, voz, integrações, modelos e manutenção.
- **14 verificações offline** executadas sobre funções e handlers reais, com autenticação, banco e serviços substituídos por simulações.

O inventário completo de handlers está em [INVENTARIO-ROTAS.md](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/docs/audits/2026-10-22-access-control/INVENTARIO-ROTAS.md>). O catálogo dos 78 campos e suas referências está em [MATRIZ-PERMISSOES.md](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/docs/audits/2026-10-22-access-control/MATRIZ-PERMISSOES.md>). As evidências das simulações estão em [validacoes-offline.json](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/docs/audits/2026-10-22-access-control/validacoes-offline.json>).

Limites: esta análise não consultou o banco, não enumerou pessoas/grupos reais, não fez requisições de exploração ao ambiente publicado e não confirmou qual commit está implantado. Portanto, descreve o comportamento deste código e os riscos se ele estiver em uso; não afirma que alguém explorou as lacunas. Serviços simulados confirmam que a autorização de uma rota deixa uma chamada passar; regras de negócio posteriores podem ainda recusar uma operação específica. Nos principais casos, o serviço também foi inspecionado para verificar a ausência da restrição de responsável.

Nenhuma configuração operacional, credencial, dado de cliente, rotina em produção ou implementação de permissões foi alterada.

## Como o acesso é decidido hoje

| Camada | Implementação atual | Consequência |
|---|---|---|
| Entrada na empresa | Conta global, grupo multiempresa e vínculo local de operador | Define em quais empresas a conta pode entrar; não define permissões de CRM/chat |
| Sessão | Cookie HttpOnly/token, sessão no banco, operador do tenant e grupo local | Há uma base central de autenticação e tenant disponível para as rotas |
| Papel do operador | `operators.role`, normalmente `admin`/`agent`; várias APIs também aceitam `supervisor` | O papel funciona como atalho independente do grupo |
| Grupo local | Um `groupId` por operador, flags legadas e JSON `permissions` | O grupo configura permissões, mas não é autoridade única |
| Navegação | `views.*` e filtros de abas no frontend | Esconde partes da interface, sem bloquear automaticamente as APIs |
| Ações | Flags específicas em algumas rotas, papel fixo em outras, apenas sessão em outras | O mesmo perfil pode receber tratamentos diferentes conforme o endpoint |
| Escopo dos dados | Tenant; em alguns caminhos também responsável ou carteira | Não existe uma política única de próprios/equipe/setor/funis autorizados |
| Eventos | SSE e Live Chat distribuem eventos por tenant | O escopo interno de cada operador não é aplicado de forma geral |

Arquivos centrais: [src/lib/auth-session.ts](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/lib/auth-session.ts>), [src/lib/rbac.ts](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/lib/rbac.ts>), [src/hooks/usePermissions.ts](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/hooks/usePermissions.ts>), [src/hooks/useChatState.tsx](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/hooks/useChatState.tsx>), [src/lib/platform-access.ts](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/lib/platform-access.ts>) e [src/routes/api/platform/access.ts](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/routes/api/platform/access.ts>).

Os presets Administrador, Supervisor, SDR, Vendedor e Suporte são conjuntos de permissões. **Aplicar o preset “Supervisor” a um grupo não transforma o `role` dos operadores em `supervisor`.** Isso explica uma classe de conflitos: a tela libera uma aba pelo grupo, mas a API exige papel `admin` ou `supervisor`.

## Respostas diretas aos cenários levantados

| Necessidade | Situação atual |
|---|---|
| Separar ver, criar, editar, mover e fechar negociações | Existem flags no código, mas faltam controles individuais no painel e aplicação uniforme |
| Permitir editar, mas impedir excluir negociação | Não está separado: ações em massa de lixeira e exclusão permanente usam `canEditDeals` |
| Ver negociações alheias sem editar | Não há escopo independente por ação; a leitura é restringida em alguns caminhos, a edição não repete essa regra |
| Acrescentar informação sem poder apagar/modificar informação existente | Não há esse nível de permissão para atividades, arquivos, contatos vinculados e outros componentes |
| Alterar apenas a própria negociação | A listagem principal pode restringir a leitura, mas o PATCH não valida dono e os serviços examinados não corrigem isso |
| Liberar determinados funis para determinados grupos | Não existe autorização por funil; quem pode ver CRM consulta os funis do tenant |
| Administrar um funil, mas não os demais | Não há esse escopo; `canManagePipelines` é global para os funis do tenant |
| Criar funil, mas impedir excluir funil | Mesma permissão ampla de gerenciamento cobre essas ações |
| Ocultar módulo inteiro de um administrador e manter os demais | Algumas flags de menu funcionam, mas exceções de interface e bypass de `admin` no servidor impedem garantir a restrição completa |
| Operador ver só “Meus”, sem Todos/Fila/Bot/Fim | Não há conjunto de filas autorizadas; as cinco abas são fixas |
| Operador ver apenas fila/setor/canal autorizado | Setor e canal existem nos dados, mas a política não é imposta de ponta a ponta |
| Ver apenas números/resultados da própria equipe | Não existe escopo gerencial uniforme; várias APIs liberam o tenant pelo papel |

## Negociações e todos os seus componentes

As nove permissões atuais de CRM são `canViewCrm`, `canViewAllDeals`, `canCreateDeals`, `canEditDeals`, `canMoveStages`, `canCloseDeals`, `canManagePipelines`, `canManageProducts` e `canManageProposals`.

| Recurso/ação | Verificação atual | Lacuna |
|---|---|---|
| Listagem de negociações | `canViewCrm`; força responsável da sessão quando não pode ver todos | Boa proteção neste caminho, mas não é compartilhada automaticamente pelos demais |
| Ficha principal | `canViewCrm`; bloqueia dono diferente se `canViewAllDeals=false` | Negócios sem responsável passam na condição; regra difere da listagem |
| Editar ficha | Verifica algumas flags conforme os campos enviados | Não verifica dono, funil autorizado nem acesso ao registro antes da alteração |
| Trocar vendedor/responsável | `canEditDeals` | Não há permissão específica de reatribuição |
| Trocar funil | `canEditDeals`; valida existência e tenant do destino | Não há autorização do operador para origem/destino; troca pode escolher etapa inicial sem verificar `canMoveStages` na rota |
| Mover etapa | `canMoveStages` quando `stageId` é enviado | Serviço pode converter etapa terminal em ganho/perda sem a rota exigir fechamento pelo estado efetivo |
| Ganhar/perder | `canCloseDeals` quando o body traz `won`/`lost` | Pausar/reabrir e alterar motivos não recebem o mesmo controle; não há permissões próprias |
| Arquivar/lixeira/excluir permanentemente | Rota bulk exige `canEditDeals` | Sem permissão de exclusão, sem restrição de responsável imposta pela sessão |
| Alterações em massa | `canEditDeals` | Não recompõe as permissões individuais de mover/fechar/criar; aceita seleção por filtros fornecidos pelo cliente |
| Exportação CSV/Excel | `canViewCrm` | Sem `canExportDeals`; sem forçar o escopo de responsável; serviço pode exportar todo o tenant |
| Notas e tarefas comerciais | Leitura: `canViewCrm`; escrita/remoção: `canEditDeals` | Não verifica dono do negócio; não separa adicionar, editar, concluir, atribuir e excluir |
| Imutabilidade de notas | Serviço impede editar/excluir atividades do tipo `note` | Regra de negócio real e positiva; não substitui a autorização para incluir nota em negócio alheio |
| Contatos vinculados | Leitura CRM; associação/remoção com edição CRM | Sem permissões independentes e sem regra geral de acesso ao negócio |
| Conversas vinculadas | Alguns fluxos verificam responsável; outros usam apenas edição | Associação, desassociação, leitura e captura precisam da mesma política dos dois recursos |
| Evidências de mensagens | Leitura CRM; marcar/desmarcar com edição CRM | Sem autorização independente e sem escopo geral do negócio/conversa |
| Arquivos: lista/download/upload/exclusão | Leitura CRM ou edição CRM | Não separa baixar, anexar e excluir; subrotas não repetem a restrição do dono |
| Produtos na negociação | Inclusão/remoção com edição CRM | Gerenciar catálogo e alterar itens do negócio são decisões diferentes |
| Propostas | `canManageProposals` para criação/mudança de status | Sem separação de elaborar, enviar/aprovar e alterar status; escopo do negócio não é central |
| Questionários | Leitura CRM; preenchimento com edição CRM | Sem distinção entre ler, preencher e sobrescrever |
| E-mails e envio | Leitura CRM; registro/envio com edição CRM | Envio externo não tem permissão própria |
| Prioridade por IA | Edição CRM | Falta permissão específica e verificação de acesso ao negócio |
| Agenda CRM | Leitura CRM; `operatorId` é filtro solicitado | Não força “somente meus” conforme `canViewAllDeals` |
| Busca global CRM | Negociações respeitam restrição de responsável | Contatos/empresas não recebem o mesmo escopo de carteira nessa busca |
| Histórico de ações global | Exige `admin` | Não há delegação granular por equipe/funil nem trilha geral de acessos negados |

Evidências principais: [src/routes/api/crm/deals.ts:65](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/routes/api/crm/deals.ts:65>), [src/routes/api/crm/deals/$dealId.ts:44](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/routes/api/crm/deals/$dealId.ts:44>), [src/routes/api/crm/deals/$dealId.ts:72](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/routes/api/crm/deals/$dealId.ts:72>), [src/routes/api/crm/deals/bulk.ts:34](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/routes/api/crm/deals/bulk.ts:34>), [src/routes/api/crm/deals/bulk.ts:78](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/routes/api/crm/deals/bulk.ts:78>), [src/lib/crm/crm-service.ts:3525](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/lib/crm/crm-service.ts:3525>), [src/lib/crm/crm-service.ts:4082](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/lib/crm/crm-service.ts:4082>), [src/lib/crm/crm-service.ts:6944](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/lib/crm/crm-service.ts:6944>).

Exemplo confirmado offline: com `canViewAllDeals=false`, a ficha de um negócio do operador B retornou 403 para o operador A. O PATCH de título chegou a `updateDeal` com o mesmo operador A e o mesmo negócio B. A leitura de atividades desse negócio também chegou ao serviço. O serviço de edição examinado valida tenant e dados relacionados, mas não compara o responsável com o autor para autorização.

## Funis, etapas e configurações do CRM

| Recurso | Situação atual | Controle que falta |
|---|---|---|
| Funil | Lista por tenant; criação, edição e exclusão com `canManagePipelines` | Lista autorizada de funis por grupo; ações e administração por funil |
| Etapas | Mesma permissão de gerenciamento | Criar, editar, excluir, ordenar e configurar transições separadamente |
| Resumo de etapas | Tem restrição de responsável | Deve usar a mesma política da listagem e dos demais agregados |
| Campos obrigatórios/regras de etapa | Validações de negócio existentes | Permissão de administrar regras; não confundir obrigatoriedade com autorização |
| Campos personalizados | Criação/alteração exige `admin` | Permissão delegável de configuração; visibilidade e edição por perfil/campo |
| Catálogos: fonte, campanha, motivos etc. | Há política própria `allowUserCreate`; administração exige `admin` | Consolidar a exceção com o grupo, sem perder a regra operacional existente |
| Produtos de catálogo | `canManageProducts` | Separar consulta, criação, alteração, inativação e dados sensíveis de preço |
| Importação/sincronização RD | Escrita normalmente `admin`; algumas leituras só sessão | Delegação específica e isolamento de dados/diagnósticos por módulo |

O schema de `crmPipelines` não possui associação de acesso a grupos, operadores ou setores. Não foi localizada uma tabela/política de autorização por funil no caminho analisado. Regras de exibição/obrigatoriedade de campos por funil/etapa são regras de formulário; não são controle de quem pode ver ou modificar o campo.

## Conversas, filas e atendimento

| Dimensão | O que existe | Limitação atual |
|---|---|---|
| Abas Meus/Todos/Fila/Bot/Fim | Lista fixa em `ChatList.tsx` | Não é possível configurar quais abas cada grupo pode acessar |
| “Ver todos os chats” | Flag `canViewAllChats` | Não é aplicada à listagem geral nem ao histórico paginado de mensagens |
| “Meus” | Filtro visual de operador; API filtra dono se receber `queue=meus&mine=1` | O cliente escolhe usar o filtro; não constitui restrição obrigatória do servidor |
| Canal | `allowedChannels` no grupo e filtro no estado React | API geral e SSE não impõem o conjunto autorizado; painel não oferece Live Chat como canal individual |
| Setor | Setores têm membros e conversas têm `sectorId` | Não há filtro obrigatório de leitura/captura pelos setores do operador |
| Histórico de mensagens | Sessão + conversa do tenant | Sem autorização por dono, fila, setor ou canal |
| Espelhamento de mensagens na gestão | Sessão + tenant + ID da conversa | Também permite caminho de leitura sem escopo interno de operador |
| Mídia de mensagens | Sessão + arquivo do tenant | Sem verificação de acesso à conversa associada |
| Capturar/assumir/transferir | Há regras distintas em `update-queue` | Boa base; falta integrá-las à visibilidade e ao escopo de canal/setor |
| Encerrar | Exige permissão e ser responsável na rota de fila | Inclusive admin precisa ser o dono nesse caminho; comportamento deve ficar claro na política |
| Enviar mensagem | Rotas unificadas exigem atendimento capturado pelo autor | Proteção positiva; não corrige a leitura geral aberta |
| Nota interna | Flag de nota e regras pontuais | Não há escopo configurável de quem pode ler notas internas |
| Reação à mensagem | Rota valida tenant/recurso | Falta autorização explícita de ação e escopo da conversa |
| Editar cadastro/tags | Há flags no modelo e verificações parciais de cadastro | `canManageTags` não é aplicado de modo independente na alteração de contato |
| Trocar carteira | Flag no modelo | Rota `contacts/update-wallet` verifica sessão/tenant, não a permissão de carteira |
| Parar a IA de um atendimento | Ação `stop` no SDR antes da restrição global de admin | Não exige permissão específica nem dono nesse caminho |
| Alterar contagem de não lidas | Sessão + tenant | Sem política de acesso à conversa; contador é do registro compartilhado |
| Links diretos | Existem resoluções por ID/telefone | Precisam consultar o mesmo escopo de conversa da listagem/histórico |

Evidências: [src/components/chat/ChatList.tsx:159](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/components/chat/ChatList.tsx:159>), [src/hooks/useChatState.tsx:1564](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/hooks/useChatState.tsx:1564>), [src/routes/api/chats.ts:272](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/routes/api/chats.ts:272>), [src/routes/api/chats/$chatId/messages.ts:13](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/routes/api/chats/$chatId/messages.ts:13>), [src/routes/api/gestao/messages.ts:25](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/routes/api/gestao/messages.ts:25>), [src/routes/api/chats/update-queue.ts:79](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/routes/api/chats/update-queue.ts:79>), [src/routes/api/contacts/update-wallet.ts:23](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/routes/api/contacts/update-wallet.ts:23>).

O perfil solicitado — “este operador só vê Meus, pode responder e finalizar os seus, não vê Fila, Bot, Todos nem Fim” — **ainda não é representável e garantido pelo sistema atual**.

## Módulos administrativos, gestão e demais áreas

| Módulo | Interface atual | Servidor atual | Avaliação |
|---|---|---|---|
| Chat | Flag de módulo; filas fixas | Regras de leitura e ação desiguais | Parcial |
| Início Comercial | Visibilidade depende de ser consultor do tenant aplicável | CRM + validação do perfil; outro consultor exige admin | Flag `views.commercialHome` é ignorada no caso especial do hook |
| Gestão Comercial | Menu condicionado a tenant/papel + flag | Várias rotas exigem admin | Sem delegação detalhada nem restrição de administrador pelo grupo |
| War Room/BI comercial | Menu + flag | Papel admin | Mesma limitação; sem escopo de equipe/funil consistente |
| Negociações | Flag de módulo | Flags CRM; falhas de registro e subrecursos | Parcial e prioritário |
| Tarefas | Flag de módulo | Leitura própria em parte; PUT só sessão e tenant | Não controla integralmente alteração de tarefas alheias |
| Base de clientes | Criar/editar com flags | Listagem respeita carteira; leitura por ID e outros caminhos não | Escopo de carteira incompleto |
| Minha Carteira | Menu consulta `views.wallet` | Há rotas só com sessão para reatribuição | Painel grava `views.wallets`, uma chave diferente |
| Hub de IA | Abas com flags | Leituras só sessão e escritas por papel em vários endpoints | Habilitar aba não garante API; desligá-la não bloqueia todas as APIs |
| Rodízio | Abas/flags de acesso e gestão | Gestão global exige admin | Falta delegação conforme grupo e escopo |
| Base de conhecimento | Flags de acesso/gestão | Leitura com sessão, escrita admin/supervisor; excluir admin | Permissões da interface e da API divergem |
| Revisão industrial | Política específica de autor, dono, ciclo e campos | Verificações próprias e bloqueios de estado | Exemplo existente de autorização contextual mais completa; não é a política geral do sistema |
| Ligações | Abas com flags, algumas chaves incompatíveis | Mistura sessão, papel e endpoints sem autenticação | Prioridade alta/crítica |
| Monitoramento/QA | Abas com flags | Predomina papel admin/supervisor; mensagens/tarefas só sessão | Sem autorização consistente pelas flags e equipes |
| Estatísticas | Abas com flags | Predomina papel admin/supervisor | Custos/relatórios não obedecem à delegação granular do painel |
| Grupos e equipe | Abas de operadores, grupos, setores e carteiras | Operadores/grupos exigem admin; setores não | Sem separação confiável de administrar usuários/grupos/setores |
| Templates pessoais | Separados dos templates globais | Escrita identifica dono; exclusão admite admin | Proteção por autoria existente; contrato próprio deve ser preservado |
| Respostas rápidas/templates Meta globais | Uso de `canManageGlobalTemplates` | Verificação explícita em respostas rápidas e templates Meta | Parte mais alinhada ao modelo, ressalvado bypass admin |
| Ajustes/integrações | Abas com flags | Escritas geralmente admin; várias leituras só sessão | Delegação de configurações não implementada uniformemente |
| Acesso multiempresa | Painel e grupo global separados | Gestor global registrado + papel admin | Distinção importante; não deve ser substituída por grupo operacional local |
| Manutenção/reset | Fora da operação normal | Bloqueado em produção; admin em desenvolvimento | Proteção positiva existente |

## Defeitos concretos no painel de permissões

Foram identificadas **15 chaves incompatíveis** entre checkboxes individuais do painel e o modelo central:

| Painel grava | Modelo consulta |
|---|---|
| `views.wallets` | `views.wallet` |
| `chat.canChangeWalletOperator` | `chat.canChangeWallet` |
| `ligacoes.canAccessHistorico` | `ligacoes.canAccessHistory` |
| `ligacoes.canAccessClientes` | Não há equivalente; a aba clientes retorna permitido no hook |
| `ligacoes.canManageCampanhas` | `ligacoes.canManageCampaigns` |
| `ligacoes.canManageObjetivos` | `ligacoes.canManageObjectives` |
| `monitor.canAccessOperators` | `monitor.canAccessRanking` |
| `monitor.canAccessSite` | `monitor.canAccessSiteVisitors` |
| `analytics.canAccessReports` | `analytics.canAccessAiReports` |
| `security.canManageGroups` | `security.canManageAccessGroups` |
| `settings.canAccessWhatsappSettings` | `settings.canManageWhatsapp` |
| `settings.canAccessVozSettings` | `settings.canManageVoiceSettings` |
| `settings.canAccessRdSettings` | `settings.canManageRdCrmSettings` |
| `settings.canAccessEmailSettings` | `settings.canManageEmailSmtp` |
| `settings.canAccessLiveChatSettings` | `settings.canManageLiveChatSettings` |

`updateGroupGranular` aceita a chave como string, escreve essa chave no JSON e o normalizador reconstrói somente as chaves conhecidas. Assim, um checkbox individual pode não alterar a permissão efetivamente consultada. Ações “Marcar todos/Desmarcar” operam sobre as chaves normalizadas e podem ter efeito diferente dos controles individuais.

Outras lacunas do painel:

- As nove permissões de CRM não têm seção individual de configuração; os presets podem preenchê-las, mas isso não fornece a escolha granular solicitada.
- Gestão Comercial e War Room não aparecem como checkboxes próprios do módulo; `commercialHome` aparece condicionalmente, mas a decisão especial do hook ignora a flag.
- `canDeleteMessages` e `canAccessTeamTasks` não têm controle individual correspondente.
- O canal Live Chat existe no modelo, mas não aparece entre os seletores de canal desse painel.
- As abas de equipe não são separadas de forma geral por `canManageUsers`, `canManageAccessGroups`, `canManageSectors` e `canManageWallets`; há controle específico de templates globais.
- Falha ao salvar grupo é capturada com log, sem desfazer a alteração otimista na tela; aplicar preset pode mostrar sucesso mesmo quando a persistência falhou.
- Ao excluir grupo, o frontend escolhe um grupo substituto, enquanto o servidor grava `groupId=null`; o comportamento efetivo após recarregar é diferente.

Evidências: [src/components/chat/GroupsView.tsx:810](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/components/chat/GroupsView.tsx:810>), [src/components/chat/GroupsView.tsx:906](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/components/chat/GroupsView.tsx:906>), [src/components/chat/GroupsView.tsx:1595](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/components/chat/GroupsView.tsx:1595>), [src/components/chat/GroupsView.tsx:1880](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/components/chat/GroupsView.tsx:1880>), [src/components/chat/GroupsView.tsx:2080](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/components/chat/GroupsView.tsx:2080>), [src/components/chat/GroupsView.tsx:2142](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/components/chat/GroupsView.tsx:2142>), [src/hooks/useChatState.tsx:1021](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/hooks/useChatState.tsx:1021>).

## Achados que precisam orientar a implementação

Prioridades: P0 = exposição grave ou operação perigosa sem barreira adequada; P1 = quebra de escopo/autorização essencial; P2 = granularidade, administração e consistência operacional.

| ID | Prioridade | Achado | Consequência prática |
|---|---|---|---|
| A01 | P0 | Fallback de grupo ausente assume permissões administrativas | Usuário sem grupo pode receber direitos muito mais amplos que o pretendido |
| A02 | P0 | Grupos sem views/chat granulares e casos legados administrativos herdam base administrativa | Permissão omitida pode conceder em vez de negar; flags antigas ainda podem sobrescrever itens específicos |
| A03 | P0 | Exclusão de grupo deixa operadores sem grupo e aciona A01 | Excluir um grupo restrito pode ampliar os direitos de seus membros |
| A04 | P0 | `voice-objectives` GET/POST/PUT usam tenant do cliente sem sessão | Consulta/alteração de configuração de voz fora do controle local; GET também pode criar templates |
| A05 | P0 | `voice-enrich-contact` não autentica e modifica contato por ID sem tenant | Risco de alteração transversal; também cria tarefa com tenant recebido no body |
| A06 | P0 | Disparo outbound e APIs de chamadas não têm autenticação de operador adequada | Risco de disparos/custos e controle de chamadas fora das permissões; serviço outbound consulta configuração sem tenant |
| A07 | P1 | `admin` ignora `requirePermission` e `requireCrmPermission`; várias rotas usam apenas papel | Não permite construir administrador restrito de forma garantida |
| A08 | P1 | Listagem/mensagens/mídias/eventos não compartilham escopo de conversa | Operador limitado pode acessar dados que a política pretendida deveria ocultar |
| A09 | P1 | Escrita/subrecursos do CRM não compartilham escopo de negociação | É possível autorizar escrita ou leitura parcial onde a ficha principal seria negada |
| A10 | P1 | Bulk e exportação não recompõem permissões e escopo | Edição pode autorizar exclusão, criação, movimentação ou fechamento; leitura pode permitir exportação ampla |
| A11 | P1 | Verificação de PATCH se baseia em campos do body, não na mudança efetiva | Reabrir/pausar e motivos sem checagem equivalente; etapa terminal pode gerar fechamento |
| A12 | P1 | Setores e carteiras têm mutações só com sessão | Usuário logado pode alterar configuração/atribuição sem a flag correspondente |
| A13 | P1 | Escopo de contatos não é uniforme entre lista, detalhe, empresas e busca CRM | “Somente minha carteira” não é uma garantia por todos os caminhos |
| A14 | P1 | PUT de tarefas não exige permissão nem autoria/responsável | Pode mudar estado de atividade alheia dentro do tenant |
| A15 | P1 | SSE distribui eventos do tenant, inclusive replay de QR quando existente | Dados operacionais e de conexão podem alcançar operadores sem autorização específica |
| A16 | P1 | WebSocket de operador Live Chat valida sessão/tenant na entrada, sem política granular por ação | Snapshot e ações não usam as permissões de visita/chat; não há revalidação equivalente a cada ação |
| A17 | P1 | Exceções “master” por nome/e-mail na interface | Nome/e-mail editáveis não devem conceder privilégios; este atalho por si só não altera o papel no servidor |
| A18 | P1 | Cadastro de push aceita tenant e operador do cliente sem sessão | Inscrição pode ser vinculada a operador informado por terceiro; revisar distribuição de conteúdo das notificações |
| A19 | P1 | 15 checkboxes gravam chaves diferentes das lidas | Administrador não consegue confiar no efeito individual de sua configuração |
| A20 | P2 | Funis, ações de edição/remoção, filas e equipes não têm escopos suficientes | Falta a granularidade solicitada mesmo após corrigir falhas de aplicação |
| A21 | P2 | Histórico de segurança e explicação de acesso incompletos | Não há trilha uniforme de antes/depois de grupo/perfil e negações nem consulta de permissões efetivas |
| A22 | P2 | Estado otimista e atualizações de sessão não formam um contrato único de revogação | Interface pode divergir do servidor; reconciliação de permissões depende do endpoint de ownership do chat |
| A23 | P0 | PUT da agenda de voz repassa campos arbitrários, inclusive `tenantId`, ao UPDATE | Um operador autenticado pode tentar transferir registro do tenant da sessão para outro tenant válido; falta lista de campos permitidos |

Detalhes relevantes dos achados:

- `normalizeGroupPermissions(null)` retorna o conjunto administrativo. O carregador de sessão também escolhe um grupo administrativo quando não encontra o grupo do operador.
- O normalizador considera administrativo o grupo sem `views`/`chat` granulares, alguns IDs legados, certos nomes e flags antigas. Campos explicitamente definidos podem negar itens; o risco está nos campos ausentes e no padrão adotado.
- A exclusão de grupo faz `groupId=null` no servidor. O schema também usa `ON DELETE SET NULL` no vínculo do operador.
- O atalho de interface “master” usa correspondência de nome/e-mail; o próprio perfil permite alterar nome e, para algumas contas, e-mail. Isso libera menus na interface, sem demonstrar por si só escalada do papel de servidor.
- O módulo de voz contém credenciais embutidas no fonte em caminhos examinados. Os valores não são reproduzidos neste relatório nem foram utilizados. É necessário tratar esse ponto na correção de voz e planejar eventual rotação sem interromper a operação.
- Callbacks de provedores não devem simplesmente receber `requireSession`: precisam de autenticação própria, assinatura/token e vínculo confiável com tenant/chamada. Os caminhos de voz precisam dessa revisão; Meta e RD já possuem exemplos de contratos públicos explícitos.
- A análise não encontrou uma barreira global de autenticação/autorização que compensasse essas lacunas: [src/start.ts](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/start.ts>) contém middleware de erro, e [src/server.ts](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/server.ts>) delega o atendimento das rotas.

Na agenda de voz, o WHERE usa corretamente o tenant da sessão, mas o SET recebe `...updates` do cliente. Filtrar a origem não impede que o próprio campo tenant seja modificado. A simulação confirmou que um `tenantId` fornecido no body chega ao banco simulado; nenhuma transferência real foi executada.

No Live Chat industrial, as ações diretas legadas de enviar/assumir/devolver/fechar são bloqueadas e remetidas ao módulo de Conversas. A lacuna de política granular permanece no acesso ao snapshot/eventos e nos fluxos legados autorizados apenas pela conexão.

## Resultados das verificações offline

Estes cenários executaram funções/handlers do código atual. As respostas 200 indicam passagem na autorização do handler e chamada ao serviço/banco simulado, sem operação real. Os casos de controle com 403 mostram que a simulação também identifica bloqueios existentes.

| Cenário | Resultado observado |
|---|---|
| Normalizar grupo ausente | Permissões administrativas |
| Normalizar grupo sem JSON granular, com flags antigas de usuários negadas | Gerenciar usuários ficou negado, mas gerenciar funis/ver todos os negócios ficaram permitidos por fallback |
| Normalizar grupo apenas com bloco CRM, sem views/chat | Campos omitidos herdaram base administrativa; negativa CRM explícita foi preservada |
| Admin com edição CRM negada | Helper autorizou |
| Agente com edição CRM negada | Helper retornou 403 |
| PATCH somente `status=open`, sem direitos CRM | Handler chamou updateDeal e retornou 200 |
| PATCH de título de negócio alheio, sem ver todos | Handler chamou updateDeal e retornou 200 |
| GET da ficha desse mesmo negócio alheio | Retornou 403 |
| Exclusão permanente em massa com permissão de edição | Handler chamou bulkUpdateDeals e retornou 200 |
| Exportação ampla com leitura CRM e sem ver todos | Serviço recebeu filtros sem recorte obrigatório do operador |
| Leitura de atividades do negócio alheio | Handler chamou getDealActivities e retornou 200 |
| Admin com predicate de requirePermission sempre falso | Helper autorizou |
| PUT de agenda de voz com tenant de destino no body | O SET recebeu tenant de destino e retornou 200 |
| GET geral de chats com módulo chat e ver todos negados | Handler consultou banco simulado e retornou 200 |

## Índice de evidências por achado

| Achado | Fontes primárias |
|---|---|
| A01 | [src/lib/auth-session.ts:193](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/lib/auth-session.ts:193>); [src/lib/rbac.ts:756](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/lib/rbac.ts:756>) |
| A02 | [src/lib/rbac.ts:767](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/lib/rbac.ts:767>) |
| A03 | [src/routes/api/groups.ts:193](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/routes/api/groups.ts:193>) |
| A04 | [src/routes/api/voice-objectives.ts:192](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/routes/api/voice-objectives.ts:192>) |
| A05 | [src/routes/api/voice-enrich-contact.ts:13](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/routes/api/voice-enrich-contact.ts:13>) |
| A06 | [src/routes/api/trigger-outbound-call.ts:22](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/routes/api/trigger-outbound-call.ts:22>); [src/lib/voice/outbound-call-service.ts:33](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/lib/voice/outbound-call-service.ts:33>) |
| A07 | [src/lib/auth-session.ts:336](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/lib/auth-session.ts:336>); [src/lib/rbac.ts:901](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/lib/rbac.ts:901>) |
| A08 | [src/routes/api/chats.ts:269](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/routes/api/chats.ts:269>); [src/routes/api/chats/$chatId/messages.ts:13](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/routes/api/chats/$chatId/messages.ts:13>) |
| A09 | [src/routes/api/crm/deals/$dealId.ts:72](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/routes/api/crm/deals/$dealId.ts:72>); [src/routes/api/crm/deals/$dealId/activities.ts:21](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/routes/api/crm/deals/$dealId/activities.ts:21>) |
| A10 | [src/routes/api/crm/deals/bulk.ts:24](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/routes/api/crm/deals/bulk.ts:24>); [src/lib/crm/crm-service.ts:6944](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/lib/crm/crm-service.ts:6944>) |
| A11 | [src/routes/api/crm/deals/$dealId.ts:83](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/routes/api/crm/deals/$dealId.ts:83>); [src/lib/crm/crm-service.ts:3701](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/lib/crm/crm-service.ts:3701>) |
| A12 | [src/routes/api/sectors.ts:42](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/routes/api/sectors.ts:42>); [src/routes/api/contacts/update-wallet.ts:23](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/routes/api/contacts/update-wallet.ts:23>) |
| A13 | [src/routes/api/contacts/$contactId.ts:232](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/routes/api/contacts/$contactId.ts:232>); [src/routes/api/crm/search.ts:87](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/routes/api/crm/search.ts:87>) |
| A14 | [src/routes/api/tasks.ts:503](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/routes/api/tasks.ts:503>) |
| A15 | [src/routes/api/events.ts:38](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/routes/api/events.ts:38>); [src/lib/baileys/session-manager.ts:175](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/lib/baileys/session-manager.ts:175>) |
| A16 | [src/lib/livechat/livechatWs.ts:106](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/lib/livechat/livechatWs.ts:106>); [src/lib/livechat/livechatWs.ts:647](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/lib/livechat/livechatWs.ts:647>) |
| A17 | [src/hooks/usePermissions.ts:22](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/hooks/usePermissions.ts:22>) |
| A18 | [src/routes/api/push.ts:28](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/routes/api/push.ts:28>) |
| A19 | [src/components/chat/GroupsView.tsx:811](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/components/chat/GroupsView.tsx:811>); [src/components/chat/GroupsView.tsx:1595](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/components/chat/GroupsView.tsx:1595>) |
| A20 | [src/lib/rbac.ts:58](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/lib/rbac.ts:58>); [src/db/schema.ts:768](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/db/schema.ts:768>) |
| A21 | [src/routes/api/groups.ts:42](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/routes/api/groups.ts:42>); [src/routes/api/crm/action-history.ts:28](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/routes/api/crm/action-history.ts:28>) |
| A22 | [src/hooks/useChatState.tsx:1021](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/hooks/useChatState.tsx:1021>); [src/hooks/useChatState.tsx:624](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/hooks/useChatState.tsx:624>) |
| A23 | [src/routes/api/voice-agenda.ts:119](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/routes/api/voice-agenda.ts:119>); [src/routes/api/voice-agenda.ts:130](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/src/routes/api/voice-agenda.ts:130>) |

## O que já existe e deve ser aproveitado

- Sessão persistida no servidor, com expiração, revogação e cookie HttpOnly.
- Tenant do operador derivado da sessão nas rotas internas já migradas.
- Grupo local separado de entrada multiempresa e gestão global mais restrita.
- Permissões CRM aplicadas na listagem principal, busca de negócios e alguns agregados.
- Regras distintas de captura, tomada de atendimento, transferência e encerramento.
- Exigência de ser o responsável para responder no canal unificado.
- Templates pessoais com autoria; respostas rápidas e templates Meta globais com permissão específica.
- Histórico de negócios/ações, transações, controle de versão e notas comerciais imutáveis.
- Revisão industrial com regras contextuais de acesso, estado do ciclo e autoria.
- Webhook Meta com verificação de token/assinatura e RD com tokens de endpoint.
- Reset administrativo bloqueado em produção.

Portanto, há uma fundação aproveitável. O trabalho necessário é consolidar e completar essa fundação, evitando acrescentar novos checkboxes sem uma política executável comum.

## Modelo de controle necessário para atender à operação

Toda autorização deve combinar: **empresa autorizada + módulo habilitado + ação permitida + registro dentro do escopo + campos permitidos + regras de negócio**.

| Dimensão | Escolhas necessárias |
|---|---|
| Empresa | Sempre da sessão; troca somente por vínculo global validado |
| Módulo | Oculto/bloqueado ou habilitado, inclusive para administrador restrito |
| Ação | Consultar, criar, editar, adicionar informação, remover informação, excluir, exportar, administrar |
| Propriedade | Próprio, compartilhado comigo, equipe/setor, conjunto autorizado, todo o tenant |
| Funis | Lista autorizada e permissões por funil; interseção entre autorização de origem/destino |
| Filas | Meus, Todos, Fila, Bot e Fim habilitados individualmente |
| Conversas | Dono/equipe/carteira, canal e setor; lista, conteúdo, mídia e eventos sob a mesma regra |
| Campos | Ler/editar dados pessoais, valores, responsável, origem, campanha e campos personalizados |
| Administração | Gerir usuários, senhas, grupos, setores, carteiras, integrações e auditoria independentemente |
| Ações sensíveis | Exclusão permanente, exportação, reatribuição em massa, credenciais e custos com permissões próprias |

Separar “o que posso ver” de “o que posso alterar” é essencial. Um gerente pode consultar a equipe e editar apenas seus negócios. Um apoio pode adicionar uma atividade ao negócio de um vendedor sem alterar valor, trocar responsável ou remover documentos. Um administrador de operação pode cuidar de usuários e filas sem acessar custos, credenciais ou permissões de segurança.

Uma proposta de famílias de ações, para discussão antes da implementação:

| Área | Ações que precisam ser independentes |
|---|---|
| Negociações | Ler, criar, editar dados, reatribuir, mover etapa, trocar funil, ganhar, perder, pausar, reabrir, lixeira, restaurar, excluir permanentemente, exportar, operar em massa |
| Informação de negócio | Adicionar nota, criar tarefa, editar tarefa, concluir/reabrir tarefa, excluir tarefa, anexar, baixar, excluir arquivo, vincular/desvincular contato, vincular/desvincular conversa, marcar/desmarcar evidência |
| Propostas/e-mails | Elaborar proposta, alterar/enviar/aprovar proposta, consultar e-mails, registrar e enviar e-mail |
| Funis | Visualizar funil, criar, editar, excluir, administrar etapas, ordenar, definir campos/regras, administrar acesso |
| Conversas | Listar/ler, capturar, assumir alheia, transferir própria/alheia, responder, finalizar, reabrir, devolver ao bot, interromper bot, notas, reações, mídias e exportação |
| Clientes/carteiras | Ler, criar, editar cadastro, tags, remover/arquivar, exportar, atribuir, transferir, liberar carteira |
| Gestão | Ver próprios indicadores, equipe/setores autorizados, tenant; custos; gerar/aprovar/enviar relatórios; consultar/recalibrar QA |
| Administração | Usuários, senhas, grupos, delegação de direitos, setores, canais, integrações e credenciais |

Não é necessário materializar toda combinação como checkbox solto. O painel pode organizar módulo → escopo → ações, com presets e exceções por funil/setor. O servidor precisa representar as distinções mesmo quando a interface as apresenta de forma simples.

## Regras de composição recomendadas

1. Negação por padrão para grupo ausente, excluído ou inválido; nunca herdar administrador silenciosamente.
2. Um papel máximo explícito para recuperação/gestão total, separado de administradores de operação. A recuperação não deve depender de nome ou e-mail.
3. Bloqueio de módulo aplicado no servidor e herdado pelas suas APIs, mantendo exceções de recursos compartilhados explícitas.
4. Escopo por ação: ler equipe não significa editar equipe; editar não significa excluir; adicionar não significa remover.
5. Política central por recurso utilizada por lista, detalhe, busca, contagem, exportação, agenda, anexos e eventos.
6. Rotas aninhadas verificam o acesso ao recurso pai e a ação no filho.
7. Ação em massa exige a união das permissões envolvidas e a interseção de todos os registros autorizados; filtros do cliente só reduzem o universo permitido.
8. Estado efetivo governa autorização: se mudar etapa gera ganho/perda, precisa de permissão de fechamento, mesmo sem `status` no body.
9. Permissões tipadas, schema de validação e catálogo único compartilhado entre painel e servidor.
10. Alterações de acesso têm trilha de antes/depois, autor, instante e motivo; a sessão/eventos recebem revogação coerente.
11. Sem concessão de direito superior ao próprio por um administrador delegado; proteger último gestor máximo e a própria administração de permissões.
12. Dados nunca atravessam tenant por concessão de equipe/funil/grupo local. A entrada multiempresa continua separada.

## Sequência proposta de implementação

O detalhamento executivo, com arquitetura, 33 entregas, dependências e critérios de aceite, está no [plano de implementação](<C:/Users/TEC FAG/Music/PROGRAMAÇÃO/PROJETOS/LOCAL/VALEM CHAT/docs/audits/2026-10-22-access-control/PLANO-IMPLEMENTACAO.md>).

| Etapa | Entrega | Critério objetivo |
|---|---|---|
| 1. Fechar autorizações perigosas | Voz/enriquecimento/push, fallback administrativo, exclusão de grupo, bulk destrutivo | Sem operação interna anônima; usuário sem grupo não ganha privilégios; editar não exclui |
| 2. Consolidar política e contrato | Catálogo tipado, validação, papel máximo explícito, módulo/ação/escopo | Mesma resposta de autorização em todos os caminhos para o mesmo recurso |
| 3. Negociações e funis | Próprios/equipe/todos por ação; funis permitidos; subrecursos; ações em massa | Cenários solicitados de negócio próprio/alheio e funis diferentes passam nos testes |
| 4. Conversas | Filas, dono, setor, canal, leitura, mídia e eventos | Perfil “só Meus” não recebe dados das outras filas nem por API/evento |
| 5. Demais módulos | Contatos, carteiras, tarefas, IA, voz, gestão e ajustes | Cada módulo possui matriz aplicada no frontend e servidor |
| 6. Painel e governança | Corrigir chaves, presets, administrador restrito, visualização de acesso efetivo e auditoria | Administrador entende e comprova o que cada perfil pode fazer |

Executar com banco de teste e usuários sintéticos. Planejar compatibilidade explícita para os grupos atuais e ativação gradual por tenant. Preservar a operação Valem durante a implantação Tecfag: não trocar padrões e revogar direitos em massa sem inventário dos vínculos reais e plano de migração. Correções urgentes devem ser pequenas e verificáveis.

## Cenários mínimos para validar a futura política

| Cenário | Resultado esperado |
|---|---|
| Vendedor com leitura própria tenta negócio de colega por ID | Negado em ficha, atividades, arquivos, agenda, busca e exportação |
| Gerente lê equipe mas só edita próprios | Leitura alheia permitida; alteração alheia negada |
| Apoio adiciona tarefa, sem editar negócio | Tarefa nova permitida; valor, responsável e exclusão negados |
| Operador tem edição mas não exclusão | Lixeira e exclusão permanente negadas inclusive no bulk |
| Operador move etapa mas não fecha | Etapa terminal que gera ganho/perda negada |
| Grupo acessa apenas funil A | Funil B invisível em lista, busca, contagens, exportação e links |
| Grupo pode administrar etapas do funil A | Alterar funil B e excluir A continuam negados sem essas ações |
| Chat com apenas Meus | Sem abas nem dados de Todos/Fila/Bot/Fim, histórico/mídia/evento alheio |
| Supervisor de um setor | Não recebe dados de outro setor por relatórios/eventos/contagens |
| Administrador restrito sem Custos/Ajustes | Menu e acesso direto às APIs negados |
| Operador muda nome/e-mail | Nenhuma ampliação de privilégios |
| Grupo excluído/inválido | Acesso negado ou substituição restrita explícita; nunca administrador |
| Permissão removida com tela/stream abertos | Próxima ação e entrega de evento obedecem à revogação |
| Exportação/ação em massa usa filtros amplos | Servidor mantém o recorte autorizado da sessão |
| Recurso de outro tenant | Sempre negado, inclusive em relacionamentos e subrecursos |
| Callback público de provedor | Rejeita assinatura/token inválidos e não confia em tenant arbitrário |

## Decisões de produto ainda necessárias

O código não resolve estas decisões. Elas devem ser definidas na próxima conversa, com este mapa como referência:

- Quem será gestor máximo e quais tipos de administrador restrito serão oferecidos.
- Quais equipes/setores e funis cada perfil deve atender; se haverá compartilhamento explícito de negócio.
- Se a leitura de terceiros será permitida por equipe, carteira, funil ou combinação desses recortes.
- Quem pode adicionar informação em negócio alheio e quem pode remover/alterar informação existente.
- Quem pode excluir definitivamente, exportar dados, reatribuir em massa e administrar permissões.
- Regras de visibilidade de finalizados, mensagens internas, dados pessoais, valores e históricos.
- Qual será a política para cadastros compartilhados entre negócios de vendedores diferentes.
- Como migrar os grupos reais sem interromper atendimento e sem perpetuar permissões excessivas.

O diagnóstico técnico está fechado para o escopo descrito: **a base existe, mas ainda há falhas de aplicação, exceções permissivas e dimensões importantes sem modelagem. O controle solicitado exige uma política central de autorização e uma revisão completa de seus pontos de entrada.**

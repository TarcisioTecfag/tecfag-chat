# Plano de implementação — controle de acesso completo

Data: 22/10/2026. Situação: proposta técnica executável, baseada no diagnóstico deste checkout. Este documento planeja a implementação; não altera permissões nem dados de produção.

## Objetivo e resultado esperado

Permitir definir, comprovar e auditar **quem entra em cada módulo, quais dados pode consultar e quais ações pode executar sobre cada registro**, com isolamento absoluto entre empresas.

O controle deve valer igualmente na interface, nas APIs, nos serviços, nas buscas, nas exportações e nos eventos em tempo real. Administradores operacionais também poderão ter módulos e ações bloqueados. A condição de administrador não concederá acesso irrestrito automaticamente.

O escopo obrigatório cobre os 23 achados da auditoria, os 78 campos atuais, todas as 273 operações HTTP inventariadas e os canais SSE/WebSocket. Esses números são a linha de base: rotas ou funcionalidades adicionadas durante o trabalho entram no mesmo inventário e nos mesmos critérios de aceite.

## Premissas para começar sem travar o planejamento

| Tema | Proposta inicial |
|---|---|
| Empresa | Tenant vem da sessão nas operações internas. Grupo operacional nunca autoriza atravessar empresas |
| Grupo | Manter um grupo operacional principal por operador, com regras por recurso; evitar inicialmente a complexidade de grupos cumulativos e exceções pessoais |
| Administrador | Administrador operacional possui direitos configuráveis; gestor máximo é uma concessão explícita, protegida, local à empresa |
| Gestão global | A autorização multiempresa continua separada, inclusive a exigência de gestor global registrado |
| Negação | Grupo ausente/inválido e permissão não definida negam acesso no modelo novo |
| Migração | Direitos necessários à operação são convertidos explicitamente; ausência de configuração não vira administrador |
| Dados compartilhados | Regras distintas para empresa, contato, negociação e conversa; ter acesso a um não abre automaticamente todos os demais |
| Políticas atuais | Imutabilidade de notas, regras de etapa, captura de atendimento e regras do provedor continuam obrigatórias |
| Desenvolvimento | Banco de teste e dados sintéticos. Nenhuma seed de teste nos tenants de produção |
| Implantação | Tecfag é a prioridade de desenvolvimento; ativação em produção depende do fluxo real de cada tenant e de sua operação |

Estas premissas são propostas de desenho, não concessões a pessoas reais. A identidade dos gestores máximos e os direitos de cada equipe serão preenchidos no inventário operacional da fase 0.

## Cenários que a entrega precisa resolver

1. Um vendedor consulta e altera somente seus negócios, em funis autorizados, sem excluir nem exportar.
2. Um gerente consulta os negócios da equipe, edita os próprios e adiciona atividades nos negócios dos colegas, sem alterar valor ou responsável desses negócios.
3. Um apoio pode anexar documentos e criar tarefas, mas não apagar anexos nem editar a ficha comercial.
4. Um operador vê somente “Meus”, responde e encerra seus atendimentos, sem receber dados de Todos/Fila/Bot/Fim.
5. Outro operador vê Meus e a Fila de determinados setores/canais, podendo capturar somente nesses recortes.
6. Um gestor administra etapas do funil A, consulta o funil B e não acessa o funil C.
7. Um administrador gerencia operadores e setores sem acessar custos, credenciais, permissões de segurança ou determinados módulos.
8. Um auditor consulta histórico e QA de uma equipe sem modificar o atendimento nem exportar dados.
9. Remover um direito afeta a próxima operação e a entrega de dados em tempo real, inclusive com telas abertas.
10. Nenhuma combinação de grupo, funil, equipe, compartilhamento ou papel permite acesso transversal a outro tenant.

## Arquitetura proposta

### Um catálogo único e uma decisão central

Criar um catálogo tipado de módulos, recursos, ações e escopos. O painel será construído a partir desse catálogo e o servidor validará o mesmo contrato. Chaves desconhecidas, versões inválidas e valores fora do schema serão rejeitados.

Estrutura sugerida, ajustável ao padrão do repositório durante a implementação:

- `src/lib/access-control/catalog.ts`: recursos, ações, rótulos, dependências e ações sensíveis.
- `src/lib/access-control/types.ts`: sujeito autenticado, concessões, contexto e decisão.
- `src/lib/access-control/policy.ts`: avaliação pura, sem banco, com códigos estáveis de decisão.
- `src/lib/access-control/scopes.ts`: predicados de consulta por recurso, sempre com tenant.
- `src/lib/access-control/guards.ts`: integração com sessão e respostas HTTP.
- `src/lib/access-control/field-policy.ts`: leitura e escrita de campos.
- `src/lib/access-control/events.ts`: autorização de assinatura, destinatários e conteúdo de eventos.
- `src/lib/access-control/audit.ts`: registro de alterações de acesso e decisões relevantes.
- `src/lib/access-control/legacy-adapter.ts`: conversão explícita e temporária das permissões antigas.

Reaproveitar `requireSession`, a sessão do servidor e os componentes de autenticação atuais. `rbac.ts` e `usePermissions` passam por adaptação gradual; não criar uma segunda fonte permanente de autoridade.

### Contrato de decisão

Uma operação permitida exige a combinação de:

**sessão/principal válido + tenant válido + módulo habilitado + ação concedida + registro no escopo + campos autorizados + regra de negócio satisfeita.**

O resultado da avaliação deve fornecer `allowed`, código de motivo, regra aplicada e versão da política. A explicação detalhada será mostrada somente a quem tem direito de inspecionar acessos; o usuário comum recebe uma mensagem adequada sem informação sobre recursos de terceiros.

Operações internas continuam usando `requireSession` e tenant exclusivamente da sessão. Ações administrativas de usuários/permissões continuam exigindo `session.operator.role === "admin"`, conforme AGENTS.md, e passam a exigir também a capacidade específica. O novo modelo restringe administradores; não contorna essa condição administrativa existente.

O papel máximo precisa ser explicitamente atribuído e auditado. Não será inferido por nome, e-mail, ID antigo de grupo ou flags de usuário. Mesmo o gestor máximo permanece limitado ao tenant e às regras de negócio, incluindo imutabilidade e estado da operação.

### Como representar escopos sem abrir combinações indevidas

Cada concessão de ação contém seu próprio recorte: relação com o registro, setores/equipes, canais, funis e campos autorizados.

| Dimensão | Valores propostos |
|---|---|
| Relação | Próprios, carteira, equipe/setores autorizados, compartilhados explicitamente, todo o tenant |
| Não atribuídos | Permissão explícita para consultar/capturar registros sem responsável; não tratar como “meus” |
| Funil | Conjunto de funis autorizado por ação |
| Setor/equipe | Membros atuais e setores autorizados, sempre validados no tenant |
| Canal | Conjunto de canais configurável por tenant; não fixar provedor de WhatsApp |
| Estado | Regras de leitura/ação conforme estado da conversa ou negociação |
| Campos | Conjuntos de leitura/escrita para dados pessoais, dados comerciais e campos personalizados |

Dentro de uma concessão, os recortes são combinados por **E**. Se existirem várias concessões para a mesma ação, basta uma concessão completa atender ao registro. Não separar e recombinar listas de funis/setores de regras diferentes, pois isso criaria acessos que nenhuma regra concedeu.

O módulo bloqueado impede as concessões operacionais daquele módulo. Para modificar um registro, a política também exige o acesso de leitura necessário ao contexto, que pode ser uma projeção reduzida com campos protegidos.

Compartilhamento explícito, quando usado, será registro próprio com tenant, recurso, destinatário, ações, autor e eventual expiração. Compartilhar uma negociação não concede acesso irrestrito à empresa, a outras negociações ou ao histórico completo do contato.

### Persistência e integridade

Criar migrações aditivas para a versão de política, regras por ação, vínculos explícitos de gestão máxima e histórico de alterações. O desenho físico pode usar regras estruturadas relacionadas ao grupo e tabelas de vínculos para funis/setores/canais. Não manter regras sem schema em JSON livre.

Requisitos obrigatórios do schema e dos comandos de alteração:

- Toda regra operacional, vínculo e compartilhamento tem tenant e referências validadas nesse mesmo tenant.
- Acesso multiempresa permanece em suas tabelas globais próprias, sem misturar escopos operacionais.
- Alteração usa versão esperada para impedir que duas telas sobrescrevam silenciosamente a política.
- Exclusão de grupo exige remapeamento explícito dos membros para grupo válido ou é bloqueada enquanto houver vínculos.
- Não permitir excluir/rebaixar o último gestor máximo nem autoelevação por edição de grupo/perfil.
- Administrador delegado só atribui direitos e recortes que pode delegar; conferir o efeito completo, não apenas as chaves modificadas.
- Validar campos permitidos de todo UPDATE. Tenant, autoria e campos administrativos não entram por propagação de body.
- Revalidar direitos e estado dentro da transação nas ações sensíveis para reduzir condições de corrida.
- Nova versão invalida caches de política e dispara atualização/revalidação das sessões e assinaturas relevantes.

### Consulta, detalhes, campos e recursos compartilhados

Aplicar o escopo no banco antes de contar, paginar, buscar ou exportar. Filtrar depois de carregar os dados não é suficiente e prejudica contagens e paginação.

Listagem e detalhe devem utilizar a mesma política. Subrecursos precisam da autorização do recurso pai e da ação específica no filho. Leituras só retornam os campos autorizados; escrita de campo proibido é rejeitada, sem atualização parcial silenciosa.

Empresas e contatos compartilhados exigem regra própria. Um vendedor pode precisar de identificação básica da empresa sem obter todos os negócios, telefones, notas ou conversas de outros vendedores. Campos mascarados também devem permanecer protegidos em busca, exportação, relatórios, eventos e caches.

Contagens, opções de filtros e seletores não podem revelar nomes de funis, responsáveis ou registros que o operador não pode consultar. Para recursos fora do escopo, padronizar resposta que não revele sua existência; para ação proibida sobre recurso visível, usar 403. Ausência de sessão continua retornando 401.

### Eventos, notificações e clientes

- A assinatura identifica o operador autenticado e seus escopos, não apenas o tenant.
- Eventos de conexão/QR/credenciais são separados dos eventos de atendimento e exigem permissão administrativa específica.
- Resolver destinatários no servidor; regras do cliente apenas organizam a interface.
- Revalidar política antes da entrega, com cache versionado e invalidação; revogação explícita não espera um temporizador longo.
- Revalidar ações recebidas por WebSocket; autenticar na abertura não autoriza toda a vida da conexão.
- Reconexão, replay e recuperação de eventos passam pelo mesmo escopo.
- Push associa assinatura ao operador da sessão; conteúdo e entrega seguem a política e a preferência de privacidade da notificação.
- Mudança de grupo/tenant limpa dados e caches incompatíveis na aplicação. Chaves de cache incluem tenant, operador e versão/recorte pertinente.
- Unificar a recuperação de capacidades da sessão; ela não deve depender de possuir acesso ao módulo de chat.

## Fases e dependências

| Fase | Entrega | Dependência | Marco de conclusão |
|---|---|---|---|
| 0 | Linha de base operacional, cobertura e migração planejada | Diagnóstico | Nenhum grupo/integração em uso fica sem destino conhecido |
| 1 | Correções urgentes de autorização e isolamento | Inventário dos fluxos afetados da fase 0 | Achados P0 fechados e regressões dos fluxos afetados aprovadas |
| 2 | Núcleo central, contrato e persistência versionada | Fase 0; compatibilidade com correções da fase 1 | Política testável e conversão explícita das permissões atuais |
| 3 | Painel confiável e gestão de direitos | Catálogo da fase 2 | Configuração persistida corresponde exatamente ao acesso efetivo |
| 4 | Negociações, funis e componentes | Fases 2 e 3 | Escopos por ação aplicados a todos os caminhos CRM |
| 5 | Conversas, filas, canais e eventos | Fases 2 e 3; contratos de vínculo com CRM | Perfil “só Meus” garantido de ponta a ponta |
| 6 | Todos os demais módulos e integrações | Núcleo e políticas dos recursos compartilhados | Inventário inteiro com contrato de autorização validado |
| 7 | Migração, ativação gradual e retirada do legado | Critérios por domínio; ensaio de migração | Todos os tenants migrados conforme sua janela operacional e sem concessões implícitas |
| 8 | Melhorias avançadas de governança | Núcleo e implantação estáveis | Controles adicionais incorporados sem comprometer operação ou clareza |

As fases 4 e 5 podem ser alternadas em prioridade conforme a operação; ambas são obrigatórias. Cada domínio pode ser liberado após seus próprios critérios, usando versões compatíveis. Não é necessário esperar todo o projeto para obter as primeiras correções, mas não se deve anunciar um controle como ativo enquanto houver caminhos alternativos sem proteção.

## Fase 0 — preparar a execução

1. Confirmar a versão publicada por tenant e comparar com o checkout; atualizar o inventário com mudanças concorrentes.
2. Levantar, por leitura controlada, os grupos, papéis, vínculos, operadores sem grupo e configurações legadas existentes. Gerar uma matriz de migração por tenant sem copiar senhas, tokens ou dados desnecessários de clientes.
3. Identificar gestores máximos, responsáveis pela configuração e fluxos que não podem parar. Credencial recuperável e procedimento de recuperação devem ser verificados sem depender de atalhos de nome/e-mail.
4. Inventariar chamadores internos, callbacks e serviços que hoje usam as rotas de voz/push/enriquecimento; definir autenticação adequada antes de exigir nova credencial de um produtor legítimo.
5. Registrar os 14 cenários offline como testes de regressão apropriados: comportamentos falhos devem passar a ser negados; controles positivos legítimos devem continuar funcionando.
6. Criar uma matriz de cobertura por operação: principal, tenant, módulo, ação, escopo, campos, regra de negócio, teste e estado da migração.
7. Preparar banco de teste, fixtures sintéticas, migrações e ensaio de retorno. Não executar scripts existentes de seed/reset contra produção.

Aceite: grupos em uso e produtores dos endpoints críticos têm destino/contrato documentado; testes não dependem de credenciais ou dados de produção; o gestor legítimo não perde a capacidade de administrar durante a transição.

## Fase 1 — corrigir os riscos prioritários

| Frente | Trabalho | Aceite |
|---|---|---|
| Grupo ausente/legado | Remover fallback administrativo após remapeamento explícito; grupo inválido nega; impedir exclusão órfã | Ausência/exclusão de grupo nunca amplia direitos |
| Voz e enriquecimento | Sessão nas operações humanas; assinatura/token e tenant confiável nos produtores públicos/internos | Requisição anônima/arbitrária não consulta, altera, enriquece ou dispara operação interna |
| Serviço outbound | Receber tenant explicitamente e consultar configuração nesse tenant; retirar credenciais embutidas com migração operacional | Nenhum fallback de configuração de outra empresa; credenciais válidas provisionadas antes da retirada/rotação |
| Agenda e escrita arbitrária | Lista de campos permitidos; impedir alteração de tenant/autor por body | Teste de transferência de registro por tenantId do body falha |
| Push | Identidade da sessão; autoria da assinatura e destino validados | Cliente não vincula assinatura a outro operador |
| Bulk/exportação | Restringir seleção ao escopo autorizado; separar exclusão permanente, lixeira, exportação e ações derivadas | Editar não autoriza excluir; ler próprios não autoriza exportar alheios |
| Setores/carteiras/tarefas | Inserir barreiras específicas e validar recurso/responsável | Usuário apenas logado não administra setores/carteiras nem altera tarefa alheia sem direito |
| Painel atual | Corrigir as 15 chaves, validar payload, apresentar erros e desfazer estado otimista em falha | Cada controle realmente altera o direito conhecido; falha não aparece como sucesso |

A fase 1 aplica correções pequenas com política transitória explícita. Não criar um novo atalho administrativo genérico para substituir o antigo. Para callbacks, login, widget e links de chamada, preservar contratos públicos legítimos com validação própria; adicionar login indiscriminadamente quebraria as integrações.

## Fase 2 — estabelecer o núcleo de autorização

Implementar catálogo, validação, política pura, predicados SQL e integração HTTP. Criar política de módulos e ações por tenant, com grupos novos negando por padrão e regras administrativas protegidas.

Projetar a conversão das flags antigas com relatório de diferença: direito antigo, regra nova, ampliação/redução e justificativa. A conversão não pode assumir que toda capacidade tecnicamente acessível por uma falha era um direito legítimo que deve ser mantido.

Modo de comparação registra diferenças entre política antiga e nova sem liberar o que a política vigente proíbe. Ele não substitui os bloqueios urgentes nem autoriza retorno automático à política antiga em erro.

Para cada rota migrada, exigir contrato explícito. Classificar como: operação interna humana; operação de serviço; callback de provedor; recurso público intencional. Teste automatizado deve detectar novas rotas sem essa classificação. As exceções públicas são nominadas e testadas, não reconhecidas por uma regra ampla de prefixo.

Aceite: decisões determinísticas, módulos e escopos testados, dados fora do tenant inacessíveis, payload de política inválido rejeitado e alteração de direito refletida nas sessões/cache. Predicados de lista e verificação de detalhe representam a mesma regra.

## Fase 3 — oferecer um painel administrável

Organizar o painel em **grupo → módulo → ações e escopos**, com pesquisa e presets. Para CRM, permitir recortes por funil; para atendimento, por fila/setor/canal.

Entregar:

- Módulo oculto e bloqueado de forma consistente para todos os perfis, inclusive administradores restritos.
- Permissões independentes com linguagem operacional: visualizar, adicionar, editar, remover, excluir e exportar.
- Escopo por ação, com resumo legível: “Lê equipe; edita próprios; adiciona tarefas à equipe; não exclui”.
- Seletores de funis, setores, canais e visibilidade de filas, limitados ao que o administrador pode delegar.
- Presets para gestor máximo, administrador operacional, gestor comercial, supervisor, vendedor, SDR, suporte, apoio e auditor. São pontos de partida; nenhum nome concede poder automaticamente.
- Cópia/versionamento de grupo e prévia das diferenças antes de salvar; confirmação reforçada somente quando a alteração concreta exigir cuidado, sem criar barreiras para cada checkbox.
- Consulta de permissões efetivas por pessoa/recurso/ação e explicação da regra; simulação sem assumir a sessão da pessoa nem executar ação de negócio.
- Impacto sobre membros do grupo, regras conflitantes, direitos dependentes e tentativa de conceder além da própria delegação.
- Salvamento atômico com versão, erro visível e retorno ao estado confirmado em caso de falha.
- Histórico de concessões/revogações com autor, antes/depois, motivo e horário.
- Indicação de disponibilidade por tenant e estado de migração do domínio; não apresentar como efetivo um controle cuja API ainda não foi migrada.

Aceite: uma configuração salva gera a decisão esperada na API; as quinze divergências desaparecem; um administrador restrito não altera a própria autoridade nem a de um gestor superior. A simulação também é autorizada e não expõe registros fora do alcance de quem inspeciona.

## Fase 4 — negociações e funis

### Negociações

Separar os direitos de consultar, criar, editar campos, reatribuir responsável, mover etapa, trocar funil, ganhar, perder, pausar, reabrir, enviar à lixeira, restaurar, excluir permanentemente, exportar e operar em massa.

Cada ação possui seu próprio escopo. Leitura da equipe não concede edição da equipe. Negócio sem responsável e negócio compartilhado têm tratamento explícito.

Verificar o estado resultante no serviço: mover para etapa terminal exige permissão de fechamento; trocar funil exige acesso ao destino e às consequências da nova etapa. Reatribuição não pode tornar a negociação indevidamente acessível a quem não está autorizado.

### Componentes da negociação

| Componente | Direitos independentes |
|---|---|
| Notas | Consultar e adicionar; preservar imutabilidade das notas existentes |
| Tarefas/atividades | Consultar, criar, editar, atribuir, concluir, reabrir, cancelar e excluir |
| Arquivos | Consultar metadados, baixar, anexar e excluir |
| Contatos | Consultar projeção autorizada, associar, desassociar e definir principal |
| Conversas | Consultar vínculo, vincular, desassociar e abrir somente conteúdo autorizado da conversa |
| Evidências | Consultar, marcar e desmarcar; leitura da mensagem depende da política de conversa |
| Produtos | Consultar itens, adicionar, alterar valores/quantidades/descontos e remover |
| Propostas | Consultar, elaborar, editar, enviar e alterar/aprovar status conforme o fluxo existente |
| Questionários | Consultar, preencher e alterar respostas, respeitando regras de histórico |
| E-mails | Consultar, registrar e enviar; destinatário e anexos precisam de autorização |
| IA | Consultar resultado e solicitar análise, com acesso ao negócio e limite da funcionalidade |
| Histórico | Consultar eventos autorizados; alterações de permissões usam trilha de segurança própria |

Reaplicar a política em ficha, agenda, busca, opções de filtros, relatórios, vínculos de chat, importações humanas e exportação. Processos automáticos usam principal de serviço limitado, sem se passar por operador administrador.

### Funis

Permitir visualizar, usar para criar negócios, administrar propriedades, administrar etapas/regras e excluir por funil. Separar criar um novo funil de administrar/excluir todos os existentes.

Manter configuração e exclusão como ações distintas; avaliar impacto de excluir etapas, alterar obrigatoriedade ou mudar classificação de etapa terminal. Regras de transição específicas podem ser incorporadas após o controle de acesso básico por funil.

### Operações em massa

- Servidor recompõe a seleção autorizada; `allFiltered` nunca amplia o universo da sessão.
- Direitos exigidos correspondem a todas as mudanças efetivas da operação.
- Por padrão, lote com registro não autorizado é recusado integralmente antes de qualquer mutação. Se houver necessidade de processamento parcial, ele terá contrato e retorno explícitos, sem omitir silenciosamente registros.
- Exportação obedece ao recorte e à política de campos, inclusive em arquivos gerados em segundo plano e downloads posteriores.
- Seleção, validação de permissão e escrita ficam protegidas contra mudança concorrente de responsável/estado.

Aceite: vendedor com escopo próprio recebe a mesma negação em ficha, edição, atividades, arquivos, agenda, exportação e lote. Grupo de funil A não descobre nem altera B. Apoio adiciona informação sem alterar/remover a já existente.

## Fase 5 — conversas e atendimento

Modelar duas coisas separadas: **abas visíveis** e **dados que podem compor cada aba**. “Todos” significa todos dentro do escopo autorizado, nunca todo o tenant implicitamente.

| Controle | Comportamento desejado |
|---|---|
| Meus | Somente atendimentos atribuídos ao operador, dentro de canais/setores autorizados |
| Todos | União dos atendimentos consultáveis pela política do grupo |
| Fila | Atendimentos não capturados nos setores/canais permitidos |
| Bot | Atendimentos em automação, nos recortes permitidos |
| Fim | Finalizados próprios/equipe/tenant conforme concessão específica |
| Capturar | Só registros elegíveis e autorizados; regras de negociação obrigatória preservadas |
| Assumir alheio | Capacidade separada de consultar/transferir |
| Transferir | Separar próprio e alheio; validar origem, destino, canal, setor e capacidade do destinatário |
| Encerrar/reabrir | Direitos próprios, com regra explícita para dono, equipe e gestores |
| Bot | Interromper, devolver e reiniciar separados de leitura e de configuração global |
| Conteúdo | Mensagens, notas internas, mídias, reações e dados do cliente com políticas próprias |

Aplicar os mesmos escopos a lista, resolução por link/telefone, histórico paginado, arquivos, monitoramento, contadores, pesquisa e eventos. Canal é configurado por tenant; autorizar WhatsApp não fixa Meta ou Baileys.

Revalidar transferência e captura de forma transacional. Confirmar que o operador de destino tem vínculo e elegibilidade para receber o atendimento. Revisar rotas antigas de envio para não preservarem exceções por papel que contornem a política nova.

Aceite: usuário “só Meus” não recebe conteúdo, prévia, contador identificável, mídia ou evento de atendimento alheio. É possível configurar Meus+Fila sem Bot/Fim/Todos e restringir captura a setores/canais específicos. Revogação remove conteúdo inacessível do cliente e impede novas entregas.

## Fase 6 — demais módulos

| Módulo | Entrega obrigatória |
|---|---|
| Contatos/empresas | Escopo consistente em lista/detalhe/busca/associação; campos protegidos; criação, edição, arquivamento/exclusão e exportação independentes |
| Carteiras | Consultar própria/equipe; atribuir, transferir e liberar independentemente; efeitos na conversa seguem a política de atendimento |
| Tarefas | Autor e responsável com regras distintas; editar, atribuir, concluir/reabrir e excluir controlados em todas as rotas, inclusive RD |
| Início/Gestão/BI | Respeitar o módulo habilitado e o cadastro de consultor; direitos por indicadores, metas, diretrizes, evidências e administração |
| Monitoramento | Escopo de equipe/setor/canal/funil conforme a métrica; conteúdo de conversa autorizado; evitar dados alheios por agregações pequenas |
| QA | Consultar, revisar, recalibrar e administrar separadamente, preservando histórico |
| Relatórios | Gerar, consultar, exportar, aprovar e enviar; destinatários não podem receber dados fora do direito de divulgação do autor/processo |
| Custos | Direito específico de consultar e exportar; administrador operacional pode ficar sem acesso |
| IA | Acesso ao assistente, histórico próprio/equipe, configuração de agente, SDR, rodízio e conhecimento separados; features permitidas por tenant preservadas |
| Voz | Agenda, histórico, gravação/transcrição, campanhas, objetivos e disparos com direitos e escopos; callbacks com identidade própria |
| Templates | Separar pessoais e globais; autoria, edição, exclusão e uso operacional; preservar regras da Meta |
| Usuários/grupos/setores | Capacidades administrativas independentes, limites de delegação e prevenção de autoelevação |
| Ajustes/integrações | Ver status, configurar, conectar/desconectar, testar, ver diagnósticos e gerir credenciais separados |
| Widget/serviços públicos | Validação própria de origem/token/assinatura, vínculo com tenant e limites de ações; não herdar permissões de operador |
| Manutenção | Manter bloqueio de reset em produção; comandos internos limitados, auditados e sem bypass operacional genérico |

IA continua exclusivamente pelo serviço central Vertex AI, com tenant/feature e persona corretos. Esta implementação não exige acrescentar qualquer provedor de IA nem usar IA para tomar decisões de autorização.

Aceite: todas as operações do inventário possuem contrato e teste adequados. Não permanece endpoint interno protegido apenas por login quando sua ação exige direito/escopo adicional.

## Fase 7 — migração e implantação gradual

1. Criar schema e código compatíveis de forma aditiva, mantendo a operação durante a preparação.
2. Gerar a proposta de conversão dos grupos reais e a lista de usuários sem destino válido.
3. Conferir direitos operacionais e gestores de recuperação antes de negar configurações inválidas em uso. Não transportar permissões indevidas causadas por bugs para a política nova.
4. Ensaiar a migração com dados sintéticos/anonimizados em ambiente isolado; verificar reversibilidade e preservação do histórico.
5. Rodar comparação de decisões para os fluxos selecionados, com logs mínimos e sem conteúdo de clientes. Corrigir divergências esperadas/inesperadas antes da ativação.
6. Ativar por tenant/domínio/grupo piloto com mecanismo de configuração no servidor; proibir operação em versões incompatíveis de política.
7. Observar negações inesperadas, falhas de atendimento, transferências, filas, entregas de mensagens e latência. Negações corretas são resultado esperado, não falha a ser liberada automaticamente.
8. Ampliar após critérios cumpridos, seguindo a janela operacional de cada cliente. A prioridade Tecfag não transforma seu banco em ambiente de teste nem autoriza interromper Valem.
9. Invalidar sessões/caches/assinaturas conforme a versão, sem depender de recarregamento voluntário da página.
10. Retirar inferências por nome/e-mail/ID e adaptador legado somente após confirmar que não existem grupos ativos dependentes deles.

Rollback deve reverter a entrega incompatível para uma versão que preserve as barreiras urgentes e os limites já confirmados. Não usar “liberar tudo”, retornar ao fallback administrativo ou desligar checagens como mecanismo de recuperação. Migrações destrutivas e remoção de colunas antigas ficam para uma entrega posterior com backup e validação próprios.

Aceite: sem usuários órfãos, sem ampliação silenciosa, sem interrupção de mensagens legítimas, sem regressão de isolamento e com procedimento de recuperação exercitado.

## Fase 8 — elevar a governança após a base obrigatória

Estas melhorias complementam a entrega principal; não substituem a correção das falhas atuais:

- Concessões temporárias com expiração e motivo, revogadas automaticamente pelo próprio controle de acesso.
- Revisão periódica de direitos, grupos sem uso, concessões amplas e usuários sem vínculo operacional. Agendamentos só serão criados quando solicitados.
- Aprovação adicional para ampliar acesso global ou executar exclusão/exportação sensível, caso a operação exija separação entre quem solicita e quem aprova.
- Limites de exportação e operação em massa por perfil, com trilha de execução e recibo de resultados.
- Avaliação de RLS no PostgreSQL como defesa adicional, após revisar pool de conexão, jobs, scripts e contexto de tenant. Não adotar como substituto das políticas de ação.
- Relatórios de conformidade de acesso e consulta do histórico de concessões, sem registrar dados pessoais desnecessários.
- Revisão da política de sessão e autenticação reforçada nas operações administrativas mais sensíveis.
- Permissões de transição entre etapas/funis e aprovação comercial para exceções de preço/condição, se esses fluxos fizerem parte do produto.

## Backlog executável

Cada item deve virar uma entrega revisável com evidência de teste e vínculo aos achados. Não é necessário criar chats, branches, PRs ou implantar nada para aprovar este plano.

| ID | Entrega | Depende de | Evidência de conclusão |
|---|---|---|---|
| AC-01 | Atualizar baseline de código/implantação e cobertura das rotas | — | Inventário versionado com contratos e diferenças |
| AC-02 | Levantar grupos reais e propor conversão por tenant | AC-01 | Mapa sem órfãos e sem credenciais |
| AC-03 | Registrar casos de regressão críticos | AC-01 | Testes isolados reproduzem falhas e controles positivos |
| AC-04 | Proteger ausência/exclusão de grupo e remapear legado | AC-02, AC-03 | Grupo inválido/excluído não concede administrador |
| AC-05 | Proteger rotas/serviços de voz e callbacks | AC-01, AC-03 | Humanos e produtores legítimos autenticados; anônimos negados |
| AC-06 | Impedir escrita arbitrária/transferência de tenant | AC-03 | UPDATE rejeita campos administrativos proibidos |
| AC-07 | Vincular push à sessão e revisar destinatários | AC-03 | Inscrição/destino de outro operador negados |
| AC-08 | Fechar bulk/exportação destrutivos e recortes | AC-03 | Exclusão e exportação não herdam direitos de edição/leitura ampla |
| AC-09 | Corrigir chaves e persistência do painel atual | AC-03 | 15 divergências eliminadas e erro exibido corretamente |
| AC-10 | Catálogo/schema/tipos da política nova | AC-01, AC-02 | Catálogo único com validação e migração mapeada |
| AC-11 | Avaliador central e políticas de campos | AC-10 | Testes de composição/negação/delegação |
| AC-12 | Predicados de consulta e verificação de recursos | AC-11 | Lista/detalhe/contagem têm o mesmo recorte |
| AC-13 | Schema aditivo, gestores máximos e versão de política | AC-10 | Migração ensaiada e último gestor protegido |
| AC-14 | Sessão/caches/revogação e auditoria de direitos | AC-11, AC-13 | Revogação refletida na próxima ação/entrega |
| AC-15 | Novo painel de módulos, ações e escopos | AC-09, AC-10, AC-13 | Configuração corresponde ao contrato da API |
| AC-16 | Inspeção/simulação de acesso efetivo | AC-11, AC-15 | Motivo verificável sem impersonação nem vazamento |
| AC-17 | Direitos de negócio por ação e responsável | AC-11, AC-12 | Próprios/equipe e leitura/escrita independentes |
| AC-18 | Direitos de funis/etapas e mudança efetiva de estado | AC-17 | Funil não autorizado e fechamento indireto negados |
| AC-19 | Componentes CRM e vínculos com chat/contato | AC-17, AC-18 | Adicionar não permite editar/remover componentes |
| AC-20 | CRM busca/agenda/agregados/exportação/lote | AC-17, AC-19 | Nenhum caminho alternativo amplia o recorte |
| AC-21 | Políticas de clientes/empresas/carteiras/tarefas | AC-11, AC-12 | Recursos compartilhados têm projeções e ações próprias |
| AC-22 | Visibilidade de filas/canais/setores e leitura de chat | AC-11, AC-12, AC-21 | Perfil “só Meus” não recebe dados alheios |
| AC-23 | Ações de atendimento e transferência/captura | AC-19, AC-22 | Origem/destino/autor revalidados atomicamente |
| AC-24 | SSE/WebSocket/push/replay e mídias | AC-07, AC-14, AC-22 | Eventos, QR e arquivos obedecem à política |
| AC-25 | Gestão comercial, monitoramento, QA e relatórios | AC-17, AC-21, AC-22 | Dados/ações restritos à equipe e módulos concedidos |
| AC-26 | IA, conhecimento, rodízio e voz granular | AC-05, AC-11, AC-22 | Abas e APIs usam capacidades e feature do tenant |
| AC-27 | Usuários/grupos/setores e limites de delegação | AC-11, AC-13, AC-15 | Administrador restrito sem autoelevação |
| AC-28 | Ajustes, credenciais, templates e integrações | AC-11, AC-27 | Status/configuração/segredos/uso separados |
| AC-29 | Testes globais de cobertura e desempenho | Itens de cada domínio | Nenhuma rota sem contrato; metas de latência verificadas |
| AC-30 | Ensaio de migração e comparação de decisões | AC-02, AC-13, domínio pronto | Diferenças classificadas e plano de retorno exercitado |
| AC-31 | Ativação progressiva por tenant/domínio | AC-29, AC-30 correspondentes | Aceite operacional e segurança sem interrupção |
| AC-32 | Remover legado e encerrar achados | Todos os domínios migrados | Zero bypass legado e cobertura final aprovada |
| AC-33 | Governança avançada da fase 8 | AC-31; conforme prioridade | Requisitos adicionais com critérios próprios |

## Rastreabilidade dos 23 achados

| Achado | Entregas principais | Verificação decisiva |
|---|---|---|
| A01 Grupo ausente | AC-02, AC-04, AC-13 | Sem grupo não recebe permissões administrativas |
| A02 Defaults legados | AC-02, AC-04, AC-10, AC-32 | Campo omitido não vira concessão administrativa |
| A03 Excluir grupo | AC-04, AC-27 | Remapeamento explícito ou exclusão bloqueada |
| A04 Objetivos de voz | AC-05, AC-26 | Consulta/escrita sem principal válido negadas; GET sem seed |
| A05 Enriquecimento | AC-05, AC-06 | Assinatura/sessão, tenant e recurso validados |
| A06 Chamadas/outbound | AC-05, AC-26 | Produtor autenticado e configuração restrita ao tenant |
| A07 Bypass admin | AC-11, AC-13, AC-27, AC-32 | Admin operacional sem direito recebe negação |
| A08 Escopo de conversa | AC-22, AC-24 | Lista/histórico/mídia/evento retornam o mesmo universo |
| A09 Escopo CRM | AC-17, AC-19, AC-20 | Negócio alheio não abre por subrecurso/escrita |
| A10 Bulk/exportação | AC-08, AC-20 | Mesmas capacidades/recortes da operação individual |
| A11 Mudança efetiva | AC-18, AC-20 | Fechamento indireto e reabertura exigem capacidade |
| A12 Setor/carteira | AC-21, AC-27 | Sessão sem capacidade não altera distribuição/configuração |
| A13 Contatos | AC-21, AC-20 | Carteira respeitada em detalhe, busca e vínculos |
| A14 Tarefas | AC-21, AC-19 | Alteração de tarefa alheia sem concessão negada |
| A15 SSE e QR | AC-14, AC-24 | QR não é entregue a operador de atendimento sem direito |
| A16 Live Chat WS | AC-22, AC-23, AC-24 | Ação e entrega revalidadas com sessão/política atuais |
| A17 Master por identidade textual | AC-11, AC-13, AC-32 | Nome/e-mail não ampliam direitos |
| A18 Push | AC-07, AC-24 | Identidade/destino/conteúdo autorizados no servidor |
| A19 Checkboxes | AC-09, AC-10, AC-15 | Catálogo e teste impedem chaves incompatíveis |
| A20 Granularidade | AC-15, AC-17 a AC-28 | Cenários operacionais iniciais atendidos |
| A21 Auditoria e explicação | AC-14, AC-16, AC-27 | Antes/depois e motivo da decisão consultáveis por autorizado |
| A22 Revogação/estado UI | AC-09, AC-14, AC-24 | Estado confirmado e revogação sem dependência do chat |
| A23 Agenda altera tenant | AC-06, AC-26 | Tenant recebido no body nunca entra no SET |

## Plano de testes e evidências

Não depender apenas de testes que procuram strings no código. Combinar testes do avaliador puro, consultas reais em PostgreSQL de teste, handlers autenticados, eventos e jornadas de interface.

| Camada | Casos essenciais |
|---|---|
| Política | Permissão ausente, módulo negado, próprios/equipe/todos, regras completas sem combinações indevidas, expiração e campos |
| Tenant | IDs e vínculos cruzados, proprietário compartilhado, consultas/agregados, callbacks e serviços |
| Administração | Admin restrito, grupo removido, último gestor, autoconcessão, delegação de direitos/recortes superiores |
| CRM | Todos os componentes, funis, fechamento indireto, pausas, reabertura, exclusões e exportações |
| Conversas | Abas independentes, canal/setor, notas internas, links, mídias, captura/transferência e filas |
| Dados derivados | Busca, contagens, opções, relatórios, agenda, cache e arquivo exportado |
| Tempo real | Assinatura, replay, revogação, reconexão, múltiplas instâncias, QR e push |
| Concorrência | Troca de grupo/responsável durante a operação, duas edições de grupo, lote e mudança de política |
| Interface | Menu oculto, URL direta, ação desabilitada, salvamento rejeitado, teclado e mobile |
| Regressão | Atendimento legítimo, bot/rodízio permitidos no tenant, envio por provedor configurado, histórico e vínculo CRM |
| Desempenho | Consultas escopadas, paginação/contagem consistentes, eventos sem consulta desnecessária por destinatário, invalidação em várias instâncias |

Para cada família, testar permissão concedida e negada, próprio e alheio, mesma empresa e outra empresa. Cenário de negação deve verificar também que nenhuma escrita/entrega externa ocorreu.

Medir baseline e definir limite de regressão de latência antes de cada ativação; não inventar uma meta absoluta sem medir o ambiente. Auditoria e diagnósticos não armazenam mensagens, arquivos ou segredos para explicar decisões.

## Critérios de conclusão do projeto

- Todos os achados A01–A23 têm correção, teste e evidência de revisão.
- Todas as operações do inventário vigente e os canais de eventos têm contrato explícito de principal/ação/escopo.
- Não existem bypasses por nome, e-mail ou papel administrativo genérico; gestão máxima é explícita e limitada ao tenant.
- Grupo ausente/inválido/excluído não amplia direitos.
- Administrador consegue configurar módulos completos, ações e escopos sem editar JSON nem código.
- Negociações e funis têm controles de próprios/alheios, informação adicionada/removida, exclusão e exportação independentes.
- Perfil de atendimento “só Meus” é comprovado em interface, APIs, arquivos, contagens e eventos.
- Dados de clientes e componentes compartilhados respeitam a política de campos e o recurso de origem.
- Revogação e alteração de política não deixam sessão/cache/eventos usando concessões antigas.
- Migração não cria dados de teste nos clientes nem interrompe a operação legítima da Valem.
- Documentação operacional explica criar grupo, delegar acesso, consultar direito efetivo, revogar e recuperar administração.

Não há prazo fechado neste plano. Primeiro se conclui a fase 0 e dimensionam-se as entregas conforme quantidade de grupos em uso, produtores das integrações e regras de equipe. Cada entrega deve informar escopo, testes, dependências, risco operacional e critério de retorno antes de ser implantada.

## Primeiro conjunto de trabalho

O andamento das alterações locais, as evidências e os bloqueios de ativação estão em [ANDAMENTO-IMPLEMENTACAO.md](./ANDAMENTO-IMPLEMENTACAO.md). Este plano descreve o escopo total; a existência de um item aqui não significa que ele já esteja implantado.

Começar por **AC-01, AC-02 e AC-03**, seguido das correções **AC-04 a AC-09** conforme os fluxos afetados estejam inventariados. Esse conjunto entrega uma base mensurável, fecha os riscos mais graves e evita que o novo painel seja construído sobre autorizações inconsistentes.

Depois, estabelecer **AC-10 a AC-16** e aplicar o contrato a CRM/funis e conversas. A migração dos demais módulos fecha a cobertura do sistema; as melhorias avançadas entram sobre essa base já verificável.

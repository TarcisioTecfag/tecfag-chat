# Conexão RD Marketing e consulta da jornada

O módulo oferece autorização OAuth por tenant, consulta de prova de um lead nas configurações e jornada RD Marketing no histórico dos cards. A conexão por webhook continua responsável pela criação de cards. As consultas de jornada não enviam vendas/perdas e não alteram contatos, empresas ou negociações.

## Configuração

1. O servidor precisa de `RD_MARKETING_ENCRYPTION_KEY`: 32 bytes aleatórios em base64. Gere uma única vez com `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`, salve na variável do serviço e preserve entre deploys. Nunca publique a chave nem use prefixo `VITE_`.
2. No App Publisher RD, cadastre um aplicativo **RD Marketing** com permissões para leitura de contatos e eventos. As credenciais do aplicativo RD CRM não servem para esta conexão.
3. Entre como administrador no tenant correto. Em Configurações → RD Marketing, copie a URL de retorno mostrada em **Conectar conta RD Marketing** e registre exatamente essa URL no aplicativo. Na produção Tecfag: `https://tecfagchat.up.railway.app/api/settings/rd-marketing/callback`.
4. Informe Client ID e Client Secret no painel e salve. O segredo não é devolvido ao navegador após salvar. Campo vazio mantém o segredo atual quando o Client ID é o mesmo.
5. Clique em **Autorizar no RD Marketing** e escolha a conta Marketing que pertence a este tenant. Continue usando a mesma sessão de administrador. Após retornar ao sistema, abra a seção novamente e confira **Conta autorizada**. A API documentada não fornece aqui uma confirmação do nome da conta; a seleção correta na tela do RD é essencial.
6. Consulte um lead conhecido por e-mail, UUID do RD ou telefone com país (`+55...`). Compare **JSON do contato**, **Detalhes recebidos** e **JSON completo da página** com a jornada que aparece no RD Marketing. A consulta apresenta dez eventos por página, conforme o padrão do RD, com carregamento manual da próxima página.

## O que esta prova confirma

Consulta `GET /platform/contacts/{identifier}:{value}` e, com o UUID devolvido, `GET /platform/contacts/{uuid}/events` nos tipos `CONVERSION` e `OPPORTUNITY`. Não pressupõe que visitas, cliques, aberturas de e-mail, tarefas ou entradas em automações estarão disponíveis. Um formato de evento não reconhecido continua visível no JSON; não é convertido silenciosamente em histórico vazio. Fonte e campanha só aparecem quando constam no retorno, sem inventar atribuição.

Na consulta de prova das Configurações, os dados pessoais retornados são apresentados somente ao administrador autenticado do tenant e não são persistidos nem enviados a logs. Na jornada dos cards, as páginas são preservadas no cache local do tenant e apresentadas somente após validar as permissões do CRM. Credenciais são removidas dos JSONs. A autorização precisa ser feita uma vez por tenant; não há compartilhamento de tokens entre tenants.

## Retorno real validado em 13/10/2026

A consulta autorizada retornou um contato com telefone em `personal_phone`, uma conversão CDP e uma marcação de oportunidade. A conversão contém `event_identifier`, `event_timestamp`, `payload.cf_utm_source`, `payload.cf_utm_campaign`, `payload.cf_utm_medium` e `payload.traffic_source` com prefixo `encoded_`.

A leitura normalizada mostra Fonte `linktree`, Campanha `site-home` e Mídia `social`. O tracking codificado dessa amostra contém JSON em base64 com `first_session` e `current_session`; quando faltam UTMs explícitas, a leitura considera somente `current_session` da própria conversão, sem completar a campanha com outra sessão. O JSON original permanece visível e inalterado. Tracking inválido nunca é exibido como uma fonte válida.

O webhook legado recebe a mesma leitura quando esses campos estão dentro da conversão selecionada (`first_conversion` ou `last_conversion`, inclusive `content`). Não utiliza os `cf_utm_*` atuais do perfil para atribuir automaticamente uma conversão histórica; mapeamentos explícitos continuam configuráveis. Esta correção não altera os cards já importados.

O evento `OPPORTUNITY` dessa amostra informa apenas `funnel_name: "default"`; ele não contém Fonte/Campanha e não identifica uma negociação local. A interface o apresenta como **Marcado como oportunidade**, com o nome do funil no RD Marketing. Não é o funil comercial do CRM.

Campos `cf_plug_*` retornados no contato são valores do perfil, sem data ou lista de alterações nesse retorno. Não reconstruímos uma história de mudança de etapa, responsável, valor, venda ou perda a partir deles. A conversão também não retornou URL da página: seu identificador de botão e suas UTMs não bastam para deduzir a página visitada. A prova ainda não confirmou acesso à timeline integral nem aos registros comerciais nativos mostrados nas imagens do RD.

## Segurança e operação

- Credenciais e tokens usam AES-256-GCM com contexto do tenant e finalidade. A chave do servidor deve ser guardada de forma durável. Perder ou trocar a chave exige cadastrar/autorizar novamente.
- O retorno OAuth valida um estado aleatório, com prazo de 15 minutos, vinculado ao tenant, operador, sessão e versão das credenciais. O estado só pode ser consumido uma vez. Alterar credenciais ou desconectar invalida autorizações pendentes.
- A renovação utiliza `expires_in` do RD, bloqueio no banco por tenant e suporta rotação de refresh token. Uma consulta recusada com 401 tenta renovar e repetir uma única vez.
- Desconectar consulta remove os tokens locais, preserva as credenciais do aplicativo e não desativa os webhooks. A revogação no RD, se desejada, é feita na conta RD.
- Migration `0037_rd_marketing_oauth.sql` é aditiva e não cria dados de tenants. O runner de produção a aplica antes de iniciar o servidor.

## Fontes oficiais

- [Gerar código e URL de autorização](https://developers.rdstation.com/reference/gerar-code)
- [Obter tokens de acesso](https://developers.rdstation.com/reference/obter-tokens-acesso)
- [Atualizar access token](https://developers.rdstation.com/reference/atualizar-access-token)
- [Consultar contato](https://developers.rdstation.com/reference/get_platform-contacts-identifier-value-1)
- [Consultar eventos do contato](https://developers.rdstation.com/reference/get_platform-contacts-uuid-events-1)

## Jornada dentro dos cards

No card, abra **Histórico → Do → RD Marketing**, ou use **Carregar jornada RD Marketing** no filtro Todos. O CRM consulta conversões e oportunidades do contato selecionado, inclusive anteriores à criação da negociação. Quando há vários contatos no card, o seletor permite consultar cada jornada separadamente.

A associação entre contato local e UUID RD é persistida por tenant e versão da conexão. A primeira busca usa o e-mail local; sem e-mail, aceita telefone internacional explícito ou número brasileiro já salvo com `55` e DDD. Não usa nomes para vincular pessoas, nem cria contatos, empresas ou cards nesta consulta. Um mesmo UUID não pode ser associado automaticamente a dois contatos locais na mesma conexão.

Cache de cinco minutos é compartilhado entre cards do contato e persiste entre deploys. **Atualizar jornada** consulta novamente o RD. Páginas seguintes são carregadas manualmente, reaproveitando páginas já consultadas. Atualizar o início da jornada invalida a paginação anterior; um card com uma versão antiga precisa atualizar antes de continuar. Alterar/autorizar novamente a conexão invalida o vínculo com a conta anterior.

Conversões oferecem **Abrir negociação** quando o recibo de criação coincide com a identidade do lead, o identificador e a data original da conversão, em um fluxo com identificação por evento no formato padrão. A negociação precisa continuar vinculada ao mesmo contato. Cards sem recibo correspondente não recebem um vínculo inventado por proximidade de datas. Fluxos antigos com deduplicação por lead ou identificadores personalizados podem mostrar a conversão sem link.

A rota exige sessão, `canViewCrm`, acesso ao card e participação do contato. Links de outros cards respeitam `canViewAllDeals` e o vendedor responsável; negociações sem permissão não têm nome/ID expostos. A UI mistura os eventos carregados do Marketing com o histórico atual do CRM em ordem cronológica e permite filtrar conversões e oportunidades. Dados sem data válida são sinalizados e colocados após os eventos datados.

Migration `0038_rd_marketing_journey.sql` é aditiva. Eventos consultados ficam no cache local do tenant, com credenciais ocultadas, e não geram novas conversões, cards ou mensagens no RD. O envio de vendas/perdas ainda é uma etapa posterior, com eventos independentes por negociação, conforme `rd-marketing-sync-study.md`.

O painel também lista **Negociações deste contato**, com links para os cards permitidos ao operador. Essa lista informa a relação com o contato; somente os links exibidos junto de uma conversão representam um recibo correspondente àquela conversão. A troca de operador, tenant ou permissões invalida a jornada carregada no navegador antes de consultar os dados novamente.

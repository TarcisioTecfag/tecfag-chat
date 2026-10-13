# Conexão RD Marketing e consulta da jornada

Esta primeira etapa adiciona autorização OAuth por tenant e uma consulta de leitura de um lead. A conexão existente por webhook continua responsável pela criação de cards. Esta etapa não envia vendas/perdas, não importa a jornada para os cards e não altera os contatos consultados.

## Configuração

1. O servidor precisa de `RD_MARKETING_ENCRYPTION_KEY`: 32 bytes aleatórios em base64. Gere uma única vez com `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`, salve na variável do serviço e preserve entre deploys. Nunca publique a chave nem use prefixo `VITE_`.
2. No App Publisher RD, cadastre um aplicativo **RD Marketing** com permissões para leitura de contatos e eventos. As credenciais do aplicativo RD CRM não servem para esta conexão.
3. Entre como administrador no tenant correto. Em Configurações → RD Marketing, copie a URL de retorno mostrada em **Conectar conta RD Marketing** e registre exatamente essa URL no aplicativo. Na produção Tecfag: `https://tecfagchat.up.railway.app/api/settings/rd-marketing/callback`.
4. Informe Client ID e Client Secret no painel e salve. O segredo não é devolvido ao navegador após salvar. Campo vazio mantém o segredo atual quando o Client ID é o mesmo.
5. Clique em **Autorizar no RD Marketing** e escolha a conta Marketing que pertence a este tenant. Continue usando a mesma sessão de administrador. Após retornar ao sistema, abra a seção novamente e confira **Conta autorizada**. A API documentada não fornece aqui uma confirmação do nome da conta; a seleção correta na tela do RD é essencial.
6. Consulte um lead conhecido por e-mail, UUID do RD ou telefone com país (`+55...`). Compare **JSON do contato**, **Detalhes recebidos** e **JSON completo da página** com a jornada que aparece no RD Marketing. A consulta apresenta dez eventos por página, conforme o padrão do RD, com carregamento manual da próxima página.

## O que esta prova confirma

Consulta `GET /platform/contacts/{identifier}:{value}` e, com o UUID devolvido, `GET /platform/contacts/{uuid}/events` nos tipos `CONVERSION` e `OPPORTUNITY`. Não pressupõe que visitas, cliques, aberturas de e-mail, tarefas ou entradas em automações estarão disponíveis. Um formato de evento não reconhecido continua visível no JSON; não é convertido silenciosamente em histórico vazio. Fonte e campanha só aparecem quando constam no retorno, sem inventar atribuição.

Os dados pessoais retornados são apresentados somente ao administrador autenticado do tenant e não são persistidos nem enviados a logs por esta funcionalidade. Credenciais são removidas do JSON de diagnóstico. A autorização precisa ser feita uma vez por tenant; não há compartilhamento de tokens entre tenants.

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

Próxima etapa, após conferir o retorno real: identidade RD ↔ contato local, jornada compartilhada entre cards do contato e vínculo explícito com a negociação correta. Eventos de venda e perda serão independentes por negociação, conforme o desenho em `rd-marketing-sync-study.md`.

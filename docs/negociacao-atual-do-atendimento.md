# Negociação atual do atendimento

Uma conversa continua com um único responsável e setor por vez. Os vínculos N:N
com negociações são preservados; a seleção operacional fica separada em
`conversation_deal_contexts`.

## Regras

- Sem escolha anterior, uma única negociação vinculada com status `open` é
  selecionada automaticamente. Zero ou várias opções exigem escolha do operador.
- Criar um segundo card não muda a seleção existente. No formulário de criação,
  o operador pode marcar a opção de usar o novo card neste atendimento.
- Apenas o responsável pelo atendimento capturado altera a seleção. O servidor
  valida acesso ao card, tenant, vínculo ativo e status; o tenant vem da sessão.
- Notas internas, tarefas e ações de fila são registradas no card selecionado.
  Notas gerais podem permanecer apenas na conversa.
- A troca vale para as próximas ações. Registros anteriores conservam seu card.
- Transferir mantém a seleção por padrão. Se o operador escolher outra negociação
  no diálogo de transferência, a transferência é registrada na origem e a nova
  seleção é aplicada na mesma transação. Falhas desfazem ambas as alterações.
- Encerrar atendimento registra o evento e encerra o contexto operacional. O card
  permanece com seu status e responsável comercial. Na próxima abertura, a última
  negociação aparece como sugestão e exige revisão explícita.
- Ganhar, perder, pausar, excluir ou desvincular o card invalida a seleção na
  próxima consulta/ação. Outro card não assume automaticamente seu lugar.
- Mudanças de etapa, status e responsável e a criação de notas/atividades no CRM
  também geram registros nas conversas que usam o card como contexto atual.
- Leitura de mensagens e preferências pessoais de interface não são atividades
  comerciais.

## Listagem e aviso de seleção

Chat, seletor e jornada usam a mesma consulta de negociações do contato, reunindo
participação e vínculos de conversa sem duplicar cards. A listagem não depende de
uma sincronização prévia da interface. Vínculos removidos permanecem visíveis como
histórico e não são reativados pela leitura.

Negociações em andamento aparecem antes das vendidas, perdidas ou pausadas. O
seletor mostra o histórico desabilitado; somente cards vinculados e em andamento
podem ser atuais. Havendo opções em andamento e nenhuma selecionada, o responsável
recebe o aviso de escolha, mesmo que já existam cards associados ao contato.

A lista do chat atualiza após alterações e em segundo plano a cada 15 segundos.
Na jornada, “Card em visualização” identifica apenas a página aberta, sem indicar
uma seleção operacional. Ao abrir pelo atendimento, a jornada prioriza o contato
da conversa e informa explicitamente o nome do contato consultado.

## Consistência

O contexto possui versão própria. Notas pendentes preservam a versão da seleção
em que foram compostas; uma troca posterior exige revisar o destino. Reenvios
com o mesmo identificador de nota retornam o registro original, sem duplicá-lo.

As mutações do chat serializam pelo registro da conversa. A ação e seu registro
na negociação são gravados na mesma transação. A sincronização legada com RD usa
somente o ID externo do card validado, sem escolher o card fixado no contato.
Falhas externas não desfazem uma tarefa já salva no CRM local.

## Implantação e verificação

A migração aditiva `0045_conversation_deal_context.sql` está registrada em
`scripts/apply-platform-access-migration.mjs`, executado pelo `npm start` antes
do servidor. Não remove nem reatribui dados existentes; os contextos são criados
conforme as conversas são consultadas. Aplicar a migração antes de servir o código
novo. Em desenvolvimento, usar o procedimento de migração do ambiente correto.

As suítes `conversation-deal-context.integration.test.ts` e
`contact-deal-associations.integration.test.ts` usam PostgreSQL WASM em memória,
com `PGLITE_TEST_MODULE` apontando para o módulo PGlite instalado para testes.
Executá-las em processos separados, pois substituem os módulos de banco e sessão.
Nenhuma migração ou suíte deste trabalho foi executada em banco operacional.

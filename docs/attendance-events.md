# Eventos do atendimento

O fluxo é unidirecional: uma ação do atendimento gera um registro em
`attendance_events` e um evento no CRM local da negociação atual. Alterações
comerciais no CRM não escrevem mensagens nem eventos no atendimento.

## Garantias

- A ação persistida, o evento e sua projeção no CRM pertencem à mesma transação.
- O destino fica registrado na ação. Trocar a negociação atual não move registros
  anteriores. Recibos de envio usam o destino da mensagem original.
- Sem card atual, o registro fica pendente. A seleção vincula somente pendências
  do mesmo atendimento ainda aberto; encerrar e reabrir inicia outro ciclo.
- Reenvios usam a chave da origem. Atualizações sem mudança de estado não geram
  outro evento. Abrir uma nota é diferente de salvar uma nota.
- A leitura dos eventos é paginada e autorizada pela conversa, com tenant da
  sessão. Não depende do lote de mensagens aberto na interface.
- Não há reconstrução automática de fatos antigos. Notas e registros anteriores
  continuam disponíveis na linha do tempo, identificados como históricos.

## Origens cobertas

A migration `0046_attendance_events.sql` captura criação e movimentação do
atendimento, coleta e estados da triagem, reconhecimento e recuperação de dados,
mensagens e anexos persistidos, notas internas, recibos e falhas de envio,
reações do operador e estados de ligações WebRTC. Tarefas do Conversas são
identificadas pela mensagem autoritativa que guarda o ID da atividade.

A abertura do formulário de nota usa uma rota com tipos permitidos, sessão,
permissão, propriedade da conversa, versão do contexto e chave de idempotência.
O cliente não pode declarar que concluiu uma ligação ou inventar o autor de
uma ação. A conexão da chamada é registrada após o navegador informar a conexão
WebRTC; abrir o link só registra a entrada do cliente.

Edições de dados/etiquetas no Conversas enviam `X-Attendance-Conversation`.
A rota verifica o vínculo com o contato e o responsável sob lock, e grava o
evento junto com a alteração. Edições feitas pelo cadastro/CRM não usam essa
origem. O briefing de triagem também respeita o card atual, mesmo que o recibo
original da triagem contenha outra negociação.

Novas ações que não alterem essas origens devem chamar `recordAttendanceEvent`
dentro da própria transação, com chave estável e ator obtido da sessão ou da
persona central. Não registrar conclusões no navegador nem disparar chamadas
externas de dentro dos triggers. Integrações externas mantêm seu transporte
próprio; a garantia transacional desta entrega é entre Eventos e o CRM local.

## Aplicação e testes

A inicialização normal aplica a migration aditiva, uma vez, pelo executor de
migrations da plataforma. Não é necessário reset ou seed. Os testes de integração
usam PostgreSQL WASM isolado e aplicam a migration duas vezes para verificar sua
idempotência, sem acessar bancos operacionais.

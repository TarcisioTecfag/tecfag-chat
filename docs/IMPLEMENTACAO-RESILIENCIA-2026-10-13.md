# Implementação de resiliência — 13/10/2026

Esta entrega corrige a base de recuperação local descrita na auditoria. Ainda não foi publicada nem aplicada no banco operacional. A captura externa de webhooks foi excluída por orientação do usuário; recuperação de eventos que nunca chegaram continua dependendo do provedor e de reconciliação assistida.

## Mudanças implementadas

- Inicialização Railway executa somente `npm run start`. Foram removidos do startup o push forçado de schema, seeds, reset, limpeza de operadores e reatribuições comerciais. O reset legado global foi bloqueado; o comando de reset exige o fluxo administrativo por tenant.
- Índices únicos de idempotência WhatsApp passam a fazer parte do schema e do migrador de startup. Migration aditiva `0036_durable_recovery.sql` cria a inbox RD e campos de reserva de despacho e auditoria.
- `/api/health` consulta banco e tabelas essenciais, possui timeout e retorna 503 quando a dependência não está pronta.
- Build usa preset Node persistente. Workers iniciam no carregamento do plugin, sem depender de `listen`; singletons compartilhados entre chunks Nitro/SSR evitam sessões e jobs duplicados. O fallback WebSocket reconhece o contexto Node do Nitro 3.
- Webhook RD responde 202 somente depois de guardar payload e configuração. O card é criado depois, por worker, com resultado individual por lead. Reserva exclusiva, retomada após crash, espera crescente e replay administrativo preservam cards já concluídos. Configurações RD exibem fila e erros por item.
- WhatsApp guarda intenção `pending` e envelope completo. Reserva atômica evita que dois workers despachem a mesma mensagem. Interrupção durante tentativa vira `unknown` em ambos os canais; não existe reenvio automático incerto. Timeout em consulta Meta anterior à tentativa pode aguardar nova tentativa; timeout durante envio fica desconhecido. Reenvio manual de resultado desconhecido exige verificação explícita do operador.
- Anexos são preservados antes de enviar, e recuperação restaura mídia, template, variáveis, citação e identidade do destinatário. Chaves existentes, inclusive mensagens já lidas, não geram novo envio.
- Entrada Meta grava contato/conversa/mídia/mensagem/conclusão em transação. Repetição concorrente não duplica mensagem nem contador, e evento atrasado não substitui preview mais recente.
- Baileys guarda o evento bruto antes de processar; inclui `append`, histórico e mensagens do dispositivo vinculado. Histórico antigo mantém timestamp, não dispara SDR/resposta de pausa e não reabre atendimento automaticamente. Reconexão respeita canal configurado e repete boot se banco estiver indisponível. Falha de download/persistência de mídia não confirma o evento; cache em disco é opcional após preservar bytes no banco.
- Chat do operador preserva texto/anexos em IndexedDB, com empresa, operador, conversa e chave estável. Falhas e recargas deixam uma pendência recuperável. Recuperação manual mantém o alvo original; descartes são explícitos.
- Widget preserva payloads locais e remove pendência depois do ACK do servidor. Recebimento usa ID estável por empresa e visitante; histórico retorna mensagens recentes. Isso protege mensagens enviadas pelo visitante, sem prometer retomada completa da resposta de IA do widget.
- Retomada SDR cobre até 24 horas, busca telefone no cadastro e respeita tenant/gate de implantação. Auditorias usam reserva com vencimento e recuperam `processing` interrompido. Engines de gestão têm inicialização explícita no plugin e desligamento no fechamento.

## Publicação segura e snapshots

O usuário informou que ainda não existem backups configurados. **Um snapshot operacional deve ser criado e sua restauração validada antes da publicação.** Este documento não confirma a existência de backup real.

1. Criar snapshot do PostgreSQL no provedor e registrar horário, identificador, versão do banco e responsável. Copiar o backup para armazenamento separado quando possível.
2. Garantir inclusão de dados de chat/CRM, inboxes, mídia em `media_files`, configurações e credenciais persistidas. Arquivos apenas em volume/disco e segredos de ambiente precisam de proteção própria.
3. Restaurar em banco isolado; conferir schema, amostra de mensagens, cards, arquivos, credenciais protegidas e consistência por tenant. Não conectar a cópia aos números/contas de produção.
4. Confirmar a configuração efetiva Railway: ela pode ter override do arquivo versionado. Remover também eventuais comandos de reset/seed do painel.
5. Aplicar migração em homologação e verificar índices. Se existir duplicação histórica que impeça índice único, interromper a publicação e tratar os dados com inventário; não apagar registros automaticamente.
6. Publicar em janela acompanhada. Verificar readiness, reconexão Baileys, worker RD, estado dos envios e volume de exceções.
7. Rollback deve manter schema aditivo e segurança de sessão. Não restaurar banco antigo nem reenviar filas automaticamente só para voltar uma versão da aplicação.

Ferramenta opcional: `scripts/backup-database.mjs` executa `pg_dump` em formato custom, com destino explícito, sem carregar `.env`, sem imprimir senha e sem sobrescrever arquivo existente. A ferramenta produz backup; **a conclusão do comando não prova restauração**. Configurar `PG_BIN` se os binários PostgreSQL não estiverem no PATH. Não guardar backup de produção no Git.

## Limites e próximas entregas

| Item | Estado nesta entrega |
| --- | --- |
| Eventos aceitos pela aplicação | Inbox/outbox locais implementadas; testes de falha e concorrência disponíveis |
| Evento que nunca chegou durante queda total | Receptor externo excluído pelo usuário; não há garantia de recuperação local |
| Snapshots de produção e retenção | A criar/configurar pelo responsável pela infraestrutura; ainda não verificados |
| Desastre com perda do PostgreSQL | Exige backup/restore operacional e reconciliação do intervalo posterior ao snapshot |
| Saúde dos provedores e alertas externos | Health essencial melhorado; painel completo de capacidade/alertas externos ainda pendente |
| Toda saída SDR/follow-up/bridge/relatório | Existem caminhos diretos legados; a migração integral dessas ações para jobs duráveis continua pendente |
| Entrega de relatório por destinatário, SMTP e chamadas | Exigem outbox específica e reconciliação externa; não abrangidas integralmente nesta entrega |
| Resposta de IA do widget interrompida | Mensagem do visitante fica preservada; job da resposta ainda precisa de durabilidade própria |
| Credenciais rotativas RD e credenciais legadas de voz | Exigem tratamento específico e rotação operacional; não consideradas resolvidas |
| Mídia Baileys cujo download falhou | Entrada fica pendente para nova tentativa; conteúdo que deixou de estar disponível no provedor exige recuperação assistida. Download secundário usado pela IA ainda necessita tratamento próprio |
| Janela SDR acima de 24h | Não há retomada automática para evitar contato obsoleto; requer revisão humana |

Portanto, esta entrega **não certifica todos os 40 cenários como resolvidos**. Ela implementa as proteções principais do RD, transporte do chat e retomada local. As linhas pendentes acima precisam de entregas seguintes antes de uma declaração de continuidade integral.

## Validação

Utilizar PostgreSQL descartável local com `test` no nome e `TEST_DATABASE_URL`. A suíte recusa banco remoto ou não vazio. Provedores são substituídos por adaptadores de teste nos testes de despacho; nenhum WhatsApp real deve ser acionado.

- `test/resilience.test.ts`: saúde falha/lenta e restauração do envelope.
- `test/rd-marketing-integration.test.ts`: ACK durável, exclusão mútua, lease vencido há duas horas, replay parcial, isolamento, entrada concorrente, cronologia, envio incerto e encerramento real de processo antes/depois de criar card.
- Testes existentes de identidade Meta, templates, seleção/mapeamento RD e comportamento do chat.

O vencimento de duas horas é simulado no banco; o processo filho termina de verdade nos testes de crash. Isso comprova aspectos de persistência e retomada, mas não substitui ensaio de queda do Railway, confirmação de entrega pelo provedor ou teste visual completo em navegadores reais.

Validação local registrada: **65 testes passaram (250 verificações, sete arquivos)**, TypeScript e builds do aplicativo e do widget concluíram. Os testes adicionais cobrem upload durável sem duplicação no replay, ordem por conversa, echo do dispositivo, revisão de envelopes antigos incompletos, confirmação manual de resultado desconhecido, timeout Meta antes/durante envio e mídia indisponível sem confirmar placeholder. A migração `0036` foi reaplicada duas vezes no banco descartável. O servidor Node produzido respondeu 200 com banco acessível e outra execução respondeu 503 com conexão inacessível. Os logs confirmaram início único dos workers de gestão e do worker durável após compartilhar serviços entre chunks. Foi gerado dump de teste de 239.548 bytes e restaurado em outro banco local, com eventos e índices de idempotência presentes. Esse restore não é um backup de produção.

A parada/reinicialização real do PostgreSQL temporário foi bloqueada pela revisão automática, com retorno genérico `blocked by policy`; utilizou-se uma conexão local inacessível para o teste HTTP de indisponibilidade.

O cluster descartável usado nos ensaios fica em `C:/Users/TECFAG~1/AppData/Local/Temp/valem-resilience-pg-20261013`, com acesso exclusivamente local na porta `55439`, contendo apenas dados sintéticos. Seu encerramento permanece pendente após o bloqueio. Os servidores Node auxiliares são encerrados ao concluir os ensaios.

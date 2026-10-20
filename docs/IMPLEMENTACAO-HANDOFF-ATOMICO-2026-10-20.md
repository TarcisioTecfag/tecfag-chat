# Triagem industrial: transferência atômica e recuperação

Data: 20/10/2026. Continuação do [núcleo de triagem](./IMPLEMENTACAO-NUCLEO-TRIAGEM-2026-10-20.md) e da etapa E2 do [mapa do porte](./MAPA-PORTE-FAGNER-2026-10-20.md).

Atualização posterior: catálogo/Decisor e destinos por ID foram conectados no [lote seguinte](./IMPLEMENTACAO-CATALOGO-DESTINOS-2026-10-20.md). Os testes e limites abaixo registram o estado desta entrega E2.

Este lote implementa a consistência da distribuição industrial no CRM e atendimento locais. O site ainda precisa ser integrado ao núcleo, e a continuidade site ↔ WhatsApp continua pendente. Não houve deploy, mudança de configuração operacional, habilitação do SDR ou acesso ao banco operacional para validar este trabalho.

## O que passa a ser garantido pelo banco

O motor industrial usa `industrial-handoff-store.ts`. O alocador anterior rejeita chamadas industriais sem o contrato transacional; o caminho não industrial conserva a distribuição anterior.

1. Uma conclusão válida grava primeiro um checkpoint em `agent_flow_states.metadata.handoffRequest`, com destino e coleta. A primeira conclusão fica estável durante as tentativas do mesmo ciclo.
2. A efetivação obtém lock consultivo por tenant para o rodízio e bloqueia as linhas da conversa e do fluxo. Verifica o ciclo mais recente, posse, configuração SDR habilitada e whitelist atual antes de distribuir.
3. Seleciona somente IDs de operadores cadastrados no tenant e explicitamente autorizados para o destino. Não usa nome/e-mail como identidade de autorização nem desvia para outra área. Escala com ID duplicado falha sem efeitos parciais.
4. Na **mesma transação PostgreSQL**, cria/reutiliza o card e seus vínculos/eventos, atribui a conversa, incrementa sua versão, atualiza a carteira, incrementa a contagem, consome a compensação e conclui o fluxo com recibo.
5. O recibo usa tenant, conversa, ID do fluxo e `startedAt` do ciclo. Outra execução retorna o resultado registrado com `replayed: true`, sem criar card, contar ou distribuir novamente.
6. Qualquer erro anterior ao commit reverte os efeitos. Uma transação posterior registra a pendência e agenda a tentativa seguinte. O checkpoint anterior sobrevive mesmo se essa gravação de falha também ficar indisponível.

Pedidos de humano/revisão continuam podendo transferir sem negociação comercial. Subfluxos informativos encerram com recibo, sem rodízio ou card. Falta de equipe mantém o fluxo pendente. Tomada humana/finalização anterior à atribuição impede o sorteio; uma intervenção posterior ao commit permanece soberana e não é sobrescrita pelo replay.

O helper `ensureLocalCrmDealBeforeTransfer` aceita a transação do chamador e propaga erros nesse modo. O contrato anterior, que abre sua própria transação e retorna erro estruturado, permanece disponível para chamadas independentes. Mantidas as regras estritas da pessoa, do funil e da janela de três horas.

## Configuração concorrente e retomada

As mutações industriais da escala compartilham o lock da distribuição. Edições comuns preservam contagem, recentes e saldo atuais; alterações de saldo e reset usam ações explícitas sob lock. Isso evita uma tela desatualizada apagar contagens de distribuições recentes. `operatorsMap` é sincronizado na mesma gravação.

O plugin `industrial-triage-recovery.ts` busca checkpoints prontos a cada 30 segundos, com lote de até 20 por tenant e recuo progressivo entre 30 segundos e 15 minutos nas pendências. Só consulta fluxos de perfis industriais com configuração SDR explicitamente habilitada. O executor revalida habilitação, whitelist, posse e ciclo dentro da transação. Fluxos antigos da mesma conversa são excluídos do lote.

Essa recuperação funciona no servidor independentemente de uma reconexão Baileys ou de uma nova mensagem. Não chama IA, não escolhe o provedor do canal e não envia confirmação adicional ao cliente. O motor e a recuperação SDR anterior reconhecem esses checkpoints e não refazem sua classificação. Após o commit, a recuperação atualiza a interface e tenta avisar o operador.

Nenhuma migration foi necessária: checkpoint e recibo usam o estado de fluxo existente. Nenhuma equipe, funil ou configuração de operação foi criada para ativar esse mecanismo. Operadores com identificadores antigos/aliases na escala precisam ser corrigidos para os IDs reais antes da habilitação.

## Validação reproduzível

Suíte de regras sem banco: `npm run test:triage` — **84 testes aprovados**.

Integração real: `npm run test:triage:postgres` — **18 cenários aprovados** em uma instância PostgreSQL 18 temporária, exclusiva desta tarefa, na interface local e porta 55439. O comando usa Bun com `--no-env-file`. Exige `TEST_DATABASE_URL` explícita, host local e banco com `test` no nome; não aceita fallback para `DATABASE_URL`.

```powershell
$env:TEST_DATABASE_URL = 'postgres://usuario:senha@127.0.0.1:porta/banco_test'
npm run test:triage:postgres
```

A suíte cria um schema aleatório dentro desse banco, deriva as colunas do schema Drizzle atual, aplica as referências internas e índices únicos pertinentes e remove somente esse schema no encerramento. Não executa migrations nem seeds do aplicativo. A instância temporária usada nesta tarefa foi parada após a validação.

Os cenários verificam:

- 12 execuções simultâneas de um ciclo: um card, uma atribuição e uma contagem;
- 10 conversas concorrentes: distribuição equilibrada e sem operador de outro tenant;
- falha forçada por trigger após card, atribuição e carteira: rollback completo e retry único;
- exceção após criação do card, cancelamento e recuperação entre instâncias;
- tomada humana antes/durante a transação e replay após intervenção;
- tenant incorreto, ciclo antigo, SDR desativado e whitelist;
- edição antiga da escala, oito ajustes simultâneos de saldo e equipe indisponível;
- orientação sem card, humano sem card e funil CRM ausente;
- dois workers concorrentes, reutilização em até três horas e novo card após três horas;
- fluxo mais recente e operador duplicado na escala.

Resultados e hashes dos arquivos: [evidência E2](./fagner-handoff-atomic-v1-2026-10-20.json).

Build Vite/Nitro e lint dos módulos novos aprovados. A compilação de tipos focada nos adaptadores, motores modificados, plugin e teste de integração não encontrou diagnósticos nesses arquivos. A checagem global de TypeScript continua reprovada em outras partes do checkout, incluindo contatos/CRM, assistente, notificações e rotas alteradas em paralelo. Isso continua sendo uma pendência da homologação do conjunto; o build não substitui essa checagem.

## Limites e sequência

A garantia transacional cobre os efeitos locais da transferência. Notificações SSE, aviso interno ao operador e envio de confirmação ao cliente acontecem após o commit: uma queda nesse intervalo pode perder o aviso, sem repetir a distribuição. Entrega durável desses avisos, cancelamento de todas as mídias e filas e recuperação de falhas anteriores à criação do checkpoint continuam em E5. O recibo é histórico e não reaplica uma carteira/responsável depois de intervenção humana.

Pendências de lotes antigos, geradas antes deste contrato, não são reconciliadas automaticamente. A escolha do CRM ainda usa nomes de funis e etapas; o vínculo explícito por IDs e o catálogo/Decisor pertencem ao próximo lote. Testes com PostgreSQL validam a transação e a recuperação; não homologam comunicação real por Meta/Baileys, IA, o widget ou a operação completa.

O próximo passo do porte é ligar catálogo/Decisor e os destinos por ID e, então, integrar o site ao núcleo compartilhado e à continuidade segura para WhatsApp. O RD Marketing permanece independente.

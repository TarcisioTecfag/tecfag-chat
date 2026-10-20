# Implementação — Etapa E5: Silêncio, Follow-up, Sem Resposta e Resiliência Pós-Commit (2026-10-20)

## Objetivo
Concluir a **Etapa E5** do mapa de migração do Fagner (`docs/MAPA-PORTE-FAGNER-2026-10-20.md`), entregando:
1. Política industrial de silêncio, follow-up, transição automática para **Sem Resposta** (`sem_resposta` / `outcome: "abandoned"`), resgate parcial no site sem fabricar confirmação e respeito ao expediente comercial (`C21`, `C22`, `C23`, `S13`, `B15`, `H21`).
2. Outbox durável pós-commit (`handoffOutbox`) para garantir entrega da notificação interna do operador e da mensagem de confirmação de transferência ao cliente após reinício do servidor (`E2/E5`, `H19`).
3. Recuperação multi-canal de turnos interrompidos em **Meta, Baileys e Site** sem depender de `connection.open` do Baileys, com proteção de janela de debounce (`45s`), backoff exponencial e limite máximo de 3 tentativas por mensagem (`B16`, `C04`, `H19`).
4. Correção da janela de histórico (`B17`, `H20`) para buscar as **últimas 80 mensagens** do ciclo atual em ordem cronológica, cancelamento imediato de debounce/silêncio em captura ou mensagem humana (`H14`), e resolução explícita de provedor WhatsApp (`B19`).

---

## Principais Entregas e Arquivos

### 1. Política Industrial de Silêncio, Expediente, Sem Resposta e Recuperação (`src/lib/triage/industrial-silence-policy.ts`)
- **`parseIndustrialScheduleConfig` / `isWithinIndustrialSchedule` / `getNextIndustrialOpenInfo` / `buildIndustrialOffHoursClosingNotice`**:
  - Expediente comercial padrão configurável (`8h–18h`, segunda a sexta, `America/Sao_Paulo`).
  - Bloqueia o envio de follow-ups fora do expediente e gera aviso honesto de retorno no próximo dia útil quando um atendimento é transferido fora do horário comercial.
- **`parseIndustrialSilenceConfig` / `evaluateIndustrialSilence` / `buildIndustrialFollowUpText` / `buildIndustrialReactivationPatch`**:
  - Estágio 1 aos **25 min** de silêncio após a última mensagem do bot; Estágio 2 após **+20 min**; transição para **Sem Resposta** (`funnelStage: "sem_resposta"`, `outcome: "abandoned"`, preservando `preSilenceFunnelStage`) após **+30 min** do Follow-up 2 ou no fim do dia (**20h BRT**).
  - Resgate parcial de lead no canal Site após **10 min** de silêncio quando já houver nome ou empresa + interesse coletados, sem inventar confirmação ou avançar prontidão.
  - Cancelamento imediato quando há operador alocado, `queueState !== "automacao"` ou mensagem humana (`senderType === "agent"`).
  - Deduplicação determinística por `(tenantId, flowId, cycle, stage)` via `deterministicIndustrialFollowUpMessageId`.
  - Reativação automática (`buildIndustrialReactivationPatch`) quando o cliente volta a responder após follow-up ou `sem_resposta`.
- **`selectRecentCycleMessages`**:
  - Normaliza as mensagens mais recentes do ciclo atual (até 80) em ordem estritamente cronológica (`sentAt ASC, id ASC`).
- **`evaluateIndustrialTurnRecovery`**:
  - Avalia conversas em `automacao` cuja última mensagem é do cliente sem resposta do bot há pelo menos `45s`, respeitando `SdrDebouncer.isBusy`, backoff exponencial (`60s`, `120s`, `240s`) e teto de 3 tentativas por `lastClientMessageId`.

### 2. Motor Autônomo de Silêncio Industrial + Preservação da Valem (`src/lib/valentina/sdr-followup-engine.ts`)
- Mantém o loop legado da **Valem** (`runLegacyFollowupCycle`: 6 min / 15 min / 20 min) 100% intacto.
- Adiciona `runIndustrialSilenceCycle` para tenants com `triagePolicy === "industrial"`, suportando WhatsApp (Meta/Baileys) e Site (`sendSdrChannelText`), com claim atômico de `followUpStage` em `agentFlowStates` e emissão de `sdr_flow_updated` ao mover para `sem_resposta`.

### 3. Outbox Pós-Commit de Handoff e Recuperação Multi-Canal (`src/lib/triage/industrial-handoff-store.ts`, `src/lib/triage/industrial-handoff-recovery.ts`, `src/lib/valentina/sdr-recovery.ts`, `server/plugins/industrial-triage-recovery.ts`)
- **`handoffOutbox` em `agentFlowStates.metadata`**:
  - Gravado junto com `handoffReceipt` no commit transacional do handoff industrial.
  - Rastreia `operatorNotified` e `clientNotified` com `attempts` e `nextAttemptAt`.
  - `claimPostCommitOutbox` e `ackPostCommit` garantem que, se o servidor reiniciar logo após o commit da transferência, o worker `recoverIndustrialPostCommitOutbox` entregue a notificação interna do operador (idempotente por `cycle` em `operator-notifications.ts`) e a confirmação de transferência ao cliente (`deterministicIndustrialHandoffConfirmMessageId`).
- **`recoverIndustrialInterruptedTurns`**:
  - Executado periodicamente pelo plugin `server/plugins/industrial-triage-recovery.ts` (e também no `recoverInterruptedConversations`), cobrindo Meta, Baileys e Site.

### 4. Correções de Concorrência, Histórico e Canal (`src/lib/valentina/sdr-engine.ts`, `src/lib/valentina/sdr-channel-sender.ts`, `src/routes/api/chats/update-queue.ts`, `src/routes/api/whatsapp/send.ts`)
- **`B17` / `H20`**: `sdr-engine.ts` agora busca `.orderBy(desc(messages.sentAt), desc(messages.id)).limit(80)` e aplica `selectRecentCycleMessages` para preservar sempre as últimas 80 mensagens do ciclo atual em ordem cronológica.
- **`H14`**: `update-queue.ts` e `whatsapp/send.ts` limpam imediatamente `SdrDebouncer.getInstance().clearSession(conversationId)` quando um operador humano assume/altera a fila ou envia mensagem; `update-queue.ts` também encerra o ciclo de silêncio ativo em `agentFlowStates`; `sdr-engine.ts` valida propriedade da conversa antes de enviar imagens de catálogo e áudio PTT dinâmico.
- **`B19`**: `sdr-channel-sender.ts` expõe `resolveConfiguredWhatsappProvider(tenantId)` sem hardcode de `tenantId === "tecfag"`, além do helper unificado `sendSdrChannelText` com suporte a `idempotencyMessageId` e verificação de propriedade.

---

## Validação Executada
- `npm run test:triage` — suítes `industrial-triage`, `industrial-catalog`, `industrial-site-channel` e `industrial-silence-resilience` 100% verdes.
- `tsc --noEmit` — zero erros TypeScript em todos os arquivos novos e modificados da Etapa E5.
- `npm run build` — build de produção concluído com sucesso.

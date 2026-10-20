# Diagnóstico de encaminhamento e entrega pós-commit — E6, lote 2

Data: 20/10/2026. Continuação de `IMPLEMENTACAO-MONITOR-METRICAS-2026-10-20.md`. Alterações locais, sem ativação de SDR ou alteração de dados da operação.

## Causas persistidas e orientação ao operador

O handoff agora registra códigos controlados para SDR/site desativados, restrição de teste, contato indisponível, configuração inválida, destino ausente, setor estrangeiro/removido, funil/etapa inválidos, escala ausente/inconsistente, ausência de elegível, falha de CRM, atribuição não confirmada, cancelamento e falha de transação.

Cada ocorrência tem versão, ciclo, código, horário e contador de repetição. O histórico de causas mantém até 20 mudanças do ciclo. Repetir o mesmo problema atualiza a ocorrência; confirmar a transferência limpa a pendência atual e preserva o histórico. Erros de SQL, mensagens de exceção, credenciais e prompts não entram no diagnóstico público.

O painel mostra título e orientação operacional. Causas de outro ciclo ou superadas por atendimento humano/recibo atual não reaparecem como pendência ativa. Registros antigos sem diagnóstico permanecem sem causa específica; não se inventa uma explicação retroativa.

A transação principal continua abrangendo card, atribuição, carteira, contador e recibo. A causa de falha é gravada em uma transação posterior ao rollback, somente se o ciclo ainda estiver atual e com a automação. A tomada humana e o recibo já confirmado continuam impedindo uma nova distribuição.

## Correções encontradas na recuperação

1. O plugin usava `deliverPostCommit` e campos de um contrato anterior, enquanto o recuperador exigia `deliverOutbox` e `receipt.result`. O plugin agora usa o contrato tipado atual e a mesma função de entrega do caminho imediato do SDR.
2. Mudança/remoção do responsável ou fechamento marcavam timestamps de envio para encerrar a fila, mesmo sem enviar. Agora há cancelamento explícito, preservando a diferença entre envio e dispensa. Pendências canceladas não entram novamente na seleção do worker.
3. A entrega ao operador e a confirmação ao cliente são independentes. Falha em uma não apaga o sucesso da outra; a recuperação tenta somente o que falta. Após seis tentativas, o painel mostra esgotamento; o card e a atribuição não são refeitos.
4. O caminho imediato não marca confirmação ao cliente pelo simples retorno de uma função de envio. Usa a outbox, o texto persistido e o resultado real do despachante.
5. O despachante não trata uma mensagem pendente como prova de envio. A busca de idempotência inclui tenant e conversa; a resposta Baileys sem identificador não confirma envio. O site recebe IDs estáveis tanto no histórico comum quanto no histórico do widget.

`sent` indica aceitação pelo transporte ou persistência da mensagem no canal do site para reconexão; não comprova leitura pelo cliente. Uma falha entre aceitação externa e gravação da prova local ainda pode exigir reconciliação. Este lote não promete entrega externa exatamente uma vez.

## Verificação

Resultados, diagnósticos de tipos e hashes estão em `fagner-handoff-causes-2026-10-20.json`.

Resultado final: **208 testes em 18 suítes, 38 cenários PostgreSQL, build e lint dos dez arquivos de núcleo/plugin/testes aprovados.** A checagem de tipos, incluindo o plugin de recuperação, mantém os 21 diagnósticos preexistentes, sem novos erros. O banco local de teste foi desligado ao final.

- Suíte Node sem banco/provedores: política, diagnóstico, handlers e entrega. O despachante real é executado com banco/transporte isolados por allowlist de imports.
- PostgreSQL local isolado: rollback e causa, recuperação, configuração inconsistente, escala, cancelamento, reservas concorrentes, êxito parcial, seis tentativas e isolamento de tenant/ciclo. Não usa migrations ou seeds operacionais.
- TypeScript inclui também o plugin em `server/plugins`, fora do `include` normal do projeto. Essa verificação adicional é necessária para detectar incompatibilidade na ligação do worker.
- ESLint dos módulos, plugin e testes alterados, build e verificação do diff. O lint global e os erros de tipos anteriores continuam sendo pendências do projeto.
- Sem chamadas ao Vertex, envio a canais reais ou validação visual em navegador. A homologação completa e os testes de reinício/queda de transporte continuam pendentes.

## Paridade atual

A [matriz das 47 capacidades](./MATRIZ-PARIDADE-FAGNER-2026-10-20.md) atualiza o diagnóstico histórico com evidências e lacunas de cada item. Além do monitor, existem pendências de notas/briefing, score, origem/produto do site, VTEX, preço/frete, pedidos confirmados, avaliação e exportações. A unificação da triagem não comprova paridade dessas capacidades.

# Retomada do porte Fagner — 20/10/2026

Checkpoint posterior: [integração VTEX — etapas 1 a 4, em 21/10/2026](./RELATORIO-INTEGRACAO-VTEX-ETAPAS-1-A-4-2026-10-21.md). Implementados catálogo, preço/frete por canal, configuração segura e homologação técnica isolada, com consultas públicas reais à loja. Nenhuma ativação, publicação do widget ou virada foi realizada. Os checkpoints abaixo permanecem históricos.

Atualização de 21/10/2026: implementados [destinos unificados](./UNIFICACAO-DESTINOS-TRIAGEM-2026-10-21.md) e [origem/campanha e consulta de produto do site](./CONTEXTO-SITE-PRODUTO-2026-10-21.md). Os números e descrições abaixo são checkpoints históricos; a matriz e os relatórios posteriores indicam os avanços atuais. A continuidade técnica inclui política e integração VTEX, proatividade industrial e as demais lacunas registradas na matriz, antes da homologação/corte.

O checkout já avançou até a implementação de silêncio e recuperação (E5). O próximo lote funcional é E6: monitoramento, métricas e paridade das telas. **Implementação presente no código não significa homologação ou ativação em produção.**

Continuação após este checkpoint: [primeiro lote E6 — monitor e métricas reais](./IMPLEMENTACAO-MONITOR-METRICAS-2026-10-20.md). As verificações e os hashes abaixo registram a retomada anterior; a evidência de E6 está separada para preservar esse histórico.

Checkpoint mais recente: [E6, lote 4 — briefing final e revisão humana](./IMPLEMENTACAO-BRIEFING-REVISAO-2026-10-20.md), após o [lote 3 — histórico e notas](./IMPLEMENTACAO-HISTORICO-NOTAS-2026-10-20.md) e o [lote 2 — causas e entrega](./IMPLEMENTACAO-CAUSAS-HANDOFF-2026-10-20.md). A [matriz de paridade](./MATRIZ-PARIDADE-FAGNER-2026-10-20.md) mostra as lacunas atuais. Nenhum desses lotes ativa o SDR ou aprova a homologação operacional.

Esta retomada conferiu o Git, os fontes e os relatórios existentes. O checkout estava limpo no início, no commit `efdb987`. Foram preservados os avanços registrados após o resumo anterior da conversa.

## Decisões mantidas

- Fagner Site e Fagner Conversas formam um único atendimento, com o mesmo núcleo de triagem.
- O atendimento acontece no site e pode continuar no WhatsApp com contexto e responsável.
- CRM e atendimento nativos são o destino da triagem; RD Marketing permanece separado.
- Valem permanece isolada e operando. A configuração de provedor é por tenant.
- Nenhuma ativação do SDR, importação de catálogo, escrita em banco operacional ou virada foi realizada nesta retomada.

## Estado encontrado

| Bloco | Evidência no checkout | Estado e limite |
|---|---|---|
| Mapeamento do legado | `MAPA-PORTE-FAGNER-2026-10-20.md` | 47 capacidades inventariadas, 13 subfluxos e cenários de homologação. Documento de diagnóstico histórico. |
| Política de triagem | `src/lib/triage/industrial-policy.ts`, `industrial-ai-result.ts` | Coleta por intenção, validação matemática de CPF/CNPJ, precedência de suporte/financeiro/peças, pedido humano e revisão. Testes locais não comprovam a qualidade de todas as respostas do modelo. |
| Handoff e CRM | `industrial-handoff-store.ts`, `industrial-handoff-recovery.ts`, `sdr-crm-local.ts` | Transação, recibo por ciclo, card, responsável, carteira e contador; recuperação de pendências. Há testes de concorrência com PostgreSQL separado. |
| Catálogo e destinos | commit `0e7990f`, relatório de catálogo | Decisor por evidência e catálogo, destinos por IDs, edição administrativa com revisão. O catálogo histórico preparado ainda depende de conferência. |
| Site no mesmo núcleo | commit `7a330c9`, relatório de site | Widget industrial entra no mesmo SDR; atendimento aparece em Conversas; canal depende de habilitação explícita. Atendimento humano pelo site suporta texto; anexos e templates nessa saída ainda têm restrições. |
| Continuidade site → WhatsApp | commit `40f0e94`, relatório de continuidade | Código temporário de uso único, vínculo no tenant, cópia de mensagens e coleta, preservação de responsável/card. O fluxo completo com canal real ainda precisa de homologação. |
| Silêncio, retomada e pós-commit | commit `efdb987`, relatório de resiliência | Régua industrial, horário comercial, recuperação de turnos, histórico recente e outbox persistida. Testes puros cobrem política; falhas de transporte e reinício do servidor ainda exigem homologação integrada. |
| Monitoramento e métricas | `src/routes/api/valentina/agents.ts`, `src/components/valentina/SdrTab.tsx` | Existem telas e leitura de sessões. A API de agentes ainda usa `mockMetrics`; `activeFlows` conta todos os fluxos do tipo, inclusive encerrados. E6 está pendente. |
| Importação e virada | E7 e E8 do mapa | Pendentes: reconciliação, homologação com a equipe, corte por canal e rollback. |

## Correções feitas durante esta retomada

### Reabertura do atendimento no site

Antes, a reabertura apagava os fluxos antes de verificar novamente a situação da conversa. Duas entradas concorrentes podiam reiniciar a coleta duas vezes; uma tomada humana entre a leitura inicial e a transação podia perder seu estado de triagem. Fluxos de outros agentes também eram removidos.

Agora `site-conversation-store.ts` trava a conversa antes dos fluxos, revalida `finalizados` dentro da transação e reinicia somente o SDR. Uma segunda execução não reinicia o ciclo. O novo ciclo limpa o setor anterior junto com o responsável; o evento da interface inclui a versão realmente persistida. Retry de uma mensagem já registrada não abre um novo ciclo após o encerramento.

### Contexto recente na continuidade

A consulta copiava as primeiras 200 mensagens do site. Agora busca as últimas 200, exclui notas internas, aplica tenant e conversa e devolve ordem cronológica com desempate por ID. A interpretação de mídia permanece nos registros copiados. A janela continua limitada a 200 mensagens; não é uma exportação integral do histórico.

### Validade do código

Prazo ausente ou malformado produzia `NaN`, que não era considerado expirado pela comparação antiga. A validação agora exige prazo válido e futuro e rejeita registros consumidos ou corrompidos. Hash por tenant e consumo transacional continuam existentes.

## Validação

Resultados e hashes desta retomada constam em `fagner-retomada-2026-10-20.json`.

- Suíte sem provedor: `npm run test:triage` — 164 testes aprovados, em 12 suítes.
- Integração: `bun --no-env-file test/industrial-handoff-postgres.test.ts` — 32 cenários aprovados, com `TEST_DATABASE_URL` explícita para PostgreSQL local de teste. Cada execução cria e remove um schema privado derivado das tabelas Drizzle; não executa migrations ou seeds da operação. O PostgreSQL de teste foi desligado ao final.
- Build: `node node_modules/vite/bin/vite.js build`.
- Verificação TypeScript global: 22 erros, com a mesma lista encontrada na verificação inicial desta retomada, em contatos/CRM, assistente, eventos, follow-up e API SDR. Nenhum diagnóstico nos arquivos alterados nesta retomada. Não considerar o repositório globalmente livre de erros de tipos.
- ESLint completo do novo módulo de persistência e da suíte PostgreSQL: aprovado. A checagem ampliada dos seis arquivos de código/teste ainda acusa formatação e três usos de `any` nos fontes existentes; não é um lint global aprovado.
- Não houve chamada de IA, envio ao WhatsApp ou teste de ponta a ponta no widget publicado.

## Próximo lote concreto: E6

1. Substituir `mockMetrics` por dados medidos ou indicação de indisponibilidade. Definir período, fuso e denominadores; contar fluxos ativos somente por estado ativo.
2. Expor no monitor, com escopo de tenant e permissões: origem, intenção/subfluxo, decisão de catálogo, motivo de revisão, dados faltantes, destino configurado, pendência de CRM/alocação, recibo e confirmação ao cliente.
3. Mostrar continuidade entre site e WhatsApp, ciclo anterior e responsável efetivo sem sugerir um segundo rodízio.
4. Distinguir qualificação pronta, transferência pendente, transferência confirmada, sem resposta e intervenção humana. Usar a persistência como fonte do estado exibido.
5. Fechar a matriz das 47 capacidades com evidências de implementação e homologação, incluindo notas, score, NPS e exportações conforme prioridade operacional.

Depois, E7 deve validar casos anonimizados e falhas reais em ambiente separado: ciclo longo, mídia, dois workers, reinício, tomada humana e continuidade nos dois provedores configuráveis. E8 só começa com plano de corte e rollback e garantia de um único bot respondendo por entrada.

## Pendências para a operação

- O catálogo legado preparado tem 1.037 registros e dois conflitos de SKU (`964` e `1137`). Não foi importado; requer confirmação da fonte oficial.
- Conferir setores, operadores, funis e etapas oficiais por ID no tenant de implantação.
- Validar domínio/origem, sessão pública do visitante, expiração e reconexão do widget antes de publicar a instalação.
- Confirmar o bundle efetivamente instalado no site e os webhooks ativos; o código local não comprova qual versão atende a operação.
- Conferir o comportamento do Vertex com casos reais anonimizados e o custo atribuído ao tenant/feature.
- Resolver ou registrar os erros globais de tipos antes da homologação final. Build bem-sucedido não substitui essa verificação.

Os relatórios de cada lote detalham os contratos e limitações. Este arquivo é o ponto de entrada para a próxima retomada; não substitui a homologação operacional.

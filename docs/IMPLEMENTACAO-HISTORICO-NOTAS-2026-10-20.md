# Histórico e notas progressivas — E6, lote 3

Data: 20/10/2026. Continuação de `IMPLEMENTACAO-CAUSAS-HANDOFF-2026-10-20.md`. Implementação local; não houve ativação, importação, migração do banco operacional ou publicação.

## Resultado

O monitor SDR industrial oferece **Histórico e notas**, com busca por nome/telefone, paginação de atendimentos, ciclos e notas. Os atendimentos são ordenados pela criação; ciclos, pelo início; notas, pela ordem de registro. Os horários exibidos usam Brasília. A consulta inclui atendimentos além da janela do painel ao vivo e identifica separadamente o ciclo atual, ciclos arquivados e resumos antigos.

A nova rota `GET /api/valentina/triage-history` exige `requireSession`. O tenant vem exclusivamente da sessão; o perfil industrial é validado antes da consulta. Conversas e todas as origens de histórico são filtradas por tenant. Cursors são vinculados à consulta, conversa/ciclo e tenant, com limite de 50 itens por página. Erros retornam 400/404/503, sem SQL ou exceções internas. A resposta usa `Cache-Control: no-store`.

## Preservação dos ciclos

Mudanças de coleta, preparação/resultado do encaminhamento, interrupção manual, continuidade e arquivamento produzem notas internas estruturadas em `messages.metaDetails.industrialTriage`. A nota e a alteração de estado compartilham a transação. O registro guarda o ciclo, os campos alterados e uma fotografia normalizada da coleta, destino, decisão e responsável comprovado pelo recibo do ciclo. Não copia prompts, códigos temporários ou metadados arbitrários.

O texto da nota tem limite de 12 mil caracteres; a fotografia preserva até 30 campos, com valores de até 2 mil caracteres. A leitura não cria registros. Mudanças somente de relógio não criam notas, e a identificação determinística evita duplicar uma mesma alteração. O horário de registro é crescente dentro do ciclo para impedir inversão de fotografias no mesmo milissegundo.

Reinícios industriais de Meta, comando/reabertura Baileys, reabertura do site e liberação de carteira arquivam o SDR antes de substituí-lo. A continuidade arquiva o ciclo do WhatsApp substituído e registra o encerramento no site. Outros agentes são preservados. Reinícios simultâneos com a mesma entrada têm uma única aplicação; ciclos distintos recebem identificadores temporais distintos. Reabertura preserva as mensagens não lidas e respeita posse humana. A interrupção manual preserva a coleta e um responsável humano já existente.

As notas não são enviadas ao canal do cliente. O histórico do SDR, a régua industrial de silêncio e a cópia de mensagens do site excluem notas internas antes de aplicar seus limites. O painel ao vivo exclui estes registros da timeline comum; eles permanecem consultáveis no histórico próprio e no atendimento interno.

Não foi criada tabela nem migration. A retenção depende da conservação das mensagens: exclusão administrativa do atendimento continua excluindo seu histórico. Isto não substitui backup nem log externo imutável.

## Dados antigos e paginação

O leitor une notas novas, fluxos ainda existentes e `previousTriages`, deduplicando pelo ciclo. Fotografias completas têm precedência sobre resumos legados. Antes de remover um fluxo, os resumos antigos ainda disponíveis são preservados também como notas duráveis; deixam de depender da janela de 20 itens do metadado.

**Dados já descartados pelo sistema anterior não são reconstruídos.** Um resumo legado continua identificado como incompleto, mesmo depois de preservado como nota. Não se atribui coleta ou responsável comprovado a um resumo que não contém essa evidência.

A paginação usa horário e ID como desempate, com precisão uniforme em milissegundos. O cursor mantém uma âncora temporal para novas páginas; não constitui uma transação de leitura histórica do banco. Estado de um ciclo ainda ativo pode mudar enquanto a consulta está aberta. Reabrir a consulta atualiza os dados. A paginação cobre ciclos e notas estruturadas, não a exportação integral de todas as mensagens e mídias.

## Verificação e continuidade

Evidência reproduzível e hashes: `fagner-history-notes-2026-10-20.json`.

- 231 testes Node, em 21 suítes: política, contratos, paginação, handlers, sessão e isolamento.
- 46 cenários PostgreSQL em schema privado de banco local: rollback conjunto, deduplicação concorrente, 24 ciclos, resumos legados, paginação de notas, 56 atendimentos, posse humana e mensagens não lidas. Inclui timestamps com microssegundos para verificar desempates. O schema de teste é removido ao final.
- Build e lint dos dez arquivos novos/núcleo/testes desta etapa aprovados. A verificação global de tipos, incluindo o plugin de recuperação, mantém os 21 problemas anteriores; não há aprovação global de TypeScript ou lint.
- Sem chamadas ao Vertex, envio a canais reais ou validação visual no navegador. A homologação do diálogo, reinícios dos transportes e atendimento completo permanecem em E7.

Ainda faltam edição/revisão humana e briefing final unificado para todos os destinos, origem/produto/campanha do site, integrações VTEX/preço/frete/pedido, score, avaliação e exportações. A [matriz das 47 capacidades](./MATRIZ-PARIDADE-FAGNER-2026-10-20.md) mantém esses itens parciais; este lote não encerra o porte nem autoriza a virada.

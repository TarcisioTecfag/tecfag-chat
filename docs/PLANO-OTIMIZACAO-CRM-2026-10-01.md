# Plano de otimização do CRM — 01/10/2026

## Diagnóstico reproduzido

O banco local `valemchat` contém, para o tenant Tecfag, 13.202 negócios, 17.002 contas e 12.815 contatos. Uma amostra de `EXPLAIN (ANALYZE, BUFFERS)` mostrou varredura sequencial para a contagem dos negócios abertos do funil (137 ms), o resumo por etapa (49 ms) e a primeira página de contatos (49 ms). A seleção de até 50 negócios por etapa ordenou 3.527 negócios abertos (20 ms). Esses tempos são apenas do banco local; não medem latência HTTP, renderização nem produção.

## Primeira entrega local

- O Kanban solicita negócios com `includeTotal=false`, pois o endpoint de resumo já calcula a contagem real por etapa. A listagem e outros consumidores mantêm a contagem por padrão; a visualização em lista não busca o resumo do Kanban.
- O resumo usa `count(*)`, `count(value)` e `sum(value)` sem `DISTINCT` ou `CASE` redundantes; não há joins na consulta.
- A ordenação por contato recente usa `last_activity_at`, coluna obrigatória, e desempata por ID.
- A seleção de funil no frontend deixa de provocar uma segunda busca inicial dos funis.
- Os índices candidatos estão em `scripts/migrations/0021_crm_read_indexes.sql`. O arquivo **não** é executado no startup.

## Aplicação segura dos índices

1. Medir p50/p95 e volume de requisições de `/api/crm/deals`, `/stages-summary`, `/api/crm/search` e `/api/contacts`, além de CPU, memória, conexões e consultas mais caras do PostgreSQL em produção.
2. Aplicar o SQL de índices primeiro em um banco de teste com volume semelhante. Comparar planos e tempos antes/depois, inclusive com filtros por vendedor e etapas.
3. Antes da aplicação em produção, revisar o `startCommand` do Railway: ele executa `drizzle-kit push --force` e seed a cada inicialização. É necessário conciliar os índices com o schema Drizzle e retirar as alterações de schema do caminho de startup para não criar índices sem `CONCURRENTLY` ou surpreender a operação Valem.
4. Aplicar `CREATE INDEX CONCURRENTLY` em uma janela monitorada, fora de transação, verificando escrita e latência da Valem. O tenant permanece parte inicial dos índices.
5. Confirmar em produção os planos de consulta e os p95 do CRM e dos demais módulos. Reverter índices individualmente se aumentarem custo de escrita sem benefício de leitura.

## Próximas etapas de código

- Reduzir o DTO dos cards: hoje listagem de negócios e contas usa `select()` e envia campos de detalhe, inclusive JSON, para o Kanban.
- Otimizar a busca global: há consultas e contagens para três categorias a cada busca, com `ILIKE '%...%'` e normalização de telefone durante a consulta. Avaliar índices de texto e telefone normalizado.
- Limitar a quantidade de cards mantidos simultaneamente no DOM após rolagem longa; preservar paginação por etapa.
- Medir a tela de contatos com base grande e conferir índice por tenant e data de criação.

## Validação da primeira entrega

- `npx tsc --noEmit`: passou.
- `test/verify-e4-kanban-volume-stages.ts`: 72/72 asserções passaram em `valemchat_test`.
- `test/verify-e5-filters-and-list.ts`: 44/44 asserções passaram em `valemchat_test`.
- A migração 0020, ausente no banco de teste, foi aplicada somente em `valemchat_test` antes das suítes. Nenhuma migração ou índice foi aplicado em produção.

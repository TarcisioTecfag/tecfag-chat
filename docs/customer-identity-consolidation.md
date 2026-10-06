# Identidade de contatos e empresas

## Modelo operacional

- `contacts` representa a pessoa/identidade de canal: nome, telefone, e-mail e identificadores do WhatsApp.
- `crm_accounts` representa o comprador PF ou PJ e é o cadastro principal do CPF/CNPJ.
- `contacts.account_id` é a empresa/cliente principal do contato. Uma empresa pode ter vários contatos; um contato tem no máximo uma empresa principal.
- `crm_deals.account_id` e os participantes do card são independentes da empresa principal atual do contato. A troca de emprego ou um atendimento a outra empresa não deve reescrever negócios antigos.
- `crm_contact_account_history` registra as mudanças do vínculo. `crm_account_conversations` registra contexto histórico específico de um atendimento.

## Prevenção de novas duplicidades

1. Normalizar telefone e documento para dígitos antes da busca e gravação.
2. O banco rejeita novo contato com telefone já existente no mesmo tenant e nova empresa com documento já existente no mesmo tenant, inclusive quando o cadastro antigo usa máscara. A migração `0024_customer_identity_guards.sql` não tenta modificar duplicatas antigas.
3. Um conflito retorna `409` nas APIs de criação e edição, para que o operador localize o registro existente.
4. Cadastro de empresa sem documento continua possível; nome parecido deve gerar sugestão de revisão, nunca fusão automática. Telefone compartilhado por várias pessoas exige decisão operacional antes de impor um único contato por número.

## Consolidação dos dados antigos

1. Executar `node scripts/audit-customer-duplicates.mjs --tenant=<tenant-id>` com `DATABASE_URL` configurada. Guardar o relatório em local restrito: ele contém dados pessoais. Repetir separadamente para cada tenant.
2. Para cada CNPJ/CPF duplicado, escolher a conta canônica. Conferir cards, contatos, conversas, campos personalizados e integrações. Mover referências por tenant em transação, registrar os IDs antigos e arquivar a conta redundante. Documentos divergentes ou pertencentes a filial diferente não são fundidos.
3. Para telefones duplicados, conferir JID/BSUID, canal, histórico de mensagens e possíveis números compartilhados. Escolher um contato canônico apenas quando for comprovadamente a mesma identidade. Mesclar tags, tarefas, carteira e histórico com regra explícita; manter rastreabilidade do ID antigo. Não decidir pelo nome exibido no WhatsApp.
4. Vincular contatos sem empresa somente quando CNPJ legado identificar **uma única** conta do mesmo tenant. Se não houver conta, criar após conferir razão social/documento. Se houver várias, enviar para revisão.
5. Comparar `contacts.cnpj`/`cpf` e `cnpj_details` com o documento da conta vinculada. Corrigir divergências; depois migrar as automações que ainda leem esses campos legados e remover as colunas em uma migração final. Até essa etapa, elas não são campos de edição do operador.
6. Após zerar duplicidades, adicionar índices únicos normalizados por tenant. Conferir busca, criação, atualização, webhook, SDR e abertura de atendimento em cada tenant antes de remover os gatilhos de transição.

O relatório é somente leitura. Nenhuma etapa de fusão deve ser executada automaticamente por similaridade de nome, telefone ou CNPJ sem revisar referências e histórico.

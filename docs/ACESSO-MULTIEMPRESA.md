# Acesso multiempresa

## Como funciona

- `platform_access_groups` define as empresas às quais um grupo global concede entrada.
- `platform_accounts` mantém uma única credencial. Cada empresa autorizada tem seu próprio registro em `operators`, com papel e grupo local próprios.
- `auth_sessions` continua vinculada a um operador e a **um** tenant. `POST /api/auth/switch-tenant` valida o grupo e o vínculo de destino, troca o cookie e revoga a sessão anterior.
- As rotas de negócio continuam usando somente `session.tenantId`. O tenant solicitado na troca não é autoridade.
- Remover a pessoa do grupo mantém o acesso ao seu tenant de origem, revoga as sessões abertas e impede login nos demais.

## Ativação

1. Aplicar a migração `0011_platform_access.sql` antes de iniciar o código novo. A migração é aditiva e não altera os dados de atendimento.
2. A migração cadastra `suporte2@tecfag.com.br` como primeiro gestor multiempresa e promove **somente o operador já existente no tenant correspondente ao domínio** para `admin`. Se esse operador ainda não existir, criá-lo como administrador pelo fluxo normal antes de usar a gestão multiempresa.
3. Entrar com essa conta no tenant de origem, abrir **Grupos de Acesso → Acesso multiempresa**, criar um grupo com Valem e Tecfag e adicionar a própria conta. Escolher o papel e o grupo local no destino. A gestão global fica disponível na sessão de origem do administrador indicado.
4. A partir daí, o seletor da barra lateral troca a sessão e recarrega o sistema inteiro. O gestor pode incluir ou retirar outros operadores pela mesma tela.

## Verificação antes de produção

Usar apenas um banco de teste: confirmar login legado, entrada e troca com membro do grupo, bloqueio para não membro, isolamento de conversas e CRM nos dois sentidos, remoção do grupo, sessões já abertas e abas simultâneas. Não executar seeds ou testes contra o banco operacional.

A suíte de integração do fluxo de sessão pode ser executada com `TEST_DATABASE_URL` configurada em um banco de teste já migrado: `npx tsx test/verify-platform-access.ts`.

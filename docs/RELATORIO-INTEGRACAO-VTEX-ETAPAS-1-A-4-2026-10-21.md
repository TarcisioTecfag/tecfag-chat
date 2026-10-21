# Integração da loja VTEX — etapas 1 a 4

Data: 21/10/2026. Escopo: consulta oficial da loja no atendimento industrial unificado, política por canal, configuração administrativa e homologação técnica separada da operação.

## Resultado

As etapas 1, 2 e 3 estão implementadas. A etapa 4 tem evidência de consultas públicas reais e de testes automatizados com banco e transportes isolados. A validação operacional com o widget publicado, Vertex, WhatsApp real e operadores continua pendente; este relatório não autoriza a virada nem declara o porte inteiro concluído.

O domínio informado foi `tecfag.com.br`; a conta `tecfag` foi conferida nos dados públicos da loja e nas respostas dos endpoints. Canal de venda `1` e vendedor `1` funcionaram nas consultas de homologação. Esses valores são configuráveis e não foram gravados no banco operacional.

| Etapa | Entrega | Evidência e limite |
|---|---|---|
| 1 — Catálogo | Consulta por URL da loja, SKU ou termo; especificações, variantes e link oficial. | Busca pública real e testes de correspondência. Busca textual apresenta opções; produto com variantes exige escolha. A consulta não aprova a adequação técnica da máquina. |
| 2 — Informações comerciais | Preço e disponibilidade atuais; frete por SKU, vendedor, quantidade e CEP. Resposta com fonte e horário. | Simulação anônima real com opções de entrega. Site permite informações públicas; WhatsApp mantém especificações e encaminhamento. |
| 3 — Configuração | Painel por empresa, políticas por canal, teste sem salvar e credenciais opcionais protegidas. | Sessão obrigatória, admin, tenant do servidor, revisão concorrente e criptografia autenticada. Nenhuma configuração da operação foi salva. |
| 4 — Homologação técnica | Consulta → coleta → transferência → continuidade, além de falhas, permissões e componente de configuração. | Banco PostgreSQL local exclusivo de teste, transportes controlados e cinco cenários públicos reais. Sem mensagens reais, ativação ou instalação publicada. |

## O que muda no atendimento

- O Fagner consulta a loja pelo serviço central de VTEX quando identifica pedido de preço, frete, especificações, SKU ou URL. Pedidos de humano, financeiro, assistência e pós-venda mantêm sua precedência.
- Um produto ou variante ambíguos exigem confirmação. A quantidade e o CEP são usados na simulação; CEP sozinho pode continuar uma consulta anterior com SKU confirmado.
- Preço, disponibilidade e frete não são inventados pelo modelo. Os valores apresentados pela integração são compostos no servidor com a resposta atual da loja. Há uma barreira adicional contra afirmações comerciais nas respostas generativas; ela não substitui a avaliação do modelo em homologação.
- A política inicial libera especificações, preço, disponibilidade e frete no site. No WhatsApp, libera apenas especificações e encaminhamento. O servidor remove os campos comerciais e trechos comerciais do texto da loja quando não permitidos.
- Timeout, limite da loja, ausência de oferta, vendedor diferente ou falha de frete produzem orientação controlada. Uma referência não localizada não é declarada definitivamente fora de estoque. Uma oferta sem preço confirmado não vira preço zero.
- Uma consulta não preenche a coleta industrial, não confirma compra, não reserva estoque, não cria card e não conclui a triagem sozinha. O catálogo de decisão técnica continua sendo uma configuração separada.

## Onde aparece no front

1. **Ajustes → Live Chat (Site) → Loja VTEX**, no perfil industrial e com operador administrador: conta, domínio, canal de venda, vendedor, habilitação das consultas e permissões distintas para Site e WhatsApp.
2. No mesmo cartão, **Testar consulta sem salvar**: busca por SKU/URL/termo, canal, tipo de informação, quantidade e CEP. A consulta usa a configuração digitada sem persistir nem ligar o atendimento.
3. **Credenciais opcionais**, no mesmo cartão: informa se existem credenciais e se a criptografia está disponível. AppKey/AppToken não são devolvidos pelo servidor.
4. **Fagner → SDR**, no monitor da triagem e no histórico do ciclo: painel **Consulta oficial da loja — VTEX**, com situação, produto, SKU, link, canal e horário, quando há evidência registrada. O briefing interno também inclui essa referência.

Esses elementos aparecem quando a versão com este código está em execução. A evidência no monitor surge após uma consulta no fluxo; instalar o código não cria registros demonstrativos nem habilita o SDR. Para o perfil industrial, as configurações antigas de Tray deixam de ocupar essa tela; o caminho da Valem permanece separado.

## Continuidade entre site e WhatsApp

O núcleo transacional de continuidade foi separado do transporte para permitir testes com banco isolado. O caminho público continua validando perfil industrial e o código temporário antes de chamá-lo.

Na triagem em andamento, a coleta e a evidência da loja seguem para o ciclo do WhatsApp. Quando o site já possui responsável, a continuidade preserva operador e vínculo com o mesmo card, silencia a automação do destino e também leva a coleta ao ciclo de destino, preservando campos que já existiam ali. O ciclo de origem registra o destino mesmo se já estava transferido. O código é consumido uma vez; um tenant diferente não pode usá-lo. Não há novo rodízio nem outro card nesse vínculo.

O histórico copiado mantém o limite já existente de últimas 200 mensagens externas. Isso não equivale à exportação integral do atendimento.

## Segurança e infraestrutura

- Rotas internas usam `requireSession`; tenant e operador vêm da sessão. O corpo não aceita tenant, operador ou ativação do SDR como autoridade. O painel e a rota são administrativos e restritos ao perfil industrial.
- A rota genérica de agentes não lista o registro VTEX nem permite alterá-lo, inclusive quando alguém tenta trocar seu tipo pelo ID. A edição passa pela rota específica, com revisão e proteção das credenciais.
- A configuração usa `agentConfigs`, com chave de agente própria, filtro de tenant, lock transacional e revisão. Não exige migração de tabelas e não modifica a configuração do SDR.
- As requisições externas são limitadas ao host VTEX construído da conta validada: GET de busca pública e POST de simulação pública. Não há checkout de compra, criação de carrinho, pedido, pagamento, alteração de estoque ou chamada ao OMS.
- URLs de produto precisam pertencer ao domínio configurado. Há timeout, limites de resposta e recusa de redirecionamento. Erros públicos não devolvem resposta bruta da loja ou credenciais.
- Consultas públicas funcionaram sem credenciais. Se futuramente necessárias, AppKey/AppToken são cifrados com AES-256-GCM e vinculados ao tenant e à conta. A chave `VTEX_CREDENTIALS_ENCRYPTION_KEY` deve ter 32 bytes em base64 e ser provisionada como segredo do servidor. Sem ela, consultas públicas continuam disponíveis; salvar credenciais é recusado. A perda ou troca dessa chave exige recuperar a chave anterior ou cadastrar novamente as credenciais.
- A simulação de frete sempre é anônima, sem AppKey, AppToken ou cookies. O CEP da consulta não entra no resumo de evidência do monitor.
- Esta integração consulta dados determinísticos da loja; não adiciona provedor de IA. As chamadas de IA do sistema continuam pelo Vertex.

## Evidências de homologação

### Loja real, acesso público

Resultado registrado em [homologacao-vtex-publica-2026-10-21.json](./homologacao-vtex-publica-2026-10-21.json): **5 cenários aprovados, 5 requisições HTTP**, todas HTTP 200. CEP público de teste `01001000`, sem endereço ou identificação de cliente.

1. Preço público pelo SKU `147`.
2. Frete do SKU `147`, com opções retornadas pela loja.
3. Preço no WhatsApp bloqueado antes de qualquer chamada externa.
4. Especificações no WhatsApp sem valores comerciais.
5. Produto FRP400 com variantes: exige escolha entre SKUs, sem selecionar voltagem automaticamente.

O script reproduzível é `scripts/homologate-vtex-readonly.mjs`. Ele restringe host, métodos e caminhos, recusa credenciais/cookies e registra explicitamente que não acessou o banco do aplicativo nem criou carrinho/pedido. Valores e prazos do JSON são uma fotografia da consulta, sujeitos a mudança na loja.

### Testes locais

- `npm run test:triage`: suíte de regressão industrial, incluindo `test/vtex-store.test.mjs`.
- `test/vtex-store.test.mjs`: catálogo, oferta, SKU, variantes, origem, quantidade/frete, política por canal, limites/falhas, cifra, API real com dependências isoladas, runtime e componente administrativo real com hooks/transporte controlados.
- `test/industrial-handoff-postgres.test.ts`: transações e concorrência no PostgreSQL, configuração/cifra por tenant e consulta seguida de continuidade parcial ou transferência completa. Verifica preservação de dados, referência da loja, card e responsável, sem consumir outro rodízio.
- Build de produção e lint dos módulos novos verificados. O TypeScript global mantém diagnósticos anteriores do projeto; não está globalmente aprovado.

Os totais finais e o resultado da comparação TypeScript estão no fechamento deste relatório. Os testes de componente verificam elementos, ações, estado de erro e política; não equivalem a uma inspeção visual em navegador. A ferramenta de navegador não inicializou neste ambiente.

## O que falta para operar

1. Publicar esta versão no ambiente de homologação e cadastrar a configuração pelo painel. A integração começa desabilitada por padrão; salvar seus dados é uma ação administrativa explícita. Confirmar se canal/vendedor oficiais devem continuar em `1`.
2. Conferir os destinos, equipe e catálogo de decisão técnica. Consulta VTEX não resolve conflitos históricos do catálogo decisório nem confirma capacidade de máquina.
3. Instalar o widget e o botão de produto no domínio de homologação, configurar a origem permitida e testar com operadores, Vertex e um número de WhatsApp de teste: troca de produto/variante, consulta, coleta, pedido humano, posse da conversa e continuidade.
4. Executar a virada em janela definida, com uma única entrada de bot por canal e rollback. O sistema anterior e as entradas publicadas não foram alterados por esta entrega.

Fora destas quatro etapas, a matriz geral ainda registra score comercial, proatividade industrial, NPS/avaliação, relatórios/exportações, confirmação de pedido por webhook VTEX e demais homologações. O webhook de pedido continua pendente: uma consulta de preço/frete nunca é tratada como venda confirmada.

Referências técnicas: [VTEX Search API](https://developers.vtex.com/docs/api-reference/search-api), [VTEX Checkout API](https://developers.vtex.com/docs/api-reference/checkout-api) e [simulação de carrinho](https://developers.vtex.com/docs/guides/simulate-a-shopping-cart). Aqui é usada somente a simulação anônima, sem criação de carrinho persistido.

## Fechamento da validação

- **331 testes aprovados em 38 suítes** no comando `npm run test:triage`; 53 desses testes pertencem ao módulo VTEX.
- **64 cenários PostgreSQL aprovados**. Banco `industrial_triage_test` em `127.0.0.1:55439`, schema exclusivo removido após a execução e servidor de teste desligado.
- **5 cenários públicos reais aprovados**, com frete disponível na consulta, registrados às `2026-10-21T13:24:53.523Z` no JSON de evidências.
- **Build de produção aprovado**, com os avisos de empacotamento do projeto.
- **ESLint aprovado** nos módulos VTEX, rota administrativa, componentes novos, núcleo de continuidade extraído, briefing, scripts e testes alterados. Não representa aprovação do lint global do repositório.
- **TypeScript:** a primeira comparação normalizada manteve os **24 diagnósticos anteriores**, sem acréscimo. A última checagem do checkout compartilhado encontrou **26**: os mesmos 24 e duas referências ausentes (`getInitialTabFromUrl` e `useSyncModuleTabWithUrl`) em alterações locais de `CrmView.tsx` **fora do commit VTEX**. Nenhum diagnóstico nos módulos VTEX, sua rota ou o núcleo de continuidade. As alterações locais de navegação foram preservadas e não publicadas neste lote. O projeto global não está livre de erros de tipos.
- **Nenhuma alteração em configuração operacional, credenciais do legado, webhook publicado ou widget da loja.** A consulta pública não acessou o banco do aplicativo. Os testes de persistência usaram somente PostgreSQL separado e credenciais fictícias.

# RD Station Marketing → CRM local

Primeira operação prevista: Tecfag. A configuração é independente por tenant e por fluxo. Nenhum fluxo ou dado real é criado pela migration.

## Configuração

1. Publicar a versão contendo a migration `0035_rd_marketing`. O runner usado pelo `npm start` já inclui essa migration aditiva.
2. Entrar como administrador na empresa desejada e abrir **Configurações → RD Station**.
3. Criar um fluxo, escolher funil, etapa, responsável e os campos que serão importados.
4. Colar um exemplo do JSON enviado pela automação e usar **Simular importação**. A simulação consulta as definições do CRM sem escrever dados.
5. Salvar o fluxo, copiar sua URL e guardá-la. A URL é exibida apenas na criação ou rotação; o servidor armazena somente o hash do segredo.
6. No ponto desejado da automação do RD Marketing, configurar **Enviar Leads para Integração** com essa URL HTTPS e ativar o recebimento no sistema.
7. Validar uma conversão controlada e conferir o card e o histórico de recebimentos antes de substituir a ação de criação no RD CRM.

A ação de envio por automação está documentada para planos Pro e Advanced: [Central de ajuda RD](https://ajuda.rdstation.com/s/article/Utilizar-a-a%C3%A7%C3%A3o-Enviar-Leads-para-Integra%C3%A7%C3%A3o?language=pt_BR). Este recebimento não requer OAuth do RD CRM nem acesso de saída à API de Marketing.

## Dados e mapeamento

- Aceita `leads[]` (formato legado), `contact` (webhook da API nova), `document` (envelope alternativo) ou um objeto de lead direto; processa até 100 leads / 512 KB por requisição. No envelope `contact`, os metadados do evento ficam disponíveis para mapeamento em `rd_event.event_type`, `rd_event.event_identifier`, `rd_event.event_timestamp` e `rd_event.timestamp`.
- Os caminhos dos campos são relativos ao lead: `name`, `mobile_phone`, `company.name`, `custom_fields.Interesse`, `cf_produto`, `last_conversion.content.identificador`, por exemplo.
- Apenas campos selecionados são importados. Valores padrão podem preencher ausências ou constantes, como a fonte da negociação.
- Destinos: nome, telefone e e-mail do contato; nome, documento, telefone e e-mail da empresa; título, valor, fonte, campanha e nota inicial do card; campos personalizados dessas três entidades.
- Campos de seleção permitem traduzir os valores do RD para as opções do CRM. Múltipla escolha recebe um array; datas usam `AAAA-MM-DD` e números personalizados usam decimal com ponto. O valor monetário padrão do card aceita o formato brasileiro.
- Nome do contato, título do card e telefone ou e-mail mapeado são necessários. O lead recebido precisa de `uuid` ou `email` para identidade. Campos obrigatórios do CRM continuam sendo validados.
- Contatos são reconhecidos por telefone canônico e e-mail dentro do tenant. Se esses dados apontarem para dois contatos diferentes, o recebimento falha para revisão do cadastro.
- Empresas são reutilizadas pela empresa já vinculada ao contato ou pelo CPF/CNPJ no tenant. Sem documento, uma empresa nova é criada e vinculada ao contato; nomes iguais sozinhos não unem empresas.
- Dados já preenchidos em contatos/empresas são preservados. Dados novos enriquecem os campos vazios e os personalizados vazios. O nome já cadastrado é preservado.

O formato legado e os campos `cf_` são descritos na [migração oficial da API RD Marketing](https://developers.rdstation.com/reference/rdsm-como-migrar-api-v1-para-api-v2).

## Fonte, Campanha e anotação de criação

Novos fluxos usam a **última conversão** para Fonte e Campanha; a primeira conversão também pode ser escolhida. Exemplo: Google / Notebooks na entrada do lead e E-mail / Oferta de outubro na conversão seguinte. A primeira opção atribui ao Google / Notebooks; a última ao E-mail / Oferta de outubro.

O mapeamento automático usa `rd_attribution.source` e `rd_attribution.campaign`. No formato legado, esses valores vêm de `first_conversion.conversion_origin.source/campaign` ou `last_conversion.conversion_origin.source/campaign`, conforme a escolha. A fonte também pode vir de `first_conversion.source` / `last_conversion.source`. Fonte e Campanha não são completadas com dados de conversões diferentes.

O webhook novo pode trazer `funnel.origin`, utilizado somente para a origem inicial, mas não garante os detalhes de campanha nem a fonte da última conversão. Esses dados podem exigir consulta à API de eventos de conversão do RD Marketing. Esta entrega não faz essa consulta e não adivinha UTMs, campanhas ou nomes de fluxos a partir do identificador do formulário. Alternativas configuráveis: mapear campos de atribuição coletados no RD, definir valores fixos ou escolher explicitamente **Usar o nome deste fluxo como Campanha**. O nome local deve corresponder ao fluxo/ação que se quer identificar.

Novos fluxos têm **Exigir Fonte e Campanha antes de criar o card** habilitado. Se os dados faltarem, o lote é rejeitado sem cadastros parciais. Essa opção pode ser alterada por fluxo. Configurações antigas são preservadas; o botão **Aplicar mapeamento automático de Fonte e Campanha** atualiza esses dois destinos sem remover outros campos.

Todo card criado recebe uma anotação obrigatória:

```text
Negociação criada automaticamente pelo RD Station Marketing.
Fluxo de integração: Pedido de orçamento
Fonte: Google
Campanha: Notebooks outubro
```

A nota adicional mapeada é acrescentada à anotação. A criação da nota participa da mesma transação do card e não se repete em reenvios.

## Reenvios e falhas

O padrão dos novos fluxos é **um card por conversão**, reutilizando o contato e a empresa dentro do tenant. Telefone canônico e CPF/CNPJ identificam os cadastros; novas negociações são registros separados e mantêm sua Fonte/Campanha na criação. Configurações antigas explícitas de um card por lead são preservadas e podem ser alteradas no painel.

O campo automático `rd_conversion.id` combina data original do evento/conversão e identificador do formulário. Usa `rd_event.event_timestamp` e `rd_event.event_identifier` no formato novo, ou `last_conversion.created_at` e `last_conversion.content.identificador` no legado. Datas equivalentes com fusos distintos são normalizadas. Também é possível escolher um identificador de evento específico do payload. Sem identidade de evento suficiente, o recebimento falha; nunca usa a data de entrega do webhook como se fosse uma nova conversão.

A transação confirma o lote inteiro, incluindo contato, empresa, card, auditoria e recibo de recebimento. Erros revertem todo o lote, permitindo corrigir a configuração/cadastro e reenviar pela origem. O histórico guarda resultados e mensagens de erro, sem armazenar o payload completo. Não há fila de replay interna; o reenvio deve vir do RD/origem. Reenvios bem-sucedidos retornam o ID do card anterior e não atualizam o card.

Rotacionar a URL invalida a anterior imediatamente para novos recebimentos. Atualize o fluxo no RD após a rotação. O segredo identifica o tenant e o fluxo no servidor; `tenantId`, funil, etapa e responsável enviados no payload não controlam o destino. A administração exige `requireSession` e papel `admin`.

Esta entrega cobre a entrada de leads e criação local. Não envia status de venda/perda de volta ao RD Marketing, não importa a base histórica e não inicia conversas ou mensagens de WhatsApp.

## Validação local

Ao reabrir o painel, ele carrega as configurações do servidor e seleciona o último fluxo salvo
usado neste navegador e tenant, ou o primeiro fluxo disponível. O navegador guarda apenas o ID
selecionado; os mapeamentos e destinos permanecem no banco. Um rascunho não salvo não substitui
o fluxo salvo na próxima abertura.

A URL do webhook aparece somente ao criar ou rotacionar o segredo. Recarregar ou publicar o
sistema não invalida a URL original. Para verificar uma URL já configurada, abra-a no navegador:
o GET autenticado pelo segredo retorna somente o nome da integração e `ready` ou `paused`, sem
criar contatos, cards, recibos ou logs. `401` indica segredo inválido ou fluxo não encontrado.
Não compartilhe a URL, pois ela autoriza recebimentos. Rotação exige atualizar a ação do RD.

`bun test test/rd-marketing-mapping.test.ts` cobre payloads, mapeamentos, opções, identidades e caminhos seguros.

`bun test test/rd-marketing-integration.test.ts` exige `TEST_DATABASE_URL` apontando para uma base PostgreSQL **local, descartável e vazia**, com `test` no nome. A suíte cria o schema e valida criação, concorrência, rollback, campos obrigatórios, isolamento, sessão admin, webhook, rotação e reutilização de cadastros. Não carregar `.env` operacional para essa suíte.

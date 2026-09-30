# Ativação da Meta Cloud API no tenant Tecfag

## Preparação

1. Fazer backup do banco e aplicar `npm run db:migrate:platform` primeiro em homologação. A migração `0019_meta_message_tracking.sql` acrescenta metadados de webhook, status e cobrança; não troca o canal de nenhum tenant.
2. No Meta App Dashboard, cadastrar o número da Tecfag, obter Phone Number ID, WABA ID, token permanente de System User e App Secret. Habilitar faturamento e permissões necessárias para mensagens e templates.
3. No painel admin da Tecfag, abrir **Configurar Meta antes da ativação**. Salvar os IDs, token, App Secret e um Verify Token aleatório. Não reutilizar token de exemplo.
4. Configurar o callback HTTPS `/api/webhooks/meta` no app, com o mesmo Verify Token, e assinar o campo `messages`. Receber uma mensagem real de um número de teste. O painel deve registrar um webhook assinado recente.

## Homologação por tenant

1. Testar credenciais pela tela. Confirmar que Phone Number ID e nome verificado são os da Tecfag.
2. Confirmar recebimento de texto e de mídia, abertura da conversa no tenant Tecfag e ausência da mensagem no tenant Valem.
3. Responder dentro das 24 horas com texto e mídia. Confirmar os estados `accepted`, `delivered` e `read`, inclusive se o webhook chegar antes da resposta HTTP do envio.
4. Em uma conversa fora da janela, confirmar bloqueio de texto livre e envio de template aprovado com variáveis de corpo. A tela oferece apenas templates simples suportados; templates com botões ou cabeçalhos dinâmicos ainda exigem ampliação do formulário.
5. Conferir o resumo mensal de classificação de cobrança contra os status de entrega na Meta. O painel não calcula valor em moeda: a cobrança final depende da tabela vigente, país de destino, moeda, isenções e conciliação com a fatura da Meta.
6. Simular falha temporária no download de mídia e confirmar retenção em `pending_inbounds` e recuperação. Para timeout de envio sem confirmação, confirmar status `unknown` e ausência de reenvio automático.

## Virada e retorno

1. Agendar a virada apenas para a Tecfag, após testes em homologação e com webhook assinado recebido nas últimas 24 horas. O botão de ativação também valida as credenciais na Graph API.
2. Após ativar, observar mensagens recebidas, entregas, falhas, eventos pendentes, qualidade do número e cobrança no painel da Meta. Manter operadores informados de que cada resposta de serviço entregue poderá ser cobrada conforme a regra vigente.
3. Se houver falha operacional, usar a ação admin para voltar ao provedor anterior da Tecfag e reconciliar mensagens `unknown` antes de qualquer reenvio manual. A configuração da Valem deve permanecer intacta.

**Regra de envio:** a janela de atendimento de 24 horas é contada da última mensagem do cliente. Fora dela, enviar somente template aprovado. A classificação e o preço são dimensões separadas dessa permissão de envio.

**Mudança anunciada para 01/10/2026:** mensagens de serviço entregues passam a ser cobradas após a franquia mensal de 1.000 por número, e templates de utilidade dentro da janela deixam de ser gratuitos. Conferir a [tabela vigente da Meta](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing) e a fatura da conta antes de projetar custo em moeda. A janela de 24 horas continua sendo a regra para texto livre.

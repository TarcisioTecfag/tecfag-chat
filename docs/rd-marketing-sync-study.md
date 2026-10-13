# Estudo: jornada e sincronização entre Tecfag Chat e RD Marketing

Data: 13/10/2026. Proposta para avaliação; não implementa sincronização nem faz chamadas às contas dos clientes.

## Resultado da pesquisa

A integração bidirecional é viável para os eventos publicados pela API do RD Marketing. A reprodução integral da timeline nativa RD CRM ↔ RD Marketing ainda não está demonstrada. Não tratar a tela do produto como contrato da API pública.

| Necessidade | Evidência e proposta |
| --- | --- |
| Ler conversões e oportunidades do lead | `GET /platform/contacts/{uuid}/events`. A documentação permite `event_type=CONVERSION` e `OPPORTUNITY`, com paginação. |
| Receber novas conversões/oportunidades | Webhooks `WEBHOOK.CONVERTED` e `WEBHOOK.MARKED_OPPORTUNITY`. Separar ingestão de jornada da regra que cria negociações. |
| Informar oportunidade, venda e perda | Eventos `OPPORTUNITY`, `SALE` e `OPPORTUNITY_LOST`, via `POST /platform/events`. Requerem contato existente. |
| Informar atendimento no chat | Eventos `CHAT_STARTED` e `CHAT_FINISHED` documentados. Validar payload e representação visual na conta autorizada. |
| Atualizar estado comercial para segmentação | `PATCH /platform/contacts/{identifier}:{value}`, com campos explicitamente mapeados. Não cria conversão no histórico. Tags enviadas nessa operação substituem as existentes: não enviar uma lista parcial. |
| Exibir aberturas/cliques individuais, visitas e toda participação em automações | Não comprovado pela API pública pesquisada. Estatísticas de e-mail/fluxo não equivalem a uma timeline individual. Confirmar com RD quais interfaces oficiais estão disponíveis para a conta/aplicativo. |
| Reproduzir “Tarefa criada” e “Negociação atualizada” na timeline RD Marketing | Não comprovado um evento público equivalente aos registros da integração nativa. Guardar integralmente no Tecfag Chat; testar um mecanismo aprovado pela RD antes de prometer espelhamento. |

## Modelo recomendado

1. Autorizar RD Marketing por OAuth, separadamente por tenant. Não reutilizar as credenciais de migração do RD CRM. Armazenar tokens protegidos no servidor, renovar expiração e identificar a conta conectada.
2. Criar vínculo persistente entre tenant, conexão RD Marketing, UUID do lead e contato local. Hoje o recibo de conversão protege reenvios, mas seu hash não substitui esse vínculo para consultar a API. Reconciliação inicial por e-mail/telefone exige tratar conflitos e fusões.
3. A jornada de marketing pertence ao contato. A negociação mantém seus eventos comerciais e a conversão que originou o card. Vários cards podem consultar a mesma jornada sem duplicar eventos.
4. No card, permitir filtrar “Tecfag Chat”, “RD Marketing” e “Todos”. Preservar origem, data original, referência externa e indicação da última sincronização. A Fonte/Campanha do card continua sendo a atribuição da conversão de criação, não o último valor do perfil do contato.
5. Receber notificações, buscar detalhes autorizados e gravar eventos locais sem criar outro card automaticamente. Usar consultas sob demanda com cache e reconciliação em segundo plano, limitada aos contatos necessários e ao orçamento de requisições da conta.
6. Gravar a mudança comercial e a pendência de envio ao Marketing na mesma transação. Um worker realiza o envio, registra resposta/erro, controla concorrência e agenda novas tentativas. O atendimento continua quando RD estiver indisponível.
7. Impedir ciclos: evento importado não gera novo envio idêntico; resposta a evento emitido por nós não gera novo card. Não representar cada atualização de tarefa/etapa como `CONVERSION`: isso pode inflar conversões e acionar automações novamente.

## Regras para vários cards do mesmo contato

- Uma perda não deve automaticamente marcar o lead como perdido se outra negociação segue aberta. Definir agregação de oportunidade por contato e funis participantes nas configurações.
- Registrar venda por negociação e controlar transições/reabertura; não reenviar `SALE` a cada salvamento. Verificar idempotência remota e tratamento de timeout ambíguo antes de automatizar receita.
- Uma empresa pode ter vários contatos. Definir o lead destinatário do evento comercial, inicialmente o contato de origem/principal, sem replicar uma venda para todos os participantes.
- Mapeamento de etapa, responsável e demais atributos deve indicar qual informação é agregada no contato e qual existe apenas no card. Um campo único no Marketing não representa várias etapas simultâneas de cards diferentes.
- Tecfag Chat governa eventos comerciais; RD Marketing governa eventos de marketing. Autoridade e enriquecimento dos campos cadastrais são definidos por mapeamento, evitando sobrescritas recíprocas.

## Alternativas para o histórico completo

- **Integração pública:** conversões/oportunidades na jornada local e devolução de oportunidade/venda/perda/chat. É a base comprovada pela documentação; inclui informações comerciais mapeadas para segmentação.
- **Pontos configurados nas automações:** usar ações de envio em pontos escolhidos para registrar “passou pelo ponto X do fluxo”. Endpoint e ação de jornada separados da criação de card. Esses pontos não recuperam o histórico anterior nem provam abertura de e-mail, visita ou conclusão nativa do fluxo.
- **Interface oficial ampliada:** solicitar à RD documentação de API/SDK/componente aprovado para timeline completa e registros comerciais nativos. Confirmar planos, permissões e histórico retroativo. Não depender de endpoints privados nem automação da interface do produto.

## Prova de conceito antes da implementação ampla

Usar uma conta de teste autorizada: identificar um contato, consultar todas as páginas de conversões/oportunidades e comparar com o painel; enviar oportunidade, venda, perda e início/fim de chat; observar a timeline e os efeitos nas automações. Testar dois cards simultâneos, reabertura, mudança de e-mail/telefone, retries, falha temporária e isolamento entre tenants. Solicitar à RD os recursos oficiais para as categorias ainda não documentadas.

Só após essa prova fechar a matriz de recursos da versão inicial. Se timeline integral for critério obrigatório para retirar RD CRM, tratá-la como condição de aceite; não presumir equivalência com a integração nativa.

## Fontes oficiais consultadas

- [Eventos do contato: tipos disponíveis e paginação](https://developers.rdstation.com/reference/get_platform-contacts-uuid-events-1)
- [Webhooks e gatilhos](https://developers.rdstation.com/reference/webhooks)
- [Oportunidade](https://developers.rdstation.com/reference/evento-marcacao-oportunidade)
- [Venda](https://developers.rdstation.com/reference/evento-marcacao-oportunidade-ganha)
- [Perda](https://developers.rdstation.com/reference/evento-marcacao-oportunidade-perdida)
- [Início de conversa](https://developers.rdstation.com/reference/evento-inicio-conversa)
- [Término de conversa](https://developers.rdstation.com/reference/evento-termino-conversa)
- [Atualização do contato sem conversão](https://developers.rdstation.com/reference/patch_platform-contacts-identifier-value-1)
- [Estatísticas de e-mails em fluxos](https://developers.rdstation.com/reference/get_platform-analytics-workflow-emails)
- [Identificação por telefone nos eventos](https://developers.rdstation.com/changelog/marketing-v2-suporte-phone-api-eventos)

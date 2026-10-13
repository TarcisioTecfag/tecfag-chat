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
3. A jornada completa pertence ao contato e inclui eventos de marketing e de todas as suas negociações, inclusive anteriores à criação do card aberto. Cada negociação mantém seu próprio estado e seus eventos. Os cards consultam a mesma jornada sem duplicar os registros; o evento aponta para a negociação específica quando houver vínculo comprovado.
4. No card, permitir filtrar “Tecfag Chat”, “RD Marketing” e “Todos”, além do tipo de evento. Eventos ligados a outra negociação oferecem “Abrir negociação”. Preservar origem, data original, referência externa e indicação da última sincronização. A Fonte/Campanha do card continua sendo a atribuição da conversão de criação, não o último valor do perfil do contato.
5. Receber notificações, buscar detalhes autorizados e gravar eventos locais sem criar outro card automaticamente. Usar consultas sob demanda com cache e reconciliação em segundo plano, limitada aos contatos necessários e ao orçamento de requisições da conta.
6. Gravar a mudança comercial e a pendência de envio ao Marketing na mesma transação. Um worker realiza o envio, registra resposta/erro, controla concorrência e agenda novas tentativas. O atendimento continua quando RD estiver indisponível.
7. Impedir ciclos: evento importado não gera novo envio idêntico; resposta a evento emitido por nós não gera novo card. Diferenciar o significado comercial de uma atividade do tipo técnico utilizado pelo provedor. Um evento comercial retornado pelo Marketing não passa automaticamente pela regra que cria cards para conversões de captação. Validar métricas e gatilhos antes de utilizar conversões para representar atividades comerciais.

## Regras para vários cards do mesmo contato

- Registrar cada venda e perda como evento independente, vinculado ao card que a originou. A existência de outra negociação aberta não deve suprimir o registro de uma perda. Uma venda posterior não apaga perdas anteriores, e uma perda não encerra as demais negociações.
- Separar o registro histórico do estado atual do contato no funil de Marketing. A documentação descreve `OPPORTUNITY_LOST` como desmarcação de oportunidade; testar esses efeitos sem confundi-los com a perda de um card específico. A regra anterior de não registrar perdas enquanto houver outro card aberto foi retirada após o esclarecimento operacional do usuário.
- Registrar venda por negociação e controlar transições/reabertura; não reenviar `SALE` a cada salvamento. Verificar idempotência remota e tratamento de timeout ambíguo antes de automatizar receita. Se um card for reaberto e fechado novamente, distinguir nova ocorrência legítima de reenvio técnico.
- Uma empresa pode ter vários contatos. Definir o lead destinatário do evento comercial, inicialmente o contato de origem/principal, sem replicar uma venda para todos os participantes.
- Mapeamento de etapa, responsável e demais atributos deve indicar qual informação é agregada no contato e qual existe apenas no card. Um campo único no Marketing não representa várias etapas simultâneas de cards diferentes.
- Tecfag Chat governa eventos comerciais; RD Marketing governa eventos de marketing. Autoridade e enriquecimento dos campos cadastrais são definidos por mapeamento, evitando sobrescritas recíprocas.

## Alternativas para o histórico completo

- **Integração pública:** conversões/oportunidades na jornada local e devolução de oportunidade/venda/perda/chat. É a base comprovada pela documentação; inclui informações comerciais mapeadas para segmentação.
- **Pontos configurados nas automações:** usar ações de envio em pontos escolhidos para registrar “passou pelo ponto X do fluxo”. Endpoint e ação de jornada separados da criação de card. Esses pontos não recuperam o histórico anterior nem provam abertura de e-mail, visita ou conclusão nativa do fluxo.
- **Interface oficial ampliada:** solicitar à RD documentação de API/SDK/componente aprovado para timeline completa e registros comerciais nativos. Confirmar planos, permissões e histórico retroativo. Não depender de endpoints privados nem automação da interface do produto.

## Evidências adicionais nas imagens fornecidas

O detalhamento de “Negociação atualizada” mostra data da alteração, valor, etapa, origem, URL da oportunidade, responsável, nome, empresa, qualificação, e-mail, funil, ID do evento e um ID numérico de conversão. Esses dados representam um retrato do evento naquele momento, não valores que devem mudar retroativamente ao editar o card.

A presença de um ID de conversão é uma pista para a prova de conceito: verificar se o mesmo registro aparece na consulta pública de conversões do contato e quais campos são retornados. A tela sozinha não prova essa disponibilidade nem que o ID numérico corresponde ao identificador utilizado pela API. Essa verificação pode ampliar a cobertura além das conversões de formulário.

Para o evento comercial gerado pelo Tecfag Chat, o modelo local deve conter identidade do contato, identidade/URL do card, tipo da ocorrência, data original, operador, funil, etapa, valor, motivo de perda quando aplicável e um retrato da atribuição. Associar a referência devolvida pela RD ao evento local quando a API fornecer identificação suficiente. Apenas atributos aceitos pelo contrato da API podem ser enviados.

O foco inicial da jornada será conversões e seu contexto: identificador/nome da conversão, data, origem/campanha, página/URL quando fornecida, dados do evento e negociação originada. Visita a página, clique em botão e conversão são ocorrências diferentes. A sequência temporal não prova causalidade: não deduzir a página ou o clique de uma conversão apenas pela proximidade entre eventos.

Quando uma conversão gerou um card, persistir a relação explícita entre ambos. Na jornada completa, “Abrir negociação” leva ao card correspondente. Conversões que não geraram card permanecem visíveis sem vínculo inventado. Para atividades antigas do RD CRM, só oferecer redirecionamento local se houver correspondência verificável entre o ID externo e uma negociação migrada; caso contrário, preservar a referência externa disponível.

## Prova de conceito antes da implementação ampla

Usar uma conta de teste autorizada: identificar um contato, consultar todas as páginas de conversões/oportunidades e comparar com o painel, incluindo um registro comercial nativo que exiba ID de conversão; enviar oportunidade, venda, perda e início/fim de chat; observar a timeline e os efeitos nas automações. Testar dois cards simultâneos (perda em A, venda em B, ambas preservadas), reabertura, redirecionamento ao card correto, mudança de e-mail/telefone, retries, falha temporária e isolamento entre tenants. Solicitar à RD os recursos oficiais para as categorias ainda não documentadas.

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

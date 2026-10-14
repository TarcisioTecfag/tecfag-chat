# Jornada e retorno comercial RD Marketing

Implementação de 14/10/2026. Complementa OAuth e o histórico salvo, sem substituir os fluxos que criam cards.

## Configurar no sistema

1. Abra Configurações → RD Marketing e autorize a conta correta do tenant, caso ainda não esteja conectada.
2. Em **Jornada e retorno comercial**, clique em **Conectar webhooks da jornada**. O servidor cria duas URLs próprias e registra as assinaturas de conversão e oportunidade pela API. A seção mostra o resultado individual; permissões insuficientes e falhas de validação não são apresentadas como sucesso. As assinaturas feitas pela API não aparecem na tela de webhooks do RD, conforme seu contrato público.
3. Para registrar uma passagem dentro de uma automação, informe o nome do ponto e clique em **Gerar URL do ponto**. Copie a URL para uma ação de envio de webhook naquele trecho do fluxo RD. Nomeie, por exemplo, “Passou pela qualificação · Máquinas”. Use URLs diferentes para pontos distintos.
4. Para começar, escolha **Teste isolado · apenas um contato**, informe o UUID do seu lead de teste e ative **Enviar novas oportunidades, vendas e perdas**. Confira a moeda e salve. O sistema consulta o cadastro desse UUID e mostra o nome/email confirmados. Quando quiser liberar a operação, escolha **Todos os contatos** e salve novamente. Essa ativação vale apenas para acontecimentos novos. Cards antigos não são reenviados em lote.
5. Valide uma conversão, uma passagem pelo ponto configurado e venda/perda de duas negociações do mesmo contato. Revise os fluxos RD que continuam criando cards no CRM anterior antes da substituição operacional.

As configurações e tokens pertencem ao tenant da sessão autenticada. Somente administradores acessam as URLs de recebimento e o painel de envios. Cada URL contém um segredo aleatório armazenado cifrado; o recebimento identifica tenant, conexão e ponto por esse segredo, nunca pelo corpo do webhook. Ao trocar/autorizar novamente a conta, gere os vínculos da nova conexão e ative novamente o retorno comercial. Eventos pendentes da conta anterior não são redirecionados.

## Testar o envio em um único contato

Na consulta de teste do lead, busque o seu próprio email e copie o UUID retornado. Use esse UUID no destino **Teste isolado** e salve. Crie uma negociação manual vinculada a esse contato para testar oportunidade; marque outra negociação dele como ganha (com valor definido) e outra como perdida. Confira os resultados em **Últimos envios comerciais** e no histórico do seu lead no RD. As ocorrências são reais para esse lead, inclusive o valor da venda.

A restrição existe no servidor: contatos fora do teste não geram novos envios comerciais, e pendências antigas de outros contatos são bloqueadas antes de consultar ou escrever no RD. Tentar reenviar uma pendência não contorna a restrição. O destinatário é conferido novamente antes de cada POST, inclusive após renovação do token; trocar o UUID durante o processamento impede o envio para o contato anterior. Uma chamada já iniciada pode concluir.

Receber webhooks, criar cards e consultar jornadas de outros contatos continua funcionando normalmente. Liberação posterior para **Todos os contatos** não recupera as alterações ignoradas durante o teste. Configurações de envio geral que já estavam explicitamente ativas são preservadas pela migração; novas configurações começam com o destino de teste, sem ativação automática.

## O que chega e como aparece

- **Conversão/oportunidade:** assinatura pública recebe a identidade e o retrato do perfil enviados pelo RD. Os dados são gravados antes do ACK. Não cria contatos, empresas nem negociações.
- **Ponto de automação:** mostra o nome configurado e a data de recebimento do aviso. Não equivale a recuperar um registro nativo de entrada ou conclusão de fluxo; não recupera o passado. Quando há identificação da conversão de origem, o ponto é deduplicado por essa ocorrência. Sem data/identificação de origem, o sistema usa o conteúdo do aviso para reconhecer reenvios; não consegue distinguir duas passagens idênticas sem identificação diferente.
- **Fonte/campanha:** valores históricos vêm do evento/conversão. O webhook pode fornecer apenas o perfil atual; nesse caso exibe “Origem/Campanha do perfil no aviso” separadamente. Não completa uma conversão antiga com a atribuição atual. Uma conversão legada com data e identificador coincidentes pode fornecer atribuição própria.
- **Cache:** abrir o card lê páginas e avisos salvos no banco. Não há consulta RD agendada para a jornada. Consultas externas ocorrem na primeira carga, na atualização manual e no carregamento manual de páginas ainda não salvas. O leitor reinterpreta o JSON salvo para aplicar correções de formato sem consumir API.
- **Vendas/perdas:** a jornada também apresenta eventos comerciais confirmados enviados por este sistema, com o card correspondente. Datas originais e dados comerciais preservados localmente aparecem nos detalhes; o RD pode registrar a hora do recebimento.

Os avisos de conversão com identidade, data e identificador correspondentes são unificados com as conversões consultadas. Vínculos com cards exigem recibo correspondente; proximidade de horários não cria relações. Negociações/eventos comerciais sem permissão do operador não são expostos.

O endereço que cria cards ignora marcadores nativos de oportunidade, venda e perda. Direcione esses marcadores ao webhook da jornada. Payloads legados de ações de automação continuam com a regra do fluxo existente. Ao informar oportunidades pela API, revise automações RD que respondem à marcação de oportunidade e ainda enviam perfis legados para criar cards; esse perfil não identifica de forma suficiente quem originou a marcação.

## Envio comercial durável

Criação manual ou reabertura após ganho/perda gera OPPORTUNITY; transição para ganho gera SALE; transição para perda gera OPPORTUNITY_LOST. Importar um card do RD não devolve imediatamente outra oportunidade. Salvar novamente o mesmo status não repete o evento. Uma perda em A e uma venda em B permanecem independentes, inclusive se houver outro card aberto.

O evento e o retrato da negociação são gravados na mesma transação da alteração no CRM. O worker de recuperação processa pendências por tenant, com bloqueio/lease para impedir envio simultâneo por réplicas. O destinatário é o contato principal, ou o primeiro participante quando não há principal. Não replica a receita para todos os contatos da empresa.

Antes do envio, o contato existente no Marketing é localizado por UUID vinculado ou pelo identificador disponível. Não são criados leads para representar uma venda. Apenas os campos aceitos pelos eventos públicos são enviados: email/phone, funnel_name default e valor para SALE. Funil/etapa/responsável/URL do card ficam no retrato local; não são enviados como campos inventados.

- **429 e indisponibilidade antes do POST comercial:** nova tentativa com espera crescente.
- **POST sem resposta, 5xx, resposta sem confirmação ou lease abandonado:** resultado desconhecido, sem reenvio automático. Confira o histórico no RD e marque “Já registrado” ou “Não registrado · tentar novamente”. A revisão fica auditada com operador e data. Eventos posteriores do mesmo contato aguardam a resolução de um envio desconhecido.
- **Dados incompletos, moeda divergente, contato ausente ou conta alterada:** revisão necessária. A indisponibilidade do RD não impede salvar a negociação. Ao revisar um envio com valor originalmente ausente, o administrador pode completar o valor a partir do card atual; o retrato original permanece preservado.
- **Desativação:** interrompe novos enfileiramentos e a próxima chamada comercial; uma chamada já iniciada pode concluir. Reativação retoma apenas pendências da mesma conexão.

Não há idempotência remota documentada que permita repetir uma venda após timeout com garantia de não duplicar receita. Não adicionamos conversões fictícias para simular registros comerciais.

## Cobertura e pendências externas

| Informação                                                                             | Caminho                                                                                 |
| -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Conversões e oportunidades antigas                                                     | Consulta pública paginada                                                               |
| Novas conversões e oportunidades                                                       | Assinaturas públicas                                                                    |
| Passagens em pontos de automação escolhidos                                            | Ações de webhook configuradas no fluxo                                                  |
| Oportunidade, venda e perda deste CRM                                                  | Eventos públicos enviados pela fila                                                     |
| Visitas/cliques, aberturas de email, entradas/conclusões nativas antigas de automações | Não disponibilizados pelos endpoints/gatilhos públicos pesquisados                      |
| “Negociação atualizada” e “Tarefa criada” da integração nativa RD CRM                  | Não foi demonstrado um evento público equivalente para reproduzir a mesma representação |

Para as últimas categorias, é necessário obter um recurso oficial ampliado do RD ou implementar coleta futura no site. O código do site não está neste repositório; não foi instalado um rastreador nem reconstruído histórico a partir de nomes de botões ou UTMs.

Pergunta preparada para o suporte RD: “Precisamos substituir o RD CRM e exibir no nosso CRM a jornada individual do RD Marketing. Existe API, SDK ou componente oficial para consultar visitas com URL/título/data, cliques, aberturas de email e entrada/conclusão de automações por UUID, incluindo histórico anterior? Quais planos e permissões habilitam esse acesso? Existe API oficial para registrar eventos comerciais com ID e URL da negociação externa, além de OPPORTUNITY, SALE e OPPORTUNITY_LOST?”

## Fontes oficiais

- [Gatilhos públicos dos webhooks](https://developers.rdstation.com/reference/webhooks)
- [Criar assinatura e validação de destino](https://developers.rdstation.com/reference/post_integrations-webhooks)
- [Listar assinaturas da integração](https://developers.rdstation.com/reference/get_integrations-webhooks)
- [Payload do Marketing](https://developers.rdstation.com/es/reference/webhooks-payload-mkt)
- [Perfil atual e histórico de conversões](https://developers.rdstation.com/reference/rdsm-como-migrar-api-v1-para-api-v2)
- [Oportunidade](https://developers.rdstation.com/reference/evento-marcacao-oportunidade)
- [Venda](https://developers.rdstation.com/reference/evento-marcacao-oportunidade-ganha)
- [Perda](https://developers.rdstation.com/reference/evento-marcacao-oportunidade-perdida)

# Contexto de origem e consulta de produto — 21/10/2026

O atendimento industrial agora transporta a página de entrada, a página no momento da mensagem, a referência de origem e os cinco parâmetros UTM. O visitante pode iniciar uma consulta explícita de produto pelo botão da página. O evento entra no mesmo adaptador, SDR, coleta, CRM e rodízio; não cria um segundo motor de atendimento.

## O que aparece no front

- **Fagner → SDR → abrir triagem:** bloco **Origem e contexto do site**, quando há contexto registrado no ciclo.
- **Fagner → SDR → Histórico e notas → selecionar ciclo:** mesmo bloco, com a evidência preservada naquele ciclo.
- **Briefing final e atividade da negociação vinculada:** origem, campanha e última consulta explícita, sem afirmar compra ou adequação do produto.

As páginas exibidas são as registradas nas mensagens processadas, não um monitor contínuo da aba do navegador. Os registros anteriores à instalação do novo bundle não são reconstruídos. Dados enviados durante atendimento humano ficam nas mensagens; não reativam a IA nem reabrem a qualificação automaticamente.

## Instalação do botão no site novo

O bundle atualizado é **`public/site-chat.iife.js`**, separado do bundle da Valem. O canal precisa estar configurado e habilitado em ambiente de homologação antes de testar a instalação. Nenhum widget ou botão foi instalado no site de produção nesta entrega.

Com o widget carregado, um botão da página pode usar:

```html
<button
  type="button"
  data-tecfag-product-inquiry
  data-product-url="https://loja.exemplo.com/seladora/p"
  data-product-name="Seladora S100"
  data-product-sku="S100"
  data-product-category="Seladoras"
>
  Consultar este produto
</button>
```

A URL deve pertencer à mesma origem da página onde o widget está instalado. Também é possível chamar a instância já exposta pelo widget:

```javascript
window.__valemChatWidget.inquireProduct({
  url: location.origin + "/seladora/p",
  name: "Seladora S100",
  sku: "S100",
  category: "Seladoras",
});
```

O método abre o atendimento e, se necessário, aguarda a conclusão do pré-chat. A consulta enviada tem ID estável e passa pela fila persistida do navegador; reenvios usam esse mesmo ID. O pedido ainda não enviado é mantido em memória enquanto o pré-chat está aberto. Uma recarga antes de concluir o pré-chat exige clicar novamente.

## Contrato e limites

- Campos e URLs são dados **declarados pelo navegador**, sem autoridade sobre tenant, preço, estoque, porte, adequação técnica ou confirmação de compra.
- A origem vem da conexão WebSocket validada no servidor. Página de entrada, página atual e produto devem pertencer a essa origem; URLs com credenciais e protocolos diferentes de HTTP/HTTPS são recusadas.
- O contexto guarda apenas `utm_source`, `utm_medium`, `utm_campaign`, `utm_content` e `utm_term` nas URLs. Outros parâmetros e fragmentos são removidos. A URL de referência não guarda query ou fragmento. Os valores UTM continuam sendo texto informado pelo navegador, sem atribuição publicitária verificada.
- Horário de registro do evento é definido no servidor. Nomes, categoria, SKU e parâmetros têm limites de tamanho; campos desconhecidos são descartados.
- Página visitada não vira solicitação automaticamente. `product_inquiry` registra a consulta explícita; uma mensagem comum não pode transformar dados de produto enviados no payload em evento de clique.
- A entrada é mantida por aba/sessão do navegador, via `sessionStorage`. O painel identifica a última consulta explícita; o prompt determina a precedência da solicitação atual se o cliente mudar de assunto.
- Snapshot de contexto acompanha a mensagem comum em `metaDetails.siteContext`, o ciclo de triagem e as notas/briefing. Notas internas e mensagens do bot não substituem a evidência do visitante.
- A continuidade para WhatsApp copia somente o contexto validado das mensagens e o preserva no fluxo, sem expor outros metadados internos. Mantém os limites anteriores de histórico e posse.
- Não há consulta VTEX, validação de SKU pela loja, preço, estoque, frete, pedido confirmado, score comercial ou nova abordagem proativa nesta entrega. Esses itens continuam no checklist.

## Validação

- **278 testes Node em 29 suítes**, incluindo execução dos handlers reais do WebSocket e métodos reais do widget com armazenamento, DOM e transporte isolados. Não há chamadas reais de IA nesses testes.
- O novo painel foi renderizado em HTML com o componente real: campanha, SKU, links e escape de texto. Isso não substitui homologação visual no navegador publicado.
- **60 cenários PostgreSQL**, em banco local de teste com schema privado removido ao final. O novo caso verifica checkpoint, briefing, histórico e atividade CRM sem alteração automática da coleta. Servidor de teste desligado ao terminar.
- Build principal e build separado `WIDGET_BUNDLE=site-chat` aprovados. Bundle da Valem não alterado.
- Lint dos nove módulos/componentes selecionados aprovado; sem certificação de lint global.
- Typecheck geral conserva os 24 diagnósticos anteriores fora desta entrega. A inclusão de metadados foi corrigida e não deixou novos diagnósticos nos arquivos alterados.

Nenhuma escrita em banco operacional, chamada Vertex/WhatsApp, ativação do SDR/site ou mudança nos arquivos e serviços do sistema antigo foi realizada. Push de código e homologação/virada continuam sendo etapas distintas.

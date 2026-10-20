# Núcleo de triagem industrial — primeiro lote

Data: 20/10/2026. Referência: [mapa do porte](./MAPA-PORTE-FAGNER-2026-10-20.md).

Este lote inicia E0/E1 e antecipa proteções de encaminhamento de E2. **Não conclui o porte, não conecta o site ao núcleo e não constitui homologação de produção.**

## Alterações implementadas

- Política industrial sem banco/provedor em `src/lib/triage/industrial-policy.ts`, compartilhável pelos adaptadores de Site e WhatsApp. A integração deste lote é no SDR WhatsApp existente.
- Treze subfluxos canônicos, mantendo as nove colunas visuais. Financeiro geral, atendimento humano, currículo e fornecedores deixam de usar Máquinas como destino implícito.
- Precedência por intenção: manual/manutenção são suporte; boleto é financeiro; NF de pedido é Pós-Venda; estorno após devolução é financeiro geral.
- Personnalité representa linha industrial de maior desempenho. Palavra de campanha não promove o cliente automaticamente. A política aceita evidência de catálogo/revisão originada no servidor; a conexão do Decisor real será feita na próxima etapa. Até lá, menções premium seguem para revisão humana quando prontas.
- Coleta por subfluxo: AT precisa de nome e solicitação, sem documento/série como bloqueio; comercial pede documento, necessidade, aplicação e produção; Peças não exige questionário de produção.
- CPF/CNPJ passam por validação matemática local na elegibilidade industrial. Isso não comprova titularidade, situação cadastral nem consulta de crédito.
- Pedido explícito de pessoa/humano possui caminho direto, sem depender da conclusão do modelo ou exigir o questionário comercial.
- Resposta estruturada é validada antes do uso. Campos fora da lista são removidos; flags textuais, subfluxos desconhecidos e mensagens malformadas são rejeitados. JSON da IA não fornece evidência confiável de catálogo nem autoriza saída de áudio.
- Prompt usa a persona central e o vocabulário da política. Instruções adicionais podem vir de `agentConfigs.config.industrialInstructions`, lidas na configuração do tenant autenticado pelo servidor. Nenhuma configuração real foi gravada nesta entrega.

## Encaminhamento e CRM

`industrial-handoff.ts` distingue `collecting`, `resolved`, `waiting_for_team`, `handoff_failed` e `transferred`. Só uma atribuição verificada, com card confirmado quando necessário, produz `outcome: transferred`. Pendências continuam `in_progress`, com `currentStep` e metadados correspondentes.

O modelo não decide sozinho se um efeito foi realizado. A mensagem final de transferência vem do resultado do servidor; uma alegação prematura de criação/transferência é substituída por orientação de coleta ou pendência.

No caminho industrial:

1. Operador precisa existir no tenant e estar explicitamente autorizado para o funil. Ausência de equipe não dispara seleção em outra área.
2. A atribuição usa atualização condicional: não sobrescreve responsável existente nem conversa já em Meus/Finalizados.
3. Falha de CRM não pode ser tratada como sucesso só porque o alocador capturou a exceção.
4. Financeiro geral e pedidos de humano não exigem negociação comercial. Currículo/fornecedor podem terminar como orientação resolvida sem card ou rodízio.
5. O destino CRM deve estar configurado, com nome correspondente e etapa disponível. Não cria funil padrão nem escolhe o primeiro disponível nesse caminho.
6. A janela de três horas existente foi mantida, agora restrita à mesma pessoa vinculada, ao mesmo funil e a card aberto. O modo estrito não busca equivalência pelos últimos oito dígitos de telefone nem por empresa compartilhada entre várias pessoas. Responsável da conversa e do card são alinhados na reutilização.
7. Há nova checagem de posse antes de persistir o resultado e antes dos balões de texto industriais, reduzindo resposta atrasada após intervenção humana. Cancelamento completo de todas as mídias e filas ainda faz parte da etapa de resiliência.

**Limite importante:** card, atribuição, contador e evento ainda não compõem uma única transação durável. Este lote não resolve toda a concorrência entre processos, reservas, retry automático ou compensação de efeitos parciais. Esses pontos continuam em E2/E5 e precisam de testes com PostgreSQL separado antes do go-live.

## Configuração e isolamento

- O perfil `triagePolicy: industrial` é definido na fonte central de persona, sem escolher provedor pelo nome da empresa.
- Ausência de configuração SDR não cadastra nem habilita o perfil industrial automaticamente.
- Consulta de rodízio sem configuração industrial retorna escala vazia, sem cadastrar equipe de referência.
- A tela Fluxos expõe os 13 destinos industriais, inclusive Atendimento Geral/Análise e Financeiro geral. As opções anteriores permanecem para o perfil Valem.
- O classificador anterior foi separado em `legacy-sdr-routing.ts`, preservado para o caminho não industrial. Vinte casos de compatibilidade com o snapshot anterior são executados na suíte.
- Escritas de `agentConfigs` revisadas no rodízio agora filtram ID e tenant.
- Não houve migration, seed, consulta ao banco operacional, chamada de IA ou envio a clientes para validar este lote. Não houve deploy nem ativação de go-live.

Há trabalho de notificações realizado em paralelo no mesmo checkout. Suas alterações foram preservadas; não são parte da implementação de política descrita aqui.

## Validação

Comando reproduzível da suíte isolada:

```powershell
npm run test:triage
```

Equivalente direto:

```powershell
node --experimental-strip-types --test test/industrial-triage.test.mjs
```

Resultado: **84 testes aprovados**, sem imports de banco ou provedores. Cobrem classificação, coleta, documentos, intervenção humana, validação de JSON, encaminhamento com dependências simuladas, seleção autorizada e compatibilidade do classificador anterior. Os testes de handoff verificam o contrato da orquestração; não equivalem a execução das queries em PostgreSQL.

Auditoria comparativa dos 20 cenários originais: **20 colunas iguais, zero divergências**, mais quatro casos de metadados. [Evidência atual com hashes](./fagner-triage-parity-core-v1-2026-10-20.json). O [snapshot anterior](./fagner-triage-parity-2026-10-20.json), com 11 divergências, foi preservado. Essa comparação é local e dirigida a riscos; não mede precisão de LLM nem paridade do atendimento completo.

Lint passou nos módulos novos de política, encaminhamento, validação de resposta, prompt e compatibilidade. Build Vite/Nitro passou. **A checagem global de TypeScript ainda não está aprovada.** Uma comparação com HEAD registrou 19 erros anteriores e 17 atuais, sem novos diagnósticos naquele momento. A checagem final encontrou também diagnósticos nas alterações paralelas de notificações e transferência manual, além dos erros anteriores em contatos/CRM, assistente e testes antigos. Nenhum diagnóstico final aponta os novos módulos de triagem. Dois erros de contrato existentes no motor foram corrigidos: evento `sdr_flow_updated` e parâmetro de imagem não suportado. O resultado da comparação é um retrato intermediário, não uma certificação do checkout combinado.

## Continuação

1. Fechar E2: reserva e contagem atômicas por tenant/ciclo, transação consistente e recuperação idempotente de efeitos parciais, com testes de concorrência em banco separado.
2. Conectar catálogo/Decisor e consolidar mapeamento de IDs de fila/funil, substituindo a correspondência por rótulo.
3. Adaptar o site ao mesmo núcleo e controle de posse, com validação pública da instalação/visitante.
4. Implementar vínculo seguro e continuidade site ↔ WhatsApp, preservando card, responsável, histórico e perguntas pendentes.
5. Homologar casos completos, resiliência, dados e virada conforme o mapa. RD Marketing permanece independente.

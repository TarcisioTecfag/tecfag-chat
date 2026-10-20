# Porte Fagner Site + Conversas: entrega consolidada e pendências

Data: 20/10/2026. Repositório: `TarcisioTecfag/tecfag-chat`, branch de trabalho `main`.

## Objetivo mantido

Fagner Site e Fagner Conversas passam a compartilhar o atendimento nativo do Tecfag Chat: mesma triagem, coleta, distribuição, CRM e histórico. O cliente pode ser atendido no site e continuar no WhatsApp com contexto. RD Marketing continua independente. O provedor do WhatsApp continua configurável por tenant.

**Implementação de código não é homologação da operação.** O sistema anterior não foi desligado, o catálogo não foi importado para a operação e o SDR não foi ativado por estas entregas. O push publica os fontes; automações de Lovable/hospedagem podem reagir conforme a integração configurada. Este registro não comprova qual versão está efetivamente em produção.

## O que já foi feito

### 1. Inventário do legado

Mapeados 47 itens: 27 de Conversas e 20 do Site, com 13 subfluxos de atendimento e critérios de homologação. A matriz diferencia núcleo implementado, capacidade parcial e integração ainda não demonstrada. Os documentos históricos de cada lote permanecem preservados; pendências descritas em relatórios antigos podem ter sido resolvidas nos posteriores.

### 2. Núcleo único de triagem

- Política comum para máquinas, Personnalité, peças, financeiro, assistência técnica, pós-venda, atendimento humano, currículo e fornecedores.
- Coleta proporcional à intenção. Assistência técnica e pedido de humano não exigem o questionário comercial completo; peças não exige perguntas de produção.
- Precedência para suporte/financeiro/pós-venda quando essas são as solicitações do cliente.
- Validação matemática de CPF/CNPJ; parser para recusar respostas de IA malformadas e campos não autorizados.
- Persona central por tenant, contexto de custos e Vertex AI como infraestrutura de IA. O classificador anterior permanece separado para o caminho legado da Valem.

### 3. Distribuição e CRM consistentes

O encaminhamento registra a conclusão da coleta e efetiva card/vínculo, responsável, setor, carteira, contador e recibo na mesma transação. Falha intermediária reverte os efeitos. Repetição do mesmo ciclo não consome novamente o rodízio. Tomada humana e ciclo mais recente são revalidados.

Operadores precisam pertencer ao tenant, ao setor e à escala autorizada. Sem equipe ou destino válido, o atendimento fica pendente com causa registrada. A reutilização de card considera pessoa, funil, card aberto e janela de três horas. Fluxos informativos podem terminar sem negociação ou distribuição.

### 4. Catálogo, Decisor e destinos por ID

Fluxos ganhou configuração administrativa de máquinas, códigos/SKUs, linhas, capacidade, famílias não comercializadas e destinos por IDs de setor/funil/etapa. Edição concorrente exige revisão atual; importação prepara rascunho e não habilita o SDR.

O Decisor verifica referência, categoria e capacidade compatível. Sugestão de IA é confrontada com o catálogo; insuficiência de evidência, contradição ou falha exige revisão. Campanha ou capital cadastral não confirmam sozinhos a linha do equipamento.

Preparado um snapshot offline de 1.037 registros. Os conflitos de SKU `964` e `1137` permanecem para conferência; não houve importação operacional.

### 5. Site no atendimento nativo

O widget industrial grava contato, conversa e mensagens no núcleo comum e usa o mesmo SDR e encaminhamento do WhatsApp. O operador atende pelo módulo Conversas. Há identidade visual do Fagner, controle de habilitação e origens, verificação do visitante e prevenção de saudação duplicada.

O bundle do Fagner é separado do widget publicado da Valem. O canal industrial fica desligado por padrão. A saída humana para o site ainda aceita somente texto; anexos e templates nessa saída continuam limitados.

### 6. Continuidade site → WhatsApp

O vínculo exige código temporário de uso único recebido pelo WhatsApp do próprio cliente; telefone digitado no site não basta. O banco armazena hash vinculado ao tenant e verifica prazo/consumo.

São transportados os dados coletados e as últimas 200 mensagens externas. Com operador no site, a continuidade preserva responsável/card conforme a posse existente, sem novo rodízio. Em automação, continua a coleta. As duas conversas recebem rastreabilidade e o ciclo do site é encerrado. Não é migração de todo o acervo de mensagens e mídias.

### 7. Silêncio e recuperação

Implementadas política industrial de follow-up, expediente, resgate parcial do site, estado Sem Resposta e retorno do cliente. Existem recuperação de turnos interrompidos e fila persistida para os avisos após o encaminhamento.

Corrigido o contrato incompatível entre plugin e recuperador. Aviso ao operador e confirmação ao cliente têm resultados independentes: sucesso de um não é apagado pela falha do outro. Cancelamento por mudança de posse/fechamento é diferente de envio. ID estável e prova local reduzem duplicação; aceitação pelo canal não comprova leitura nem entrega externa exatamente uma vez.

### 8. Monitoramento real e diagnóstico

Removidas métricas simuladas do painel de agentes. A contagem considera ciclos correntes, estado ativo e início do dia em Brasília. Métricas ainda não instrumentadas, como conversão e duração histórica, aparecem indisponíveis.

O monitor distingue coleta, prontidão, espera por equipe, pendência de encaminhamento, transferência confirmada, atendimento humano, sem resposta, encerramento e continuidade. Responsável/card antigos não são tratados como prova do ciclo atual. Causas controladas mostram orientação operacional sem expor SQL, credenciais ou prompts.

### 9. Histórico e notas progressivas

Criadas busca e paginação de atendimentos, ciclos e notas, além da janela do painel ao vivo. Reinícios arquivam a coleta antes de substituir o SDR; outros agentes são preservados. Entrada repetida não cria vários reinícios. A reabertura industrial pelo Baileys passa a iniciar novo ciclo preservando os não lidos e a posse humana.

Notas internas registram a evolução da coleta e eventos do ciclo na mesma transação do estado. Elas são excluídas do contexto do SDR, régua de silêncio e cópia externa entre canais. Resumos legados ainda existentes são preservados fora da antiga janela de 20 itens e identificados como incompletos. Dados já descartados não são reconstruídos.

### 10. Briefing e revisão humana

O briefing reúne dados, pendências, decisão e encaminhamento registrados no ciclo, inclusive em fluxos sem card. Fica no histórico e, quando há recibo e vínculo ativo confirmados, na atividade da mesma negociação. A notificação interna inclui o briefing do momento da distribuição.

Operadores autorizados podem corrigir ou conferir a coleta atual, com autor real, motivo e controle de conflito. Automação ativa e ciclos encerrados/continuados impedem edição. A revisão não refaz distribuição. Mudança de documento elimina aliases e enriquecimento antigo da coleta; mudança relevante exige reanálise do catálogo. Nova alteração da coleta torna a revisão anterior desatualizada.

O formulário não aprova tecnicamente uma máquina, não muda destino e não sincroniza automaticamente o cadastro do contato; essas ações permanecem nos fluxos próprios.

### 11. Isolamento, consistência e testes

As novas APIs internas usam sessão, tenant do servidor e controle de permissões. Leituras/escritas e vínculos de entidades são filtrados por tenant. Site público tem validações próprias. Respostas de consulta usam `no-store`. Foram reforçados controle de posse, fechamento e concorrência nos caminhos alterados.

Os testes verificam comportamento do código, contratos, transações e concorrência. A interface de revisão foi conferida com componentes reais e APIs fictícias em prévia isolada. Isso não equivale a testar autenticação, IA ou transporte em operação.

## O que entra nesta publicação do Git

As bases de política, transação, catálogo, site, continuidade e silêncio já estavam versionadas em lotes anteriores, chegando ao commit `efdb987`. Esta publicação consolida os avanços posteriores: correções da retomada, monitor real, diagnósticos/entrega, histórico/notas, briefing/revisão humana, testes e evidências. O histórico publicado não é reescrito.

O commit de publicação pode ser identificado no histórico deste arquivo. Registros JSON anteriores mantêm o commit e o estado local do momento da verificação; não são reescritos para simular uma validação posterior.

## Verificação mais recente

- 258 testes Node em 24 suítes; a suíte foi repetida antes da publicação.
- 55 cenários PostgreSQL em banco local com schema privado removido ao final; sem migrations/seeds operacionais.
- Build aprovado e repetido antes da publicação.
- Lint aprovado nos módulos novos e arquivos selecionados de cada lote; não há aprovação global do lint.
- TypeScript mantém 21 diagnósticos preexistentes, sem novos diagnósticos na comparação do último lote. Esses problemas continuam sendo trabalho pendente do projeto.
- Verificação do diff e busca por padrões de credenciais nos arquivos da publicação, sem ocorrências detectadas. Arquivos locais de credenciais, ambientes e caches de teste não fazem parte do conjunto.

## O que ainda falta da implementação

1. **Contexto do site:** integrar página, categoria/produto, botão de consulta, origem/UTM e campanha ao atendimento comum; aproveitar melhor o pré-chat e completar a abordagem proativa industrial.
2. **Loja:** integrar busca/especificações VTEX, preço público, frete, links e webhook autenticado/idempotente de pedido confirmado, com política clara por canal.
3. **Qualificação ampliada:** score comercial em cinco dimensões, LMS/enriquecimento ainda parcial, calibração do score de navegação e política completa para pessoa específica, indisponibilidade e frustração.
4. **Operação e relatórios:** avaliação/NPS, motivos/atenção no fechamento, relatório diário, exportações, métricas históricas com denominadores e simulador isolado.
5. **Funcionalidades parciais:** envio humano de anexos ao widget, tratamento completo de mídias entre canais, nomes amigáveis de referências/setores e reconciliação cadastral/CRM frente ao legado.
6. **Qualidade técnica:** tratar os 21 erros de tipos, pendências de lint, concorrência entre processos na geração, carga, cotas, reconciliação de custos e falhas reais de transporte/reinício.
7. **Migração e virada:** preparar/executar importação idempotente e reconciliação, validar dados e configurações finais, fechar o roteiro de homologação e o plano de corte/rollback por canal.

## O que depende de validação conjunta

Confirmar catálogo oficial e conflitos de SKU, setores/equipes/funis por ID, agenda e regras operacionais; testar casos reais anonimizados com Vertex, widget, Meta e Baileys; conferir a versão efetivamente publicada e aprovar a virada. A condução técnica, os ajustes e as correções encontrados nesses testes continuam sendo responsabilidade da implementação.

O [mapa inicial](./MAPA-PORTE-FAGNER-2026-10-20.md), a [matriz das 47 capacidades](./MATRIZ-PARIDADE-FAGNER-2026-10-20.md) e o [checkpoint de retomada](./RETOMADA-PORTE-FAGNER-2026-10-20.md) detalham as evidências e os limites de cada item.

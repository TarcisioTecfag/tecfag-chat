# Teste do wizard como operador — Tecfag

Data: 27/10/2026. Ambiente publicado: https://tecfagchat.up.railway.app/acessos/usuarios. Conta indicada pelo usuário: João Lanza, tenant Tecfag. Senha não registrada neste relatório.

**Resultado: reprovado para homologação.** Foi possível percorrer o Chat, CRM, Mini Chat, Tarefas, Base de Clientes, Carteira e Perfil até a posição **230/230**, mas a passagem pelos botões não representa execução das funcionalidades ensinadas. Depois de revisar a abertura, o progresso persistido ficou em **92%**, bloqueado pelo capítulo Início Comercial, indisponível para esta conta.

## Como o teste foi feito

Login pela página normal, navegação visível com mouse e teclado, ações oferecidas pelo próprio wizard, pausa, retomada, reinício, índice de capítulos e resumo final. Não foram injetados estados React, chamadas de API, cookies ou conclusões artificiais. As operações de envio, cadastro e exclusão das telas operacionais não foram executadas; foram usados os controles demonstrativos do wizard. Ligações, microfone e os módulos excluídos pelo usuário não foram ativados.

O teste começou em Operadores & Usuários. Na primeira passagem, a transição da abertura para Início Comercial redirecionou para `/inicio/todas`, exibiu carregamento e voltou ao Chat. O menu de João não oferece Início. Retomar nesse ponto reproduziu o problema. Para examinar o restante, foi necessário reiniciar e usar o índice para entrar no capítulo Chat. Portanto, **não houve percurso linear bem-sucedido pelos oito capítulos**.

| Trecho observado na conta João        | Execução pela interface                                                                    | Resultado                                                                                                          |
| ------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| Abertura, posições 1–5                | Iniciar, Voltar/Próximo, Pausar, Retomar e reiniciar; abertura revisada novamente ao final | Controles básicos funcionam; contadores de abertura estão vazios; pausar não restituiu a página inicial de acessos |
| Início Comercial, posições 6–24       | Tentativa de entrada e retomada                                                            | Bloqueado: capítulo exigido para uma conta sem acesso ao módulo                                                    |
| Chat, posições 25–99                  | Percorridos os passos pelos controles demonstrativos                                       | Navegável; vários exercícios concluem pelo botão genérico, sem o controle específico                               |
| CRM e Mini Chat, posições 100–164     | Filtros, criação, ficha, operações em lote, histórico, arquivos e Mini Chat                | Navegável; cadastro demonstrativo não apresenta os campos correspondentes                                          |
| Tarefas, posições 165–179             | Agenda, filtros e sequência de criação                                                     | Navegável; o wizard aceita conclusão sem título, vínculo ou data preenchidos                                       |
| Clientes e empresas, posições 180–201 | Cadastro, vínculo, atendimento e histórico                                                 | Navegável; confirmações genéricas substituem a prática dos formulários                                             |
| Carteira, posições 202–212            | Busca, vínculos e templates                                                                | Houve retorno observado de 210 para 208 durante avanço; o caminho pôde ser retomado                                |
| Perfil e conclusão, posições 213–230  | Status, aparência, atalhos e finalização                                                   | Última posição alcançada; resumo impediu conclusão oficial com cobertura incompleta                                |

## Falhas reproduzidas

1. **Elegibilidade incorreta bloqueia a conclusão.** O wizard inclui 19 etapas do Início Comercial para João, embora o módulo não esteja disponível no menu. A tentativa de entrada interrompe o treinamento. Após completar os outros trechos e revisar a abertura, a janela de retomada mostrou 92%.
2. **Exercícios são concluídos sem prática específica.** Em etapas de cadastro, transferência, resposta e fonte, `Praticar Ação` avança sem exigir os campos ou a interação descrita. O teste percorreu as confirmações oferecidas; não certifica treinamento funcional dessas operações.
3. **Formulário ausente no exercício de contato da negociação.** Na posição 117, `crm.new-deal-contact`, o alvo `deal-create.contact` era uma `DIV` e o painel demonstrativo tinha zero inputs, textareas, botões ou comboboxes próprios. Mesmo assim, o guia oferecia concluir a prática. A imagem salva mostra o quadro operacional ao fundo e o painel genérico.
4. **Restauração incompleta.** Iniciando em `/acessos/usuarios`, pausar levou ao Chat, em vez da tela original. O teste não verificou restauração de todos os rascunhos, pois não os alterou.
5. **Regressão de posição durante avanço.** O registro incremental capturou `wallet.template-edit` na posição 210 retornando a 208. Isso comprova comportamento visível fora de ordem; a causa de cada recarregamento observado não foi determinada em produção. Erros de automação e perdas temporárias de contexto não foram contabilizados como defeitos do produto.
6. **Contadores de abertura vazios.** A janela mostra `/ etapas`, embora a porcentagem seja exibida.

## Resultado final observado

Ao acionar **Finalizar Tour** na posição 230, o resumo mostrou **204/227 etapas instrucionais, 90% e 23 pendências**. As primeiras quatro eram etapas da abertura apagadas pelo reinício; as demais correspondem ao Início Comercial. O resumo não ofereceu confirmar conclusão com esse resultado, o que é uma proteção correta.

Depois de revisar as quatro etapas da abertura, a entrada em Início novamente interrompeu o tour. A janela reaberta mostrou **Retomar de onde parei (92%)**. Não foi registrada conclusão oficial nem apresentado 100% como homologação.

## Evidências locais

Em `.codex-audit/onboarding-validation-2026-10-27/`:

- `wizard-publicado-etapa-117.jpg`: exercício de vincular contato sem formulário correspondente.
- `wizard-publicado-bloqueado-92.jpg` e `wizard-publicado-92-dom.txt`: progresso persistido após revisar a abertura.
- `percurso-publicado.jsonl`: registro incremental a partir da posição 133, incluindo repetições, regressão e falhas de automação. Os trechos anteriores foram observados durante o percurso, mas não estão integralmente neste arquivo; houve reinicialização da sessão de automação.

## Correções locais e limite desta validação

As alterações locais tratam os seis achados da [auditoria anterior](VALIDACAO-FAGNER-ONBOARDING-2026-10-27.md): execução em área separada com dados em memória, alvos limitados a essa área, portais protegidos, prática validada antes de avançar, capacidades derivadas da sessão/banco, revisão e execução obrigatórias, reconciliação de conflitos e contratos corrigidos. O conteúdo passou à versão 2 para não reaproveitar conclusões obtidas pelo fluxo anterior.

O treinamento corrigido usa **exercícios próprios** para manter a operação real protegida. Não representa uma cópia integral, pixel a pixel, de cada formulário operacional. Essa escolha e a apresentação visual de todo o percurso ainda devem ser homologadas na versão publicada.

- `npm run test:onboarding`: **260 testes passaram**, incluindo renderização dos 232 passos atuais, ações do modelo, comandos, concorrência, elegibilidade, versões e isolamento do DOM.
- Integração adicional em DOM simulado, com React e componentes reais: **14 verificações passaram**, incluindo Select/calendário em portais, bloqueio de ações operacionais, falha de persistência e restauração ao pausar. Sessão/API são substituídas nesse teste; não equivale a navegador em produção.
- `npm run build`: **passou**.
- TypeScript: **103 diagnósticos globais**, nenhum nos arquivos do escopo onboarding/portais modificados na verificação registrada. Não há aprovação global dos tipos do projeto.

**Esses resultados locais não aprovam a versão publicada examinada.** As alterações deste atendimento não foram publicadas. É necessário publicar uma versão corrigida e repetir o percurso como operador antes de marcar a entrega como concluída.

# Destinos unificados da triagem — 21/10/2026

Decisão do usuário: um Financeiro, um Pós-Venda e nenhuma fila de Atendimento Geral. Solicitações sem área definida seguem para Análise e revisão humana.

## Onde aparece

Em **Fagner → Fluxos → Catálogo e destinos da triagem**, o administrador configura sete destinos:

1. Máquinas
2. Personnalité
3. Peças
4. Financeiro
5. Assistência Técnica
6. Pós-Venda
7. Análise e revisão humana

A escala em Fluxos usa os mesmos destinos. Boleto, NF financeira, outros assuntos financeiros, rastreio, NF do pedido e demais solicitações de pós-venda continuam sendo assuntos/subfluxos identificados pela IA e registrados no ciclo. A política industrial passa para `industrial-v3`; conserva os 13 códigos de assunto para coleta e histórico.

Solicitações de humano e demandas classificadas como `outros` sem área identificável seguem para revisão humana, sem negociação fictícia. Uma simples saudação continua em coleta para esclarecer a necessidade. Currículos e fornecedores conservam os subfluxos informativos, sem novas filas de distribuição.

## Configurações anteriores

- A leitura aceita as chaves e os nomes antigos. Nenhuma migração é executada em produção.
- Vínculos antigos idênticos são apresentados como um destino. Ao salvar, são gravadas apenas as chaves unificadas.
- Divergência de setor, funil ou etapa gera aviso na configuração. O administrador escolhe o vínculo unificado ou desativa o destino. O sistema não escolhe entre equipes divergentes.
- O backend também bloqueia esse encaminhamento, com diagnóstico `destination_conflict`, sem atribuição, card ou contagem parcial.
- Um destino que pode gerar negociação precisa ter funil e etapa configurados. A intenção financeira geral continua sem criar negociação, mesmo compartilhando o destino Financeiro.
- Autorizações antigas da escala são interpretadas por destino unificado: Fin. Boleto/Nota Fiscal/Outros → Financeiro; destinos antigos de Pós-Venda → Pós-Venda; Atendimento Geral → Análise e revisão humana. A união das autorizações ocorre somente na política industrial. Participação, folga, penalização, existência do operador e vínculo ao setor continuam obrigatórios.
- Consultar a escala não grava a conversão no banco; alterações explícitas de escala consolidam os nomes sem zerar contadores.
- Checkpoints pendentes anteriores conseguem encaminhar para o destino unificado sem nova resposta de IA. Recibos e ciclos já concluídos não são redistribuídos nem reescritos.

## Validação

- `npm run test:triage`: **264 testes aprovados**, incluindo classificação específica, configuração unificada, conflitos e regressões do classificador legado.
- Integração em PostgreSQL 18 temporário, local, com banco `industrial_triage_test`: **59 cenários aprovados**. Inclui os seis assuntos de Financeiro/Pós-Venda, retomada de checkpoint antigo, conflito sem efeitos parciais e demanda sem área para revisão humana. A suíte remove seu schema privado ao terminar.
- Build Vite/Nitro aprovado.
- Lint dos nove arquivos novos/reestruturados de triagem aprovado. Os arquivos legados maiores receberam alterações pontuais; não há certificação de lint global.
- Typecheck geral ainda apresenta 24 diagnósticos em outros módulos (incluindo Contatos/CRM, Voice Score, motores legados e testes Vitest antigos). Nenhum diagnóstico nos arquivos de implementação desta entrega.

Não houve alteração dos arquivos ou serviços do sistema antigo, ativação de SDR/site, troca de webhooks, chamadas reais de IA ou escrita em banco operacional. A implantação e os vínculos reais de equipe/CRM continuam dependendo da configuração e homologação do ambiente novo.

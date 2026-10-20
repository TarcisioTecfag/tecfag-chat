# Catálogo, Decisor e destinos industriais por ID

Data: 20/10/2026. Continuação do [handoff atômico](./IMPLEMENTACAO-HANDOFF-ATOMICO-2026-10-20.md). Política industrial atual: `industrial-v2`.

Este lote conecta o catálogo e o Decisor ao SDR industrial e substitui a descoberta de destinos por nome por vínculos explícitos. Não integra ainda o widget do site nem a continuidade site ↔ WhatsApp. Não houve deploy, importação operacional, habilitação do SDR ou execução de chamadas reais de IA para validar este trabalho. Valem conserva seu caminho de classificação e distribuição.

## Configuração disponível em Fluxos

O perfil industrial possui uma seção **Catálogo e destinos da triagem**, visível a administradores. Permite importar JSON do catálogo antigo ou do rascunho preparado, cadastrar/editar/inativar máquinas, configurar famílias não comercializadas e vincular cada destino ao setor responsável e, quando há negociação, ao funil e à etapa de entrada.

O cadastro conserva código NEXT, SKU, nome, linha, produtividade, descrição e nomes alternativos. Código/SKU ativo precisa ser único; conflitos são mostrados na tela com busca dos registros envolvidos. Importação e edição alteram um rascunho. Somente **Salvar catálogo e destinos** persiste a configuração. Esse botão não habilita o SDR.

`GET/POST /api/valentina/industrial-settings` exigem `requireSession` e administrador. Tenant e autor vêm da sessão. O contrato não aceita tenant, ID de configuração ou sinal de ativação no body. Perfis não industriais recebem 404. Configuração fica em um registro próprio de `agent_configs`, com revisão e autor; uma edição concorrente desatualizada retorna 409. Leitura não cria registros. Não foi necessária migration.

A rota genérica de configuração não pode sobrescrever ou renomear as configurações industriais de catálogo/escala, preservando a revisão e os contadores protegidos pelos serviços específicos.

## Decisão apoiada no catálogo

O novo Decisor usa exclusivamente `vertexAi.generateStructuredJson`, com contexto `feature: sdr_agent`, tenant, conversa, operação e revisão. Nenhuma chamada Gemini pública do legado foi copiada. Os testes substituem a inferência por dependência simulada; a precisão do modelo real ainda precisa de homologação.

- Correspondência exata e única de código/SKU/modelo presente nas falas do cliente é resolvida localmente. Número solto de produção não comprova SKU numérico. Extração do bot não é prova de referência exata pelo cliente.
- Sugestões sem correspondência exata usam candidatos ativos do catálogo do tenant. O modelo só sugere ID e confiança; o servidor obtém nome e linha do registro. ID inventado, resultado malformado, confiança abaixo de 95%, ausência de catálogo, falha técnica ou busca ampla demais exigem revisão.
- Categorias são verificadas pelo nome do equipamento. Uma empacotadora não vira envasadora porque sua descrição menciona envase. Código exato com categoria contraditória também exige revisão.
- Quando demanda e capacidade possuem unidades/períodos explicitamente compatíveis, produção superior ao máximo catalogado exige revisão. Há conversão entre minuto e hora; não se inventa jornada diária, densidade ou conversão entre kg, litros e unidades. Capacidade não comparável numericamente continua dependendo da avaliação contextual; não há certificação de engenharia automática.
- Personnalité passa por revisão humana, preservando a regra explícita encontrada no orquestrador antigo. Revenda/licitação também exige análise. Capital social cadastral a partir de R$ 350 mil é sinal para revisão e não altera sozinho a linha do equipamento. Campanha, ausência de Semi ou volume sem máquina concreta não comprovam Personnalité.
- Famílias explicitamente cadastradas como não comercializadas usam regra local, sem chamada adicional de IA, e podem seguir ao especialista sem o questionário comercial completo (`specialist_review`). Ausência de resultado no catálogo não é prova de que a empresa não comercializa um equipamento.
- Suporte, financeiro, peças, pós-venda e pedidos de humano conservam precedência. O Decisor comercial não substitui essas intenções.

Decisão, método, motivo, máquina, revisão e impressão digital do catálogo acompanham o checkpoint. O texto livre do modelo não autoriza efeitos no CRM. Uma decisão comercial sem prova confirmada e atual vai para revisão sem criar oportunidade automática.

## Destinos e consistência

Os vínculos usam `sectorId`, `pipelineId` e `stageId`. Renomear setor/funil/etapa não muda o vínculo. Ao salvar e novamente na transação de transferência, o servidor valida tenant, existência, pertencimento da etapa ao funil e que a etapa não representa ganho/perda. Não seleciona o primeiro funil nem cria um destino padrão no caminho industrial.

O operador precisa existir no tenant, participar do setor vinculado e estar autorizado ao destino canônico na escala. A conversa recebe o setor por ID. O recibo registra setor, revisão do destino e versão da conversa, também transmitidos à interface após o commit.

Uma alteração de catálogo entre a decisão e a transferência invalida a prova anterior e leva à análise sem card. Trocar somente o vínculo de setor/funil não altera a impressão digital do catálogo: o encaminhamento pendente usa o destino administrativo atual. Essa escolha é registrada no recibo. Destino removido, inválido ou não configurado deixa a transferência pendente; equipe sem participante elegível fica aguardando equipe. Nenhuma dessas situações usa outra área como fallback.

O helper CRM recebe IDs explícitos na mesma transação do handoff. A reutilização de negociação mantém a janela de três horas, mesma pessoa vinculada, mesmo funil e card aberto.

## Rascunho do catálogo anterior

Foi preparado offline o [rascunho de 1.037 equipamentos](./fagner-catalog-legacy-draft-2026-10-20.json), a partir do arquivo local `server/seed/machine-catalog.json` do legado. São 367 registros Semi e 670 Personnalité. O arquivo contém origem, hash, contagens e relatório de conflitos. É um snapshot de arquivo local, **não uma exportação verificada do catálogo que está atualmente no banco da operação**.

Foram encontrados dois SKUs ativos repetidos:

| SKU | Equipamentos no snapshot |
| --- | --- |
| 964 | Seladora de plástico bolha/almofada de ar (`PAMQSLAU090`) e Formadora de Almofadas de Plástico (`PAMQSLAU165`) |
| 1137 | DXDZ350D — Flow Pack Convencional (`PAMQFPAU051`) e AFPP720DH-6 — Empacotadora automática 6 colunas (`PAMQGPAU211`) |

Esses registros não foram apagados, mesclados ou importados automaticamente. O rascunho tem `readyToSave: false`; os códigos precisam de conferência antes da importação. Destinos e famílias bloqueadas reais também precisam ser configurados a partir das referências operacionais válidas. O script não acessa o banco do legado nem o novo banco.

Comando para preparar outro snapshot, com saída nova e sem sobrescrever evidências:

```powershell
node --experimental-strip-types scripts/prepare-industrial-catalog.mjs --input 'caminho/catalogo.json' --out 'caminho/novo-rascunho.json'
```

## Validação e limites

`npm run test:triage` executa as regras anteriores, os testes de catálogo/Decisor e os handlers reais de configuração com sessão/persistência simuladas. `npm run test:triage:postgres` verifica integração em PostgreSQL de teste local explicitamente informado, com schema privado e remoção apenas desse schema. Nenhuma suíte usa credenciais de IA ou envia mensagens. [Resultados e hashes](./fagner-catalog-destinations-v1-2026-10-20.json).

Resultado: **125 testes aprovados em oito suítes e 28 cenários aprovados em PostgreSQL 18.1 isolado**. Build Vite/Nitro, lint dos módulos novos e checagem de tipos focada nos arquivos alterados aprovados. A instância temporária de banco foi parada após a execução.

Os novos cenários de banco cobrem renomeação de funil/etapa, tenant de setor/funil, etapa de outro funil ou de encerramento, conflito de revisão, participação no setor, ausência de prova do Decisor, mudança de catálogo antes do commit, troca apenas de destino e especialista com coleta incompleta. Permanecem os testes de concorrência, rollback, posse e repetição do lote anterior.

O build não substitui a checagem global de TypeScript, que permanece com erros fora deste lote. A qualidade da inferência real e os fluxos completos de cliente precisam de homologação antes do go-live. A tela foi compilada e teve seu contrato validado; não foi acessada em uma sessão autenticada de produção.

Persistem os limites pós-commit do lote anterior: avisos ao operador, SSE e confirmação ao cliente ainda precisam de entrega durável. Para o próximo lote, falta adaptar o site ao mesmo núcleo, validar instalação/visitante e implementar vínculo seguro com WhatsApp preservando contexto e posse. RD Marketing continua independente.

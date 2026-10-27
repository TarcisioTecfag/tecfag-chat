export interface OnboardingStepCopy {
  title: string;
  body: string;
}

export interface OnboardingCopyVariables {
  operatorFirstName: string;
  personaName: string;
}

export function extractOperatorFirstName(fullName: string | null | undefined): string {
  const trimmed = String(fullName || "").trim();
  if (!trimmed) return "Operador";
  const [first] = trimmed.split(/\s+/);
  return first || "Operador";
}

export function interpolateOnboardingCopy(
  template: string,
  variables: OnboardingCopyVariables,
): string {
  const safeOperator = extractOperatorFirstName(variables.operatorFirstName);
  const safePersona = String(variables.personaName || "").trim() || "Fagner";
  return template
    .replaceAll("{operator.firstName}", safeOperator)
    .replaceAll("{persona.name}", safePersona);
}

export const ONBOARDING_CHAPTER_COPY = {
  welcome: {
    title: "Boas-vindas e Mapa de Trabalho",
    shortTitle: "Boas-vindas",
    description: "Apresentação inicial, contexto da empresa, prática protegida e controles do treinamento.",
  },
  home: {
    title: "Início Comercial e Diretrizes",
    shortTitle: "Início",
    description: "Indicadores do consultor, ritmo diário, agenda, diretrizes, evidências e calendário.",
  },
  chat: {
    title: "Chat, Fagner e Contexto do Cliente",
    shortTitle: "Chat & Fagner",
    description: "Filas, canais, conversa interna com o Fagner, fontes técnicas, mensagens, catálogo, Meta e ficha lateral.",
  },
  crm: {
    title: "Negociações / CRM e Mini Chat",
    shortTitle: "CRM",
    description: "Funis, Quadro e Lista, filtros avançados, criação, movimentação, ações em lote, detalhe e Mini Chat.",
  },
  tasks: {
    title: "Tarefas e Compromissos",
    shortTitle: "Tarefas",
    description: "Visões Mês, Semana, Dia e Todas, filtros operacionais, criação vinculada a negócio e manutenção.",
  },
  contacts: {
    title: "Base de Clientes e Empresas",
    shortTitle: "Clientes",
    description: "Contatos por canal, prevenção de duplicidade, vínculo de negócio, busca de conversas, Jornada e contas PF/PJ.",
  },
  wallet: {
    title: "Minha Carteira e Meus Templates",
    shortTitle: "Carteira",
    description: "Clientes da carteira, risco de inatividade, titularidade versus atendimento e templates pessoais.",
  },
  profile: {
    title: "Perfil, Status, Atalhos e Conclusão",
    shortTitle: "Perfil & Atalhos",
    description: "Identificação, disponibilidade, aparência, atalhos de teclado, navegação mobile e revisão.",
  },
} as const;

export const ONBOARDING_STEP_COPY_PT_BR: Record<string, OnboardingStepCopy> = {
  // ── Capítulo 0 — Boas-vindas (5 steps) ──────────────────────────────────────
  "welcome.start": {
    title: "Bem-vindo ao seu trabalho diário.",
    body: "Olá, {operator.firstName}. Eu sou o {persona.name}. Vou acompanhar você pelas ferramentas do seu dia a dia. Podemos fazer por capítulos e retomar de onde pararmos.",
  },
  "welcome.map": {
    title: "Seu mapa de trabalho.",
    body: "Esta parte do menu reúne suas ferramentas operacionais. Vou mostrar apenas o que está disponível para o seu acesso.",
  },
  "welcome.context": {
    title: "Confira a empresa ativa.",
    body: "Antes de trabalhar, confira a empresa mostrada aqui. Nosso treinamento fica vinculado ao seu usuário nesta empresa.",
  },
  "welcome.practice": {
    title: "Prática protegida.",
    body: "Nos exercícios, os clientes e negócios são fictícios. Você pode praticar sem enviar mensagens nem alterar o atendimento de alguém.",
  },
  "welcome.controls": {
    title: "Você controla o ritmo.",
    body: "Use Voltar e Próximo para revisar. Em Pausar, eu guardo este ponto. Pelo seu perfil, você poderá rever o treinamento.",
  },

  // ── Capítulo 1 — Início (19 steps) ──────────────────────────────────────────
  "home.identity": {
    title: "Comece conferindo seu painel.",
    body: "Aqui você encontra a data, sua identificação e os indicadores do consultor. Confira se está no contexto certo antes de organizar o dia.",
  },
  "home.refresh": {
    title: "Atualize a leitura do dia.",
    body: "Este botão recarrega os indicadores. Se uma informação acabou de mudar, consulte novamente antes de tomar uma decisão.",
  },
  "home.pace": {
    title: "Entenda seu ritmo.",
    body: "Compare o faturado com o ritmo necessário por dia. O painel ajuda você a distribuir esforço, mas depende da meta configurada.",
  },
  "home.goal": {
    title: "Acompanhe a meta.",
    body: "A barra mostra o realizado e a referência esperada para o período. Observe também quantos dias úteis ainda restam.",
  },
  "home.agenda": {
    title: "Veja seus compromissos.",
    body: "A agenda reúne as atividades do dia e o negócio de cada uma. Use essa relação para preparar os próximos contatos.",
  },
  "home.agenda-modal": {
    title: "Abra a agenda completa.",
    body: "Nesta lista você confere todos os compromissos exibidos para o dia. Cada negócio pode levar ao seu detalhe no CRM.",
  },
  "home.directives": {
    title: "Transforme orientação em ação.",
    body: "As diretrizes mostram o que precisa ser executado em cada negociação. Leia a instrução, o prazo e a prioridade antes de concluir.",
  },
  "home.filters": {
    title: "Separe o que exige atenção.",
    body: "Todas reúne pendências. Alta e Hoje ajudam a priorizar. Atrasadas e Concluídas aparecem quando há itens nessas situações.",
  },
  "home.overdue": {
    title: "O sino aponta atrasos.",
    body: "Este atalho seleciona as diretrizes atrasadas. Ele ajuda a chegar às pendências que precisam de uma decisão.",
  },
  "home.directive-actions": {
    title: "Abra o contexto antes de concluir.",
    body: "Você pode consultar o negócio ou registrar a tratativa. Concluir exige comprovação do que realmente aconteceu.",
  },
  "home.evidence-call": {
    title: "Registre o contato realizado.",
    body: "Para uma ligação, descreva o que foi tratado. Um relato manual precisa representar o contato que você fez.",
  },
  "home.evidence-whatsapp": {
    title: "Escolha a conversa que comprova a ação.",
    body: "No WhatsApp, confira o contato selecionado. O fluxo vincula o histórico informado como evidência da tratativa.",
  },
  "home.evidence-advance": {
    title: "A conclusão tem duas etapas.",
    body: "Este botão confere a evidência e abre o desfecho. A gravação acontece ao confirmar o resultado na próxima tela.",
  },
  "home.outcome-next": {
    title: "Deixe o próximo passo agendado.",
    body: "Se a negociação continua, escolha uma data futura, dê nome à tarefa e registre o objetivo do retorno.",
  },
  "home.outcome-won": {
    title: "Registre uma venda confirmada.",
    body: "Quando houver venda, confira o valor final e as observações antes de confirmar. Isso afeta o resultado do negócio.",
  },
  "home.outcome-lost": {
    title: "Explique uma perda.",
    body: "Se a negociação foi perdida, selecione o motivo e acrescente o contexto necessário para a equipe entender.",
  },
  "home.calendar": {
    title: "Leia o calendário comercial.",
    body: "Escolha um dia para ver as vendas registradas. A legenda diferencia hoje, dias não úteis e marcações do calendário comercial.",
  },
  "home.dossier": {
    title: "Relacione dia e resultado.",
    body: "Aqui aparecem o total do dia e os negócios vendidos. No resumo mensal, acompanhe volume e ticket médio.",
  },
  "home.crm-link": {
    title: "Continue no funil.",
    body: "Abrir CRM leva ao quadro de negociações. Mais adiante vamos praticar as ações do card e das tarefas.",
  },

  // ── Capítulo 2 — Chat, Fagner e contexto do cliente (80 steps) ──────────────
  "chat.layout": {
    title: "Organize seu atendimento.",
    body: "A lista encontra as conversas, o centro mostra o atendimento e o painel de informações traz o contexto do cliente.",
  },
  "chat.search": {
    title: "Encontre uma conversa.",
    body: "Pesquise nome, telefone, usuário do WhatsApp, CNPJ ou etiqueta. Os resultados continuam respeitando o seu acesso.",
  },
  "chat.channels": {
    title: "Separe a origem do contato.",
    body: "Estes filtros mostram WhatsApp, Instagram, Messenger e Site quando liberados para você. Cada canal mantém suas próprias condições de atendimento.",
  },
  "chat.queue-mine": {
    title: "Meus atendimentos.",
    body: "Esta fila mostra as conversas atribuídas a você. É um ponto de partida para dar continuidade ao que já assumiu.",
  },
  "chat.queue-all": {
    title: "Visão permitida da equipe.",
    body: "Todos reúne as conversas que seu grupo permite consultar. Ver uma conversa não significa poder responder por outro operador.",
  },
  "chat.queue-waiting": {
    title: "Contatos aguardando.",
    body: "Na Fila ficam atendimentos que podem precisar de um responsável. Para responder, confira a opção de assumir e suas permissões.",
  },
  "chat.queue-bot": {
    title: "Conversa em automação.",
    body: "Bot identifica conversas nesse estado. Essa aba só aparece se o seu acesso permitir; não vamos ativar nenhuma automação durante o treinamento.",
  },
  "chat.queue-closed": {
    title: "Consulte o que já foi encerrado.",
    body: "Fim guarda atendimentos finalizados. Se houver um novo assunto, a retomada depende das regras de captura do sistema.",
  },
  "chat.row": {
    title: "Leia os sinais da lista.",
    body: "Canal, última mensagem, etiquetas e contador de não lidas ajudam a priorizar. A lista carrega mais atendimentos conforme você avança.",
  },
  "chat.row-menu": {
    title: "Marque o que quer retomar.",
    body: "Você pode fixar a conversa ou marcá-la como não lida. Isso organiza sua atenção sem concluir o atendimento.",
  },
  "chat.assistant-entry": {
    title: "Seu acesso direto a mim.",
    body: "Minha conversa fica fixada aqui. Use este espaço interno para pedir orientação e consultar materiais disponíveis.",
  },
  "chat.assistant-thread": {
    title: "Converse com o {persona.name}.",
    body: "Aqui você pode pedir apoio técnico e consultar referências. Confira a fonte antes de repassar uma especificação ao cliente.",
  },
  "chat.assistant-history": {
    title: "Recupere orientações anteriores.",
    body: "Você pode ver mensagens anteriores e separar avisos de respostas. Assim encontra o assunto sem misturar todos os tipos de mensagem.",
  },
  "chat.assistant-reset": {
    title: "Comece um novo ciclo com cuidado.",
    body: "Resetar arquiva o ciclo para os anteriores. Use quando quiser reorganizar o contexto; não vamos alterar seu histórico real agora.",
  },
  "chat.assistant-cards": {
    title: "Abra a referência citada.",
    body: "Quando uma resposta traz um card de negócio ou conversa, confira o cliente e abra o contexto indicado. Esses atalhos ajudam a continuar o trabalho.",
  },
  "chat.header": {
    title: "Confirme quem está no atendimento.",
    body: "Nome, canal, fila e responsável aparecem no cabeçalho. Veja também se alguém está digitando para evitar respostas duplicadas.",
  },
  "chat.sender": {
    title: "Confira por qual número vai responder.",
    body: "Escolha somente um número autorizado e conectado. A opção corporativa segue a configuração da empresa; a troca pode preparar outro atendimento.",
  },
  "chat.sender-history": {
    title: "Reconheça a origem das mensagens.",
    body: "Este histórico pode reunir números diferentes. O rótulo indica a conexão de origem e permite consultar o atendimento correspondente.",
  },
  "chat.personal-entry": {
    title: "Seu WhatsApp de trabalho.",
    body: "Quando houver uma conexão atribuída a você, este acesso pessoal permite consultar seu estado e as ações autorizadas.",
  },
  "chat.personal-state": {
    title: "Observe o estado da conexão.",
    body: "Confira o titular, o número e se a conexão está disponível. Leitura, envio e pareamento são autorizações diferentes.",
  },
  "chat.personal-policy": {
    title: "Entenda o que será integrado.",
    body: "A política pode limitar a contatos selecionados ou integrar conversas individuais disponibilizadas pelo WhatsApp. Outras pessoas autorizadas podem consultar esse material.",
  },
  "chat.personal-qr": {
    title: "Pareie somente a sua conexão autorizada.",
    body: "O QR vincula a sessão pelo celular. No uso real, confira o número e a política antes de iniciar. Este exemplo não faz pareamento.",
  },
  "chat.personal-disconnect": {
    title: "Desconectar interrompe o pareamento.",
    body: "Este comando remove a sessão desse número. Use com intenção, pois ele não serve apenas para fechar o painel.",
  },
  "chat.info-toggle": {
    title: "Abra o contexto do cliente.",
    body: "Este botão mostra os dados, negócios e arquivos do atendimento. Na minha conversa interna, esse painel de cliente não aparece.",
  },
  "chat.system-toggle": {
    title: "Veja os eventos de sistema.",
    body: "O ponto de interrogação do cabeçalho controla informações operacionais. Ele é diferente da fonte técnica de uma resposta minha.",
  },
  "chat.system-details": {
    title: "Entenda o que o sistema registrou.",
    body: "Expanda este registro para ver a ação, a autoria e os dados associados. Recolha depois para voltar à leitura da conversa.",
  },
  "chat.search-thread": {
    title: "Ache uma mensagem.",
    body: "Digite um trecho e use anterior ou próxima ocorrência. O contador mostra onde você está; limpar e fechar devolvem a leitura normal.",
  },
  "chat.capture": {
    title: "Assuma antes de responder.",
    body: "Quando o atendimento estiver disponível, Assumir o coloca sob sua responsabilidade. Esse comando depende do seu acesso.",
  },
  "chat.other-owner": {
    title: "Respeite a posse do atendimento.",
    body: "Quando outra pessoa é responsável, o campo pode ficar bloqueado. Transferência ou assumir com exceção só aparecem quando você tem autorização.",
  },
  "chat.transfer": {
    title: "Transfira com contexto.",
    body: "Você pode escolher operador ou setor conforme as opções liberadas. Confira também qual negociação continuará como assunto do atendimento.",
  },
  "chat.deal-context": {
    title: "Escolha o assunto comercial.",
    body: "Vincule ou crie uma negociação e escolha a atual. Notas e tarefas passam a seguir esse card; negócios encerrados ficam como histórico.",
  },
  "chat.finish": {
    title: "Finalize o atendimento resolvido.",
    body: "Confira antes de confirmar. Finalizar a conversa não marca a negociação como vendida ou perdida.",
  },
  "chat.reopen": {
    title: "Retome quando houver novo trabalho.",
    body: "Um atendimento finalizado pode exigir nova captura. Confira a fila e a responsabilidade antes de continuar a conversa.",
  },
  "chat.call-shortcut": {
    title: "Atalho de ligação.",
    body: "Quando houver telefone e integração disponível, este atalho abre a ação de chamada. No treinamento, não vamos ligar para ninguém.",
  },
  "chat.message-status": {
    title: "Acompanhe a entrega.",
    body: "Os sinais mostram o estado do envio. Se houver falha ou resultado incerto, confira a reconciliação antes de enviar o mesmo conteúdo outra vez.",
  },
  "chat.message-reply": {
    title: "Responda a um trecho.",
    body: "Responder leva uma citação ao campo de escrita. Você pode cancelar a citação ou tocar nela para consultar a mensagem original.",
  },
  "chat.message-react": {
    title: "Use uma reação.",
    body: "Escolha uma reação para sinalizar entendimento. Você também pode remover a sua reação quando precisar corrigir.",
  },
  "chat.message-evidence": {
    title: "Guarde uma evidência no negócio certo.",
    body: "Confira a mensagem, escolha a negociação e explique por que este trecho é relevante para o negócio.",
  },
  "chat.message-source": {
    title: "Confira a fonte técnica.",
    body: "Neste ponto de interrogação você vê as referências usadas na resposta. Manual, catálogo e informação operacional têm níveis diferentes de comprovação.",
  },
  "chat.message-source-states": {
    title: "Conheça os limites da resposta.",
    body: "Uma informação sem manual vinculado pede validação. Quando o material não traz a resposta, eu devo indicar essa limitação sem inventar especificações.",
  },
  "chat.message-media": {
    title: "Consulte o material recebido.",
    body: "Abra imagens e vídeos para ampliar; documentos têm acesso ao arquivo. Feche a visualização para voltar ao atendimento.",
  },
  "chat.message-audio": {
    title: "Ouça com atenção.",
    body: "Use reproduzir, pausar e a barra de tempo para revisar a mensagem de voz. Não há aqui um comando de transcrição individual de áudio.",
  },
  "chat.composer": {
    title: "Escreva e revise.",
    body: "Enter envia; Shift mais Enter quebra a linha. Confira destinatário, texto e contexto antes de enviar no atendimento real.",
  },
  "chat.attachments": {
    title: "Prepare anexos.",
    body: "Você pode escolher arquivos, arrastar ou colar material compatível. Revise as miniaturas e remova o que não deve seguir.",
  },
  "chat.record": {
    title: "Grave, ouça e depois envie.",
    body: "Pare a gravação para revisar. Você pode ouvir, descartar ou enviar; o uso real do microfone precisa da sua autorização.",
  },
  "chat.emoji": {
    title: "Emojis e figurinhas.",
    body: "Escolha a categoria ou pesquise. Figurinhas salvas podem ser reutilizadas; adicionar ou excluir altera sua coleção local.",
  },
  "chat.quick-entry": {
    title: "Ganhe tempo com textos prontos.",
    body: "Digite barra ou abra este painel. Você encontra respostas globais e pessoais e pode filtrar pelo conteúdo.",
  },
  "chat.quick-insert": {
    title: "Inserir ainda permite revisar.",
    body: "A resposta escolhida entra no campo de escrita. Confira nomes e variáveis antes de enviar ao cliente.",
  },
  "chat.quick-personal": {
    title: "Cuide dos seus textos.",
    body: "Crie, edite ou exclua um texto pessoal. Use título e conteúdo claros para encontrá-lo novamente.",
  },
  "chat.quick-global": {
    title: "Textos da equipe têm permissão própria.",
    body: "As respostas globais podem ser usadas na operação. A manutenção delas só aparece para quem tem essa autorização.",
  },
  "chat.internal-note": {
    title: "Registre informação para a equipe.",
    body: "Nota Interna não é mensagem ao cliente. Confira o negócio atual ou a indicação de vínculo pendente antes de salvar.",
  },
  "chat.inline-entry": {
    title: "Peça ajuda sem sair da conversa.",
    body: "Abra minha área ao lado do campo de escrita para trabalhar uma resposta ou organizar o resumo do atendimento.",
  },
  "chat.inline-response": {
    title: "Prepare uma resposta contextual.",
    body: "Melhor Resposta usa o contexto disponível para sugerir um texto. Revise a sugestão e os dados antes de usá-la.",
  },
  "chat.inline-grammar": {
    title: "Revise o que você escreveu.",
    body: "Digite um rascunho antes de usar o corretor. Ele corrige a forma do texto sem substituir sua decisão sobre o conteúdo.",
  },
  "chat.inline-summary": {
    title: "Organize o contexto do atendimento.",
    body: "O resumo ajuda a registrar cliente, necessidade, situação e próximo passo. Confira se a síntese representa a conversa.",
  },
  "chat.inline-result": {
    title: "Aplique só depois de revisar.",
    body: "Edite ou gere de novo, copie e escolha inserir no campo ou como nota. Inserir uma sugestão não envia mensagem ao cliente.",
  },
  "chat.catalog": {
    title: "Escolha material do catálogo.",
    body: "Pesquise nome, código ou categoria. Amplie a imagem para conferir o item e selecione somente o material adequado ao cliente.",
  },
  "chat.catalog-attach": {
    title: "Anexe e confira o rascunho.",
    body: "Os itens selecionados entram como anexos. Você ainda pode revisar ou remover antes de enviar.",
  },
  "chat.meta-window": {
    title: "Observe a janela do canal.",
    body: "No WhatsApp oficial, a tela informa a condição da janela. Quando ela fecha, mensagem livre fica bloqueada e você precisa de um template aprovado.",
  },
  "chat.meta-help": {
    title: "Use a regra mostrada pelo servidor.",
    body: "Esta explicação ajuda a entender a janela de atendimento. O estado pode mudar; confira a indicação atual antes de responder.",
  },
  "chat.meta-search": {
    title: "Encontre um template aprovado.",
    body: "Pesquise o nome ou texto e use categoria ou grupo interno. Escolha um modelo adequado ao motivo do contato.",
  },
  "chat.meta-preview": {
    title: "Confira cada variável.",
    body: "Preencha as informações pedidas e leia a prévia completa. Voltar ou cancelar permite corrigir antes do envio.",
  },
  "chat.meta-send": {
    title: "Template não reabre a janela sozinho.",
    body: "No uso real, enviar o template inicia a retomada permitida. Aguarde a resposta do cliente e a indicação de janela atualizada.",
  },
  "chat.details": {
    title: "Conheça a ficha lateral.",
    body: "Detalhes, Arquivos e Eventos reúnem contextos diferentes do mesmo atendimento. Vamos percorrer cada um.",
  },
  "chat.contact-edit": {
    title: "Mantenha a identificação correta.",
    body: "Quando seu acesso permitir, corrija nome e canais de contato e selecione a empresa vinculada. Revise antes de salvar.",
  },
  "chat.registration": {
    title: "Consulte a ficha cadastral.",
    body: "Para uma pessoa jurídica, confira os dados da Receita, endereço e quadro societário quando disponíveis. A consulta serve de apoio ao cadastro.",
  },
  "chat.context-site": {
    title: "Observe o interesse recente.",
    body: "O contexto do site pode mostrar origem, navegação e engajamento. Use os sinais disponíveis para entender melhor a necessidade.",
  },
  "chat.journey-open": {
    title: "Veja o percurso do cliente.",
    body: "Esta janela reúne o que foi registrado no site para este contato. Os indicadores ajudam a contextualizar a conversa.",
  },
  "chat.journey-client": {
    title: "Confirme o contexto do visitante.",
    body: "Na aba Cliente, veja os dados disponíveis, dispositivo, origem e vínculo. Nem todo visitante terá todos os campos preenchidos.",
  },
  "chat.journey-pages": {
    title: "Leia as páginas consultadas.",
    body: "Navegação mostra as páginas registradas e seus dados de visita. Confira o título e o endereço para identificar o assunto de interesse.",
  },
  "chat.journey-timeline": {
    title: "Conecte os acontecimentos.",
    body: "A Jornada organiza páginas, cliques e conversas no tempo. Tempo e engajamento só devem ser usados quando o rastreador os registrou.",
  },
  "chat.task-create": {
    title: "Deixe um compromisso no card.",
    body: "Informe assunto, tipo e prazo. A tarefa precisa da negociação atual para registrar o próximo passo no lugar certo.",
  },
  "chat.task-tag": {
    title: "Etiqueta não é conclusão de tarefa.",
    body: "Remover esta etiqueta altera a identificação na conversa. Para concluir o compromisso, use a ação de tarefa no módulo apropriado.",
  },
  "chat.linked-deals": {
    title: "Um cliente pode ter vários negócios.",
    body: "Compare status, valor, etapa e responsável. Escolher essa define qual oportunidade é o assunto atual do atendimento.",
  },
  "chat.linked-deal-edit": {
    title: "Edite o negócio com contexto.",
    body: "Aqui você pode revisar os campos liberados do card. Salvar altera a negociação; cancelar preserva os dados anteriores.",
  },
  "chat.linked-deal-link": {
    title: "Vincule uma oportunidade existente.",
    body: "Pesquise e confira a prévia antes de associar o negócio. Desvincular o atendimento não apaga a negociação.",
  },
  "chat.linked-deal-new": {
    title: "Crie um novo assunto quando necessário.",
    body: "Se esta oportunidade ainda não existe, crie um negócio com os dados corretos do cliente. Evite duplicar um card já cadastrado.",
  },
  "chat.shared-files": {
    title: "Recupere o que já foi compartilhado.",
    body: "Abra uma categoria de arquivo ou Links e volte à lista quando terminar. O conteúdo depende das mensagens carregadas neste atendimento.",
  },
  "chat.events": {
    title: "Consulte a história operacional.",
    body: "Eventos mostra registros do atendimento com autoria e horário. Atualize ou carregue mais quando precisar ampliar a consulta.",
  },
  "chat.external-crm": {
    title: "Reconheça o vínculo externo.",
    body: "Quando a integração e seu acesso permitirem, esta área referencia um negócio externo. Confira o vínculo antes de editar ou abrir outra ferramenta.",
  },

  // ── Capítulo 3 — CRM operacional (67 steps) ─────────────────────────────────
  "crm.pipeline": {
    title: "Escolha o funil de trabalho.",
    body: "Cada funil reúne etapas de um processo comercial. Selecione uma opção liberada para você e confirme onde está trabalhando.",
  },
  "crm.views": {
    title: "Quadro ou Lista.",
    body: "No Quadro você acompanha etapas visualmente. Na Lista, compara campos e seleciona conjuntos. As duas visões consultam negociações.",
  },
  "crm.search": {
    title: "Localize um negócio.",
    body: "Pesquise o texto e confira os filtros ativos. Uma combinação de filtros pode esconder um card que continua cadastrado.",
  },
  "crm.global-search": {
    title: "Pesquise além do quadro visível.",
    body: "A busca ampla separa negócios, empresas e contatos. Digite pelo menos dois caracteres e abra a referência correspondente.",
  },
  "crm.status": {
    title: "Separe a situação comercial.",
    body: "Em andamento, Vendido, Perdido e Pausado representam a situação do negócio. Esse status é diferente da fila de atendimento.",
  },
  "crm.owner": {
    title: "Veja sua carteira de negócios.",
    body: "Use Minhas, Todos os responsáveis ou selecione pessoas específicas. Aplicar confirma a escolha; limpar remove o filtro.",
  },
  "crm.sort": {
    title: "Traga a prioridade para cima.",
    body: "Você pode ordenar por atualização, criação, nome, tarefa, previsão, qualificação ou atividade. Escolha o critério que ajuda sua execução.",
  },
  "crm.advanced-entry": {
    title: "Refine a consulta.",
    body: "Mais filtros permite combinar características comerciais e pendências. Vamos revisar os grupos sem alterar nenhum negócio.",
  },
  "crm.advanced-stage": {
    title: "Escolha uma ou mais etapas.",
    body: "Use as etapas para concentrar a consulta em uma parte do funil. A seleção filtra a visão, não move cards.",
  },
  "crm.advanced-work": {
    title: "Encontre oportunidades paradas.",
    body: "Procure negócios sem tarefa, com tarefa vencida ou esfriando há alguns dias. O filtro ajuda a decidir o próximo contato.",
  },
  "crm.advanced-fields": {
    title: "Busque lacunas de cadastro.",
    body: "Título, qualificação, faixa de valor e campos vazios ajudam a encontrar o que precisa ser qualificado.",
  },
  "crm.advanced-relations": {
    title: "Encontre o contexto comercial.",
    body: "Combine empresa, fonte, campanha, produto e origem RD quando essas informações estiverem disponíveis.",
  },
  "crm.advanced-dates": {
    title: "Escolha a data certa para a pergunta.",
    body: "Criação, último contato, próxima tarefa, fechamento e previsão medem coisas diferentes. Use um período rápido ou informe um intervalo.",
  },
  "crm.filter-chips": {
    title: "Entenda o recorte atual.",
    body: "Estes marcadores mostram os filtros aplicados. Remova um deles ou limpe todos para ampliar a consulta.",
  },
  "crm.create-menu": {
    title: "Cadastre no lugar certo.",
    body: "Nova negociação abre uma oportunidade. As opções adicionais criam empresa, contato ou tarefa com seus respectivos vínculos.",
  },
  "crm.new-deal-core": {
    title: "Descreva a oportunidade.",
    body: "Informe título, funil, etapa e responsável. Valor e qualificação ajudam a organizar a negociação desde o início.",
  },
  "crm.new-deal-account": {
    title: "Aproveite um cadastro existente.",
    body: "Pesquise a empresa antes de criar outra. Para uma nova conta, confira PF ou PJ, documento e canais cadastrais.",
  },
  "crm.new-deal-contact": {
    title: "Escolha com quem está negociando.",
    body: "Vincule o contato correto. Se o cliente já tem uma empresa associada, confira esse contexto antes de continuar.",
  },
  "crm.new-deal-extra": {
    title: "Registre contexto útil.",
    body: "Preencha fonte, campanha, campos disponíveis e uma anotação inicial quando ajudar a continuidade do trabalho.",
  },
  "crm.new-deal-save": {
    title: "Revise antes de criar.",
    body: "Você pode cancelar, criar e abrir o negócio ou criar outro em seguida. Neste exercício, tudo fica apenas na demonstração.",
  },
  "crm.quick-company": {
    title: "Crie uma conta quando necessário.",
    body: "A conta representa o comprador PF ou PJ. Nome, documento e dados cadastrais precisam identificar a pessoa ou empresa correta.",
  },
  "crm.quick-contact": {
    title: "Cadastre sem duplicar.",
    body: "Confira as sugestões de contato existente e o vínculo de negociação solicitado. Reutilizar o cadastro mantém a história reunida.",
  },
  "crm.columns": {
    title: "Leia o volume da etapa.",
    body: "O cabeçalho mostra quantidade e valor. A coluna pode ter mais cards do que os já carregados na tela.",
  },
  "crm.stage-create": {
    title: "Crie no ponto certo do funil.",
    body: "O mais desta coluna já indica a etapa inicial da nova negociação. Confira o destino no formulário.",
  },
  "crm.card": {
    title: "Reconheça os sinais do card.",
    body: "Valor, responsável, qualificação, próxima tarefa e esfriamento ajudam a entender o negócio antes de abrir o detalhe.",
  },
  "crm.card-menu": {
    title: "Use as ações rápidas.",
    body: "Neste menu você abre a edição, cria uma tarefa ou escolhe uma etapa. Cada ação depende do seu acesso ao negócio.",
  },
  "crm.move": {
    title: "Mova quando a negociação evoluir.",
    body: "Arraste para a etapa correta ou use o menu. Se quiser desistir do arrasto, pressione Escape.",
  },
  "crm.move-terminal": {
    title: "Encerramento pede confirmação.",
    body: "Uma etapa de ganho ou perda abre esta confirmação. Confira valor ou motivo antes de concluir o resultado.",
  },
  "crm.card-task": {
    title: "Conclua uma ação realizada.",
    body: "Este atalho conclui a próxima tarefa do card. Marque somente depois de executar o compromisso.",
  },
  "crm.card-chats": {
    title: "Converse no contexto do negócio.",
    body: "Mini Chat mantém o CRM aberto. Chat completo leva à tela de atendimento com mais ferramentas.",
  },
  "crm.list-columns": {
    title: "Compare os negócios na lista.",
    body: "A lista mostra título, responsável, qualificação, etapa, valor, criação, status, tarefa e conversas. Abra um item para ver seus detalhes.",
  },
  "crm.list-pages": {
    title: "Controle o tamanho da consulta.",
    body: "Escolha dez, vinte e cinco, cinquenta ou cem itens por página e use a navegação. O total pode ser maior que esta página.",
  },
  "crm.selection": {
    title: "Confira o alcance da seleção.",
    body: "Selecionar esta página e selecionar todos os resultados filtrados são escolhas diferentes. Veja a contagem antes de continuar.",
  },
  "crm.bulk-transfer": {
    title: "Troque o responsável de um conjunto.",
    body: "Pesquise o operador e confira quais negociações estão selecionadas. A confirmação altera a responsabilidade desse conjunto.",
  },
  "crm.bulk-status": {
    title: "Atualize situações em conjunto.",
    body: "Escolha o status e informe o motivo quando solicitado. Evite aplicar o mesmo resultado a negócios que precisam de análise individual.",
  },
  "crm.bulk-fields": {
    title: "Padronize os dados selecionados.",
    body: "Qualificação, campanha, fonte e produto podem ser aplicados em conjunto. Confira o valor escolhido e o alcance antes de salvar.",
  },
  "crm.bulk-create": {
    title: "Crie atividades para um conjunto.",
    body: "Este menu permite criar tarefas ou novas negociações para empresas vinculadas. Leia a confirmação para evitar cadastros repetidos.",
  },
  "crm.bulk-move": {
    title: "Confira funil e etapa de destino.",
    body: "Mover em lote muda o contexto comercial das negociações selecionadas. Revise os dois campos antes de confirmar.",
  },
  "crm.bulk-export": {
    title: "Exporte somente o conjunto desejado.",
    body: "Confira o tipo de dado e o formato CSV ou XLSX. A seleção determina quais registros serão incluídos.",
  },
  "crm.bulk-delete": {
    title: "Reconheça uma exclusão de amplo alcance.",
    body: "A contagem e a confirmação ajudam a verificar a intenção. Lixeira e exclusão permanente têm efeitos diferentes.",
  },
  "crm.detail-header": {
    title: "Confira a oportunidade aberta.",
    body: "Nome, situação, funil e empresa identificam este negócio. Voltar retorna ao contexto de onde você abriu.",
  },
  "crm.detail-edit": {
    title: "Mantenha os dados comerciais.",
    body: "Você pode revisar título, valor, estrelas, responsável, previsão, fonte e campanha conforme sua permissão. Campos editáveis precisam de confirmação ou salvamento conforme o controle.",
  },
  "crm.detail-priority": {
    title: "Use prioridade como apoio.",
    body: "A avaliação mostra uma prioridade e sua justificativa. Use esse apoio junto com o contexto do cliente; o exercício não faz consulta de IA.",
  },
  "crm.detail-stages": {
    title: "Acompanhe a evolução no funil.",
    body: "A trilha mostra a etapa atual e permite as mudanças autorizadas. Confirme que o próximo estágio representa o que aconteceu.",
  },
  "crm.detail-outcomes": {
    title: "Registre o desfecho com intenção.",
    body: "Ganho, perda e pausa têm significados distintos. Confira o motivo; quando houver nova continuidade, use retomar ou reabrir conforme disponível.",
  },
  "crm.participants": {
    title: "Identifique os envolvidos.",
    body: "Vincule ou crie o contato, indique o papel comercial e escolha o principal. Editar ou desvincular exige conferir se é a pessoa certa.",
  },
  "crm.participant-chats": {
    title: "Abra o canal no contato correto.",
    body: "O contato pode ter atalhos de ligação, Chat e Mini Chat. Confira o telefone e o contexto antes de iniciar uma ação real.",
  },
  "crm.account": {
    title: "Vincule a conta compradora.",
    body: "Pesquise uma empresa existente ou crie uma conta válida. Abrir a ficha permite consultar contatos, negócios e atendimentos relacionados.",
  },
  "crm.custom-fields": {
    title: "Preencha os dados da operação.",
    body: "Os campos variam conforme entidade e funil. Complete os aplicáveis e salve as alterações; aqui você não configura novos campos.",
  },
  "crm.next-task": {
    title: "Garanta o próximo passo.",
    body: "Veja assunto, prazo e situação. Você pode criar, editar, reagendar ou concluir uma tarefa depois de executar o compromisso.",
  },
  "crm.task-tabs": {
    title: "Separe execução e registro.",
    body: "Pendentes, Concluídas, Canceladas e Notas têm papéis diferentes. Notas registram contexto e não são tarefas para cumprir.",
  },
  "crm.task-actions": {
    title: "Mantenha a agenda do negócio.",
    body: "Conclua o que fez, reagende o que precisa de nova data e cancele o que perdeu sentido. Reabrir e excluir também exigem cuidado com o registro.",
  },
  "crm.history": {
    title: "Leia a história da oportunidade.",
    body: "Filtre por origem e pelo tipo de evento operacional. Autoria e horário ajudam a entender quando e por que algo mudou.",
  },
  "crm.note": {
    title: "Deixe uma anotação clara.",
    body: "Use texto, destaque, listas e links para registrar contexto. Confira o endereço do link e salve somente quando a informação estiver pronta.",
  },
  "crm.marketing-history": {
    title: "Consulte os sinais já integrados.",
    body: "Quando disponível, selecione o contato e carregue o histórico do RD Marketing. Ele complementa o CRM e é diferente da jornada registrada no site.",
  },
  "crm.conversations": {
    title: "Relacione atendimentos ao negócio.",
    body: "Busque e confira o atendimento antes de vincular. Use Mini Chat ou Chat completo para consultar; desvincular não apaga a conversa.",
  },
  "crm.evidence": {
    title: "Revise as evidências.",
    body: "Esta aba mostra mensagens e observações marcadas para o negócio. Se o vínculo estiver errado, você pode desmarcar a evidência.",
  },
  "crm.products": {
    title: "Detalhe os itens negociados.",
    body: "Escolha um produto do catálogo ou descreva o item permitido, informe quantidade, preço e desconto. Confira os totais antes de adicionar.",
  },
  "crm.files": {
    title: "Anexe documentos úteis.",
    body: "Selecione ou arraste arquivos para este negócio. Nome, tipo e tamanho ajudam a conferir o material antes de abrir ou remover.",
  },
  "crm.file-preview": {
    title: "Revise o arquivo.",
    body: "O visualizador oferece controles conforme o formato. Imagens têm zoom e rotação; quando não houver prévia, use a abertura ou o download disponível.",
  },
  "crm.mini-open": {
    title: "Atenda sem perder o CRM.",
    body: "Abra o Mini Chat para consultar ou responder mantendo o negócio na tela. Ele também aparece em outros módulos operacionais.",
  },
  "crm.mini-list": {
    title: "Encontre o atendimento compacto.",
    body: "Pesquise cliente ou telefone. Minha conversa fica no topo; os demais itens seguem o acesso e os atendimentos disponíveis.",
  },
  "crm.mini-thread": {
    title: "Responda no contexto.",
    body: "Aqui você consulta mensagens, mídias, fontes e eventos disponíveis. Para usar as ferramentas completas, abra o Chat principal.",
  },
  "crm.mini-audio": {
    title: "Revise antes de enviar áudio.",
    body: "Gravar, parar, ouvir, descartar e enviar seguem a mesma atenção ao destinatário. Este exemplo não usa o microfone real.",
  },
  "crm.mini-meta": {
    title: "A janela continua valendo.",
    body: "Mesmo no Mini Chat, o WhatsApp oficial mantém o bloqueio de janela e os templates aprovados com seus parâmetros.",
  },
  "crm.mini-menu": {
    title: "Organize a janela compacta.",
    body: "Fixar, marcar não lida e transferir ajudam sua rotina. Arquivar do Mini Chat só retira o item dessa lista local; não finaliza o atendimento.",
  },
  "crm.mini-controls": {
    title: "Ajuste a janela ao trabalho.",
    body: "No computador você pode reposicionar e minimizar. No celular a apresentação se adapta ao espaço disponível.",
  },

  // ── Capítulo 4 — Tarefas (15 steps) ─────────────────────────────────────────
  "tasks.overview": {
    title: "Organize seus compromissos.",
    body: "Esta área reúne tarefas e compromissos disponíveis para seu usuário. Use atualizar se precisar consultar a situação novamente.",
  },
  "tasks.views": {
    title: "Escolha o horizonte.",
    body: "Mês mostra distribuição, Semana facilita comparar dias e Dia organiza a execução por horário.",
  },
  "tasks.period": {
    title: "Mude o período sem perder hoje.",
    body: "Anterior e Próximo acompanham a visão escolhida. Hoje traz você de volta à referência atual.",
  },
  "tasks.month": {
    title: "Selecione um dia.",
    body: "Os sinais resumem quantidade, tipo, atraso e progresso. Dias com muitos itens usam um resumo para manter a grade legível.",
  },
  "tasks.day-filters": {
    title: "Concentre a lista do dia.",
    body: "Separe pendentes, atrasadas e concluídas; pesquise título, cliente ou negócio e filtre os tipos disponíveis.",
  },
  "tasks.week": {
    title: "Compare os próximos dias.",
    body: "A semana distribui as tarefas em sete colunas. Role a lista de cada dia e confira o horário antes de agir.",
  },
  "tasks.day": {
    title: "Execute por blocos de horário.",
    body: "Atrasadas merecem decisão. Depois organize manhã, tarde e demais horários, acompanhando o que já foi concluído.",
  },
  "tasks.item": {
    title: "Conclua depois de executar.",
    body: "A marcação altera a situação da tarefa e permite reabrir quando necessário. Confira cliente, negócio e descrição.",
  },
  "tasks.chat": {
    title: "Retome a conversa do compromisso.",
    body: "Abra o atendimento vinculado ou inicie pelo contato quando essa opção estiver disponível. A posse da conversa continua sendo respeitada.",
  },
  "tasks.all": {
    title: "Procure fora do dia selecionado.",
    body: "A lista Todas permite buscar, filtrar situação e data, concluir ou reabrir e acessar o atendimento.",
  },
  "tasks.new-context": {
    title: "Vincule a tarefa a uma negociação.",
    body: "Escolha o negócio correto; a empresa ajuda a localizar o contexto. Este formulário exige um card para criar a atividade.",
  },
  "tasks.new-fields": {
    title: "Defina o compromisso.",
    body: "Informe assunto, descrição, um responsável efetivo, tipo e prazo. Escolha data e horário pelos seletores do sistema.",
  },
  "tasks.new-save": {
    title: "Revise o estado inicial.",
    body: "Marque como concluída ao criar somente se a ação já foi realizada. Caso contrário, salve como compromisso pendente.",
  },
  "tasks.reschedule": {
    title: "Reagende pelo negócio.",
    body: "Para editar, reagendar, cancelar ou excluir com os controles completos, use as tarefas no detalhe da negociação. A grade principal não oferece todos esses comandos.",
  },
  "tasks.reminders": {
    title: "Prazo e aviso são recursos diferentes.",
    body: "A agenda destaca vencimentos, mas este formulário não configura antecedência de lembrete. Os avisos do dispositivo são tratados separadamente.",
  },

  // ── Capítulo 5 — Base de Clientes (22 steps) ────────────────────────────────
  "contacts.tabs": {
    title: "Contato e conta têm papéis diferentes.",
    body: "Contatos são as pessoas com quem você fala. Empresas reúne as contas compradoras, que também podem ser pessoas físicas.",
  },
  "contacts.channels": {
    title: "Filtre pelo canal permitido.",
    body: "WhatsApp, Instagram, Messenger e Site ajudam a localizar o cadastro conforme a origem. As opções de acesso continuam valendo.",
  },
  "contacts.search": {
    title: "Pesquise antes de cadastrar.",
    body: "Procure o cliente pelos dados disponíveis. Isso evita criar outra ficha para a mesma pessoa ou empresa.",
  },
  "contacts.rows": {
    title: "Confira identificação e contexto.",
    body: "Veja canal, dados cadastrais, empresa, etiquetas e os atalhos disponíveis. A lista pode carregar mais registros.",
  },
  "contacts.new": {
    title: "Cadastre o interlocutor.",
    body: "Informe nome, telefone e os dados cadastrais necessários. Escolha o canal correto e confira as sugestões de contato existente.",
  },
  "contacts.duplicate": {
    title: "Reutilize um cadastro encontrado.",
    body: "Este aviso indica uma pessoa já cadastrada. Confira seus vínculos e continue com ela em vez de duplicar o registro.",
  },
  "contacts.company-link": {
    title: "Relacione o comprador.",
    body: "Pesquise uma conta existente ou cadastre uma nova com PF ou PJ e documento correto. Revise os campos disponíveis.",
  },
  "contacts.deal-resolution": {
    title: "Escolha o negócio do atendimento.",
    body: "Quando o fluxo pedir uma negociação, pesquise e confira a prévia ou crie a oportunidade adequada. Confirme só depois de verificar o cliente.",
  },
  "contacts.save": {
    title: "Confira o resultado do cadastro.",
    body: "Salvar pode abrir o atendimento. Se só o contato for criado, a tela orienta como abrir a conversa pela lista.",
  },
  "contacts.edit": {
    title: "Corrija sem perder a história.",
    body: "Edite os dados autorizados, a empresa e as etiquetas. Confira também o usuário do WhatsApp quando houver esse identificador.",
  },
  "contacts.attend": {
    title: "Abra o atendimento correto.",
    body: "Atender pode abrir a conversa para você ou apenas permitir consulta. Se faltar contexto comercial, selecione uma negociação antes de continuar.",
  },
  "contacts.conversation-search": {
    title: "Encontre um assunto lembrado.",
    body: "O botão Conversas pesquisa o conteúdo disponível nesse conjunto carregado. Abra o resultado para retomar o atendimento.",
  },
  "contacts.journey": {
    title: "Reveja o interesse no site.",
    body: "A mesma Jornada vista no Chat também pode partir do cadastro. Cliente, Navegação e Jornada mostram os dados registrados para essa pessoa.",
  },
  "contacts.companies": {
    title: "Consulte contas PF e PJ.",
    body: "Em Empresas você filtra Todas, Pessoa Jurídica ou Pessoa Física e pesquisa pelos dados da conta.",
  },
  "contacts.company-new": {
    title: "Cadastre a conta com atenção.",
    body: "Confira tipo, nome ou razão social, documento e canais cadastrais. Site e observações ajudam a equipe a reconhecer o comprador.",
  },
  "contacts.account-details": {
    title: "Mantenha a ficha do comprador.",
    body: "Dados Cadastrais reúne identificação e campos disponíveis. O tipo PF ou PJ já definido não é alterado nesta ficha.",
  },
  "contacts.account-registry": {
    title: "Confira os dados da Receita.",
    body: "Quando aplicável, consulte razão social, situação, endereço e quadro societário. Revise antes de salvar alterações.",
  },
  "contacts.account-contacts": {
    title: "Veja os interlocutores da conta.",
    body: "Uma conta pode ter várias pessoas vinculadas. Desvincule somente quando a relação estiver incorreta.",
  },
  "contacts.account-deals": {
    title: "Consulte as oportunidades relacionadas.",
    body: "Os negócios desta conta ajudam a entender o relacionamento comercial. Abra a oportunidade para continuar a análise.",
  },
  "contacts.account-chats": {
    title: "Consulte os atendimentos da conta.",
    body: "Veja o canal e o contexto antes de abrir uma conversa. O acesso ao atendimento continua sendo validado.",
  },
  "contacts.account-history": {
    title: "Entenda as mudanças da conta.",
    body: "O histórico registra as transições disponíveis. Use autoria e datas para compreender a evolução do cadastro.",
  },
  "contacts.account-archive": {
    title: "Arquive somente com intenção.",
    body: "Arquivar uma conta altera seu cadastro na operação. Isso não equivale a encerrar uma conversa ou apagar o histórico.",
  },

  // ── Capítulo 6 — Minha Carteira (11 steps) ──────────────────────────────────
  "wallet.tabs": {
    title: "Cuide do relacionamento e dos seus textos.",
    body: "Minha Carteira reúne clientes atribuídos a você e seus templates pessoais. Cada aba tem sua própria finalidade.",
  },
  "wallet.kpis": {
    title: "Leia sua situação operacional.",
    body: "Os indicadores mostram carteira, atendimentos próprios e textos pessoais. A lista local e a consulta de inatividade podem ter universos diferentes.",
  },
  "wallet.inactivity": {
    title: "Antecipe falta de acompanhamento.",
    body: "O painel alerta para clientes sem contato por mais de cinquenta dias e mostra a faixa superior a sessenta. Siga a política operacional vigente para retomar.",
  },
  "wallet.search": {
    title: "Encontre um cliente da carteira.",
    body: "Pesquise nome, telefone ou dados cadastrais. Aqui você está consultando os relacionamentos vinculados ao seu usuário.",
  },
  "wallet.rows": {
    title: "Titularidade e atendimento podem diferir.",
    body: "O cliente pode estar na sua carteira e em atendimento com outra pessoa. Confira a situação antes de abrir a conversa.",
  },
  "wallet.chat": {
    title: "Retome o acompanhamento.",
    body: "Este atalho abre a conversa do cliente. A fila e a posse do atendimento continuam controlando as ações disponíveis.",
  },
  "wallet.remove": {
    title: "Remover não apaga o cliente.",
    body: "A confirmação libera o vínculo de carteira. Confira a intenção: isso não exclui contato nem finaliza conversa.",
  },
  "wallet.templates": {
    title: "Seus textos de trabalho.",
    body: "Pesquise pelo título ou conteúdo, crie um texto e revise os existentes. Estes são templates pessoais, diferentes dos aprovados pela Meta.",
  },
  "wallet.template-edit": {
    title: "Dê um nome fácil de encontrar.",
    body: "Preencha título e texto. As variáveis podem ajudar na personalização; confira como elas aparecem quando inserir no chat.",
  },
  "wallet.template-vars": {
    title: "Personalize com revisão.",
    body: "Use nome, empresa ou operador na posição desejada. Antes de enviar uma mensagem real, confira se os valores foram preenchidos corretamente.",
  },
  "wallet.template-delete": {
    title: "Exclua só o texto que não usa mais.",
    body: "A confirmação remove este template pessoal. Cancelar mantém o conteúdo para futuras respostas.",
  },

  // ── Capítulo 7 — Perfil, status, atalhos e conclusão (18 steps) ─────────────
  "profile.entry": {
    title: "Seu perfil fica sempre à mão.",
    body: "Abra seu avatar para revisar identificação, status e aparência. Você não precisa entrar nos ajustes administrativos.",
  },
  "profile.tabs": {
    title: "Identificação e aparência.",
    body: "Perfil reúne seus dados de trabalho. Aparência permite ajustar a leitura da interface.",
  },
  "profile.identity": {
    title: "Mantenha sua identificação.",
    body: "Confira nome e e-mail cadastral. Ao salvar, o sistema atualiza os campos autorizados do seu próprio perfil.",
  },
  "profile.avatar": {
    title: "Escolha como a equipe reconhece você.",
    body: "Use um avatar do sistema ou uma imagem local. Revise a foto antes de salvar a alteração.",
  },
  "profile.status": {
    title: "Informe sua disponibilidade.",
    body: "Disponível indica que você está atendendo. Pausa e Desconectado representam afastamentos diferentes; escolha conforme sua rotina.",
  },
  "profile.quick-status": {
    title: "O status rápido aplica imediatamente.",
    body: "No menu rápido, a mudança é direta. No formulário de perfil, confira os dados antes de Salvar.",
  },
  "profile.status-help": {
    title: "Conheça o apoio de ausência.",
    body: "A ajuda explica disponibilidade, auto-resposta e proteção contra repetição. Esses comportamentos dependem das regras de atendimento da operação.",
  },
  "profile.group": {
    title: "Reconheça seu acesso.",
    body: "O grupo exibido informa seu contexto de permissão. Este treinamento não abre a administração de grupos.",
  },
  "profile.theme": {
    title: "Escolha uma leitura confortável.",
    body: "Claro, Escuro, Voice e Sistema mudam a aparência. Voice aqui é um tema visual.",
  },
  "profile.density": {
    title: "Ajuste o tamanho da interface.",
    body: "Auto e os níveis de densidade ajudam a acomodar a tela. Confira se textos, botões e foco continuam confortáveis para você.",
  },
  "profile.actions": {
    title: "Salve ou descarte com intenção.",
    body: "Salvar atualiza os campos autorizados. Cancelar fecha o formulário; Sair encerra sua sessão e não é necessário para concluir o treinamento.",
  },
  "profile.keyboard": {
    title: "Use as setas fora da digitação.",
    body: "Setas para cima e para baixo alternam módulos; esquerda e direita alternam abas registradas. Escape pode liberar o foco de um campo.",
  },
  "profile.mobile": {
    title: "No celular, procure Mais.",
    body: "Alguns módulos ficam no menu Mais. Dentro de uma conversa, volte à lista para recuperar a navegação inferior.",
  },
  "profile.notifications": {
    title: "Avisos do dispositivo são separados.",
    body: "Quando o navegador permitir, você pode ativar avisos pelo convite do sistema. A solicitação real só acontece se você escolher essa ação.",
  },
  "profile.replay": {
    title: "Reveja comigo quando precisar.",
    body: "Rever Treinamento com o {persona.name} abre o índice para reiniciar ou retomar. Seu progresso fica vinculado a esta empresa e a este usuário.",
  },
  "finish.review": {
    title: "Revise seu caminho de trabalho.",
    body: "Organize o dia, confira o contexto do cliente, registre o negócio e deixe o próximo passo. Você pode revisar qualquer capítulo disponível.",
  },
  "finish.complete": {
    title: "Conclua quando estiver pronto.",
    body: "Se terminou os capítulos disponíveis, confirme Concluir treinamento. Se precisar parar, use Pausar para continuar depois.",
  },
  "finish.return": {
    title: "Vamos ao trabalho.",
    body: "O treinamento foi encerrado. Seu ambiente operacional está pronto para você continuar, e eu sigo disponível no chat interno.",
  },
};

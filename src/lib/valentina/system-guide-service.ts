// ══════════════════════════════════════════════════════════════════════════════
// 🧭 SYSTEM GUIDE & ONBOARDING WIZARD KNOWLEDGE SERVICE (FAGNER / VALENTINA)
// Injeta de forma estratégica o conhecimento completo do Onboarding Wizard
// (8 capítulos, 237 steps) + Playbook prático de cliques e fluxos de tela
// para que o Fagner oriente operadores e gestores em qualquer ação no sistema.
// ══════════════════════════════════════════════════════════════════════════════

import {
  ONBOARDING_CHAPTER_COPY,
  ONBOARDING_STEP_COPY_PT_BR,
} from "../onboarding/copy.pt-BR";
import {
  ONBOARDING_CHAPTER_META,
  ONBOARDING_STEPS,
} from "../onboarding/manifest";
import type { OnboardingChapterId } from "../onboarding/types";

export interface SystemActionPlaybook {
  id: string;
  title: string;
  moduleLabel: string;
  routePath: string;
  chapterId: OnboardingChapterId | "admin";
  keywords: string[];
  whereToClick: string;
  stepByStep: string[];
  importantRules?: string[];
  relatedStepIds: string[];
}

export interface MatchedSystemGuideResult {
  isSystemHowTo: boolean;
  matchedPlaybooks: SystemActionPlaybook[];
  matchedWizardSteps: Array<{
    id: string;
    chapterId: OnboardingChapterId;
    chapterTitle: string;
    title: string;
    body: string;
    routePath: string;
  }>;
  promptContext: string;
}

function normalizeText(value: string): string {
  return (value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export const SYSTEM_ACTION_PLAYBOOKS: SystemActionPlaybook[] = [
  {
    id: "chat-transfer",
    title: "Como transferir um cliente / atendimento para outro operador ou setor",
    moduleLabel: "Atendimentos (Chat)",
    routePath: "/chat/meus",
    chapterId: "chat",
    keywords: [
      "transferir",
      "transferencia",
      "passar cliente",
      "passar atendimento",
      "passar conversa",
      "encaminhar cliente",
      "encaminhar conversa",
      "encaminhar atendimento",
      "outro operador",
      "outro vendedor",
      "outro consultor",
      "outro setor",
      "mudar operador",
      "trocar operador",
      "trocar responsavel",
    ],
    whereToClick:
      "Módulo Atendimentos (2º ícone na barra lateral esquerda) -> abra a conversa ativa -> no cabeçalho superior direito da conversa, clique no botão 'Transferir' (ícone de duas setas opostas ⇄, ao lado do botão Finalizar).",
    stepByStep: [
      "Se o atendimento ainda estiver na aba 'Fila', clique primeiro em 'Assumir' no topo direito (não é permitido transferir uma conversa que ainda não foi assumida).",
      "Com a conversa aberta na aba 'Meus', olhe para o cabeçalho superior direito da janela de mensagens e clique no botão 'Transferir' (ícone de setas ⇄).",
      "Na janela que abrir, escolha se deseja transferir para um 'Operador' específico (lista de consultores e status online/pausa) ou para a fila geral de um 'Setor'.",
      "Confira o campo 'Negociação vinculada': selecione qual negócio do CRM continuará sendo o assunto daquela conversa para que o colega receba todo o contexto.",
      "Clique em 'Confirmar Transferência'. O atendimento irá imediatamente para o colega/setor escolhido e uma linha de auditoria ficará gravada no histórico.",
    ],
    importantRules: [
      "Se você quiser transferir várias negociações de uma só vez no CRM, vá no módulo 'Negociações (CRM)', marque as caixas de seleção (checkboxes) dos cards desejados e clique em 'Transferir Responsável' na barra flutuante inferior.",
      "Para alterar o dono fixo da carteira do cliente, você também pode abrir a Ficha Lateral Direita do Chat -> aba Detalhes -> alterar a Carteira / Responsável.",
    ],
    relatedStepIds: [
      "chat.transfer",
      "chat.capture",
      "chat.deal-context",
      "crm.bulk-transfer",
      "contacts.wallet-transfer",
    ],
  },
  {
    id: "chat-capture-queue",
    title: "Como assumir / puxar um cliente da Fila de Espera",
    moduleLabel: "Atendimentos (Chat)",
    routePath: "/chat/fila",
    chapterId: "chat",
    keywords: [
      "assumir",
      "capturar",
      "puxar da fila",
      "pegar da fila",
      "pegar atendimento",
      "pegar cliente",
      "fila de espera",
      "atender fila",
      "caixa bloqueada",
      "nao consigo digitar",
    ],
    whereToClick:
      "Módulo Atendimentos -> aba 'Fila' no topo da coluna esquerda -> clique na conversa aguardando -> clique no botão 'Assumir' (no cabeçalho superior direito ou no banner inferior acima da caixa de digitação).",
    stepByStep: [
      "Na coluna esquerda de Atendimentos, clique na aba 'Fila' para listar os clientes que estão aguardando atendimento humano.",
      "Clique sobre a conversa desejada para ler o histórico e o contexto que o cliente enviou.",
      "Clique no botão 'Assumir' no canto superior direito da conversa (ou no aviso de conversa na fila na parte inferior).",
      "Pronto! A conversa passa imediatamente para a sua aba 'Meus' e a caixa de digitação é liberada para você responder.",
    ],
    importantRules: [
      "Enquanto a conversa está na aba 'Fila', o campo de digitação fica bloqueado propositalmente para impedir que dois operadores respondam ao mesmo cliente ao mesmo tempo.",
    ],
    relatedStepIds: ["chat.queue-waiting", "chat.capture", "chat.queue-mine"],
  },
  {
    id: "chat-finish-reopen",
    title: "Como finalizar ou reabrir um atendimento no Chat",
    moduleLabel: "Atendimentos (Chat)",
    routePath: "/chat/meus",
    chapterId: "chat",
    keywords: [
      "finalizar atendimento",
      "finalizar conversa",
      "encerrar atendimento",
      "encerrar conversa",
      "encerrar chat",
      "fechar conversa",
      "fechar atendimento",
      "reabrir conversa",
      "reabrir atendimento",
      "aba finalizados",
    ],
    whereToClick:
      "Módulo Atendimentos -> no cabeçalho superior direito da conversa ativa, clique no botão 'Finalizar' (ícone de check ✓). Para reabrir, vá na aba 'Finalizados', abra a conversa e clique em 'Reabrir'.",
    stepByStep: [
      "Com o atendimento aberto na aba 'Meus', clique no botão 'Finalizar' no canto superior direito do cabeçalho do chat.",
      "A conversa sairá da sua lista ativa ('Meus') e será arquivada na aba 'Finalizados'.",
      "Se precisar retomar o contato depois, clique na aba 'Finalizados' na coluna esquerda, selecione o cliente e clique em 'Reabrir' (ou envie uma nova mensagem).",
    ],
    importantRules: [
      "Finalizar o atendimento no Chat encerra apenas o ciclo da conversa, mas NÃO marca a Negociação no CRM como Ganha ou Perdida. O status comercial do negócio deve ser atualizado na ficha da negociação no CRM.",
    ],
    relatedStepIds: ["chat.finish", "chat.queue-finished", "chat.reopen"],
  },
  {
    id: "chat-deal-link",
    title: "Como vincular, trocar ou criar uma Negociação (Card do CRM) dentro do Chat",
    moduleLabel: "Atendimentos (Chat)",
    routePath: "/chat/meus",
    chapterId: "chat",
    keywords: [
      "vincular negociacao",
      "vincular card",
      "vincular negocio",
      "trocar negociacao",
      "criar negociacao no chat",
      "assunto do atendimento",
      "negociacoes vinculadas",
      "ficha lateral",
      "abrir negocio pelo chat",
    ],
    whereToClick:
      "No cabeçalho da conversa (faixa de contexto da negociação) OU na Ficha Lateral Direita do Chat -> aba 'Detalhes' -> seção 'Negociações Vinculadas'.",
    stepByStep: [
      "Com a conversa aberta, verifique a faixa logo abaixo do nome do cliente no topo (que mostra a negociação ativa) ou abra a Ficha Lateral Direita clicando no ícone de painel no canto superior direito.",
      "Na aba 'Detalhes' da lateral direita, localize o bloco 'Negociações Vinculadas'.",
      "Para vincular um card que já existe no CRM: digite o título da negociação na busca e clique em 'Vincular'.",
      "Para criar um negócio novo sem sair do chat: clique em '+ Nova Negociação', escolha o Funil, a Etapa e o Valor estimado e salve.",
      "Se o cliente tiver mais de uma negociação aberta (ex: Máquinas e Peças), clique em 'Definir como Atual / Trocar' para indicar sobre qual negócio vocês estão falando agora.",
    ],
    importantRules: [
      "A negociação definida como 'Atual' determina em qual card do CRM as notas internas, tarefas e evidências daquela conversa serão registradas.",
    ],
    relatedStepIds: [
      "chat.deal-context",
      "chat.drawer-toggle",
      "chat.linked-deals",
      "chat.linked-deal-new",
    ],
  },
  {
    id: "chat-internal-notes-quick-replies",
    title: "Como usar Notas Internas, Respostas Rápidas (/) e Templates no Chat",
    moduleLabel: "Atendimentos (Chat) & Minha Carteira",
    routePath: "/chat/meus",
    chapterId: "chat",
    keywords: [
      "nota interna",
      "comentario interno",
      "mensagem interna",
      "anotacao interna",
      "resposta rapida",
      "respostas rapidas",
      "atalho barra",
      "meus templates",
      "criar template",
      "modelo de mensagem",
    ],
    whereToClick:
      "Na barra inferior de ferramentas do Chat (compositor): botão 'Nota Interna' (deixa o fundo amarelo/âmbar) e botão 'Respostas Rápidas' (ícone de raio ⚡ ou digitando '/' no campo de texto).",
    stepByStep: [
      "Para enviar uma Nota Interna (visível só para a equipe): clique no botão 'Nota Interna' na barra inferior do chat. O campo de digitação ficará amarelo/âmbar. Escolha se a nota pertence à 'Negociação Atual' ou ao 'Contato Geral' e clique em Enviar. O cliente NÃO recebe essa mensagem.",
      "Para usar uma Resposta Rápida ou Template no chat: digite '/' (barra) no início da caixa de mensagem ou clique no ícone de raio (⚡) na barra inferior, pesquise pelo atalho/título e pressione Enter.",
      "Para criar seus próprios Templates Pessoais: acesse o módulo 'Minha Carteira' (6º ícone na barra lateral esquerda) -> clique na aba 'Meus Templates' -> clique em '+ Novo Template'.",
    ],
    relatedStepIds: [
      "chat.internal-note",
      "chat.note-scope",
      "chat.quick-entry",
      "chat.quick-Select",
      "wallet.templates",
      "wallet.template-new",
    ],
  },
  {
    id: "chat-meta-template-24h",
    title: "Como enviar Template Oficial da Meta quando a janela de 24h do WhatsApp fecha",
    moduleLabel: "Atendimentos (Chat)",
    routePath: "/chat/meus",
    chapterId: "chat",
    keywords: [
      "janela de 24",
      "24 horas",
      "24h",
      "template oficial",
      "template meta",
      "template whatsapp",
      "conversa bloqueada meta",
      "iniciar conversa whatsapp",
      "retomar contato 24h",
    ],
    whereToClick:
      "Na parte inferior da conversa (onde aparece o aviso da janela de 24h da API Oficial Meta), clique no botão 'Enviar Template Oficial'.",
    stepByStep: [
      "Quando o cliente passa mais de 24 horas sem enviar mensagem no canal WhatsApp Oficial (Meta Cloud API), a regra da Meta exige o envio de um Template aprovado para reabrir a conversa.",
      "Clique no botão 'Enviar Template Oficial' na barra inferior do chat.",
      "No modal que abrir, pesquise o modelo desejado pelo nome ou categoria.",
      "Preencha os campos variáveis ({{1}}, {{2}}, como nome do cliente ou equipamento) e confira como a mensagem ficará na coluna de 'Pré-visualização' à direita.",
      "Clique em 'Enviar Template'. Assim que o cliente responder, a janela livre de 24h reabre automaticamente para mensagens comuns e áudios.",
    ],
    relatedStepIds: [
      "chat.meta-window",
      "chat.meta-search",
      "chat.meta-vars",
      "chat.meta-preview",
      "chat.meta-send",
    ],
  },
  {
    id: "chat-catalog-inline-evidence",
    title: "Como usar o Catálogo de Produtos, Evidências de Mensagem e o Assistente Fagner Inline no Chat",
    moduleLabel: "Atendimentos (Chat)",
    routePath: "/chat/meus",
    chapterId: "chat",
    keywords: [
      "catalogo no chat",
      "enviar produto",
      "evidencia no chat",
      "marcar como evidencia",
      "assistente inline",
      "fagner no chat",
      "sugestao de resposta",
      "resumo da conversa",
      "contorno de objecao",
    ],
    whereToClick:
      "Na barra inferior do compositor do Chat: ícone de Sacola/Catálogo para produtos, ícone de Brilho (✨) para o Assistente Fagner Inline, e ícone de Bandeira/Marcador (Bookmark) ao passar o mouse sobre qualquer mensagem do cliente para salvar como Evidência.",
    stepByStep: [
      "Catálogo no Chat: clique no ícone de Catálogo na barra inferior do chat para pesquisar máquinas por nome/código/divisão, ver preço e especificações e inserir os dados na conversa.",
      "Marcar Mensagem como Evidência: passe o mouse em cima de uma mensagem importante do cliente e clique no ícone de Marcador (Bookmark) que surge ao lado de Responder/Reagir. A mensagem ficará salva nas Evidências da Negociação.",
      "Assistente Fagner Inline: clique no ícone de IA (✨) na barra inferior da conversa com o cliente para gerar Sugestão de Resposta, Resumo da Conversa, Análise BANT, Recomendação de Máquina ou Contorno de Objeções, clicando em 'Inserir no Chat' para usar o texto.",
    ],
    relatedStepIds: [
      "chat.catalog",
      "chat.catalog-search",
      "chat.catalog-detail",
      "chat.message-evidence",
      "chat.inline-entry",
      "chat.inline-actions",
      "chat.inline-insert",
    ],
  },
  {
    id: "customer-site-journey",
    title: "Como ver a Jornada do Cliente no Site (Páginas visitadas, Tempo, Scroll e Cliques)",
    moduleLabel: "Atendimentos, Base de Clientes & Monitorar",
    routePath: "/clientes/site",
    chapterId: "contacts",
    keywords: [
      "jornada do cliente",
      "jornada no site",
      "paginas visitadas",
      "visitantes do site",
      "cliques no site",
      "tempo na pagina",
      "scroll",
      "navegacao no site",
      "o que o cliente viu no site",
    ],
    whereToClick:
      "1) No Chat: abra a Ficha Lateral Direita -> bloco 'Jornada no Site' -> 'Ver Jornada Completa'. 2) Na Base de Clientes (/clientes): filtre pelo canal 'Site' ou clique no botão 'Jornada' do cliente. 3) Em Monitorar (/monitor): aba 'Visitantes do Site'.",
    stepByStep: [
      "Durante um atendimento no Chat, abra a Ficha Lateral Direita (aba Detalhes) e clique em 'Ver Jornada Completa' no card de navegação do site.",
      "Na janela 'Jornada do Cliente', confira no topo os 5 indicadores: Páginas visitadas, Chats iniciados, Engajamento, Intenção e Tempo total.",
      "Alterne entre as 3 abas: 'Cliente' (dados e origem UTM), 'Navegação' (lista de URLs visitadas com tempo exato de permanência e % de rolagem/scroll) e 'Jornada' (linha do tempo cronológica de cada clique em botões de orçamento, máquinas e WhatsApp).",
    ],
    relatedStepIds: [
      "chat.journey-open",
      "chat.journey-tabs",
      "contacts.journey",
      "contacts.channel-site",
    ],
  },
  {
    id: "home-directives-evidence",
    title: "Como concluir Diretrizes do Gestor e anexar Evidência (Ligação ou WhatsApp) no Início",
    moduleLabel: "Início Comercial",
    routePath: "/inicio",
    chapterId: "home",
    keywords: [
      "diretriz",
      "diretrizes",
      "responsabilidade do dia",
      "responsabilidades",
      "concluir diretriz",
      "anexar evidencia",
      "evidencia de ligacao",
      "evidencia de whatsapp",
      "audio da ligacao",
      "print do whatsapp",
      "inicio comercial",
    ],
    whereToClick:
      "Módulo Início (1º ícone na barra lateral esquerda, /inicio) -> seção 'Diretrizes do Gestor / Responsabilidades' -> clique no botão 'Concluir' da diretriz.",
    stepByStep: [
      "Acesse o módulo 'Início' no topo da barra lateral esquerda e localize suas 'Diretrizes do Gestor' pendentes.",
      "Antes de concluir, você pode clicar em 'Ver Negócio' para abrir a ficha do CRM ou 'Abrir Chat' para falar com o cliente.",
      "Para dar baixa, clique no botão 'Concluir' na diretriz desejada.",
      "Passo 1 (Evidência): Escolha o canal utilizado — 'Ligação' (faça upload do arquivo de áudio da chamada) ou 'WhatsApp' (selecione a conversa vinculada ou envie o print da interação) — e clique em 'Avançar'.",
      "Passo 2 (Desfecho Comercial): Selecione se a negociação 'Continua em Andamento', foi 'Ganha' ou foi 'Perdida' (informando o motivo de perda), preencha a Nota de Resumo obrigatória (mínimo de 5 caracteres) e confirme.",
    ],
    relatedStepIds: [
      "home.directives",
      "home.directive-card",
      "home.evidence-call",
      "home.evidence-whatsapp",
      "home.evidence-advance",
      "home.outcome-progress",
      "home.outcome-won",
      "home.outcome-lost",
      "home.outcome-note",
    ],
  },
  {
    id: "crm-deals-management",
    title: "Como usar o CRM (Criar Negociação, Filtrar Esfriamento, Mover Etapas, Ganho/Perda e Ações em Lote)",
    moduleLabel: "Negociações (CRM)",
    routePath: "/crm",
    chapterId: "crm",
    keywords: [
      "criar negociacao",
      "novo negocio",
      "mover etapa",
      "mudar etapa",
      "mudar funil",
      "trocar funil",
      "marcar como ganho",
      "marcar como perdido",
      "motivo de perda",
      "esfriando",
      "parados",
      "criticos",
      "sem tarefa",
      "acoes em lote",
      "transferir em massa",
      "prioridade ia",
      "exportar crm",
    ],
    whereToClick:
      "Módulo Negociações / CRM (3º ícone na barra lateral esquerda, /crm).",
    stepByStep: [
      "Trocar de Funil e Visão: no topo esquerdo, selecione o Funil (ex: Máquinas, Peças, Assistência Técnica, Personnalité) e alterne entre 'Kanban' (colunas), 'Lista' ou 'Prioridade IA'.",
      "Filtros de Temperatura e Atenção: use os chips rápidos no topo ('Sem Tarefa', 'Esfriando 3d+', 'Parados 7d+', 'Críticos 15d+') ou clique em 'Filtros' para refinar por valor, etiqueta, responsável ou período.",
      "Criar Nova Negociação: clique no botão '+ Nova Negociação' no canto superior direito, informe título, funil, etapa, valor, contato e empresa.",
      "Mover Etapa ou Marcar Ganho/Perdido: arraste o card entre as colunas do Kanban ou clique sobre o card para abrir a Ficha da Negociação (onde você pode mudar a etapa na barra superior ou clicar nos botões 'Ganho' e 'Perdido' no topo direito).",
      "Ações em Lote (Massa): marque a caixinha (checkbox) em um ou mais cards (ou no topo da coluna) para abrir a barra flutuante inferior, permitindo Transferir Responsável em lote, Alterar Etapa/Status, Criar Tarefas em Massa ou Exportar.",
    ],
    relatedStepIds: [
      "crm.pipeline",
      "crm.view-modes",
      "crm.attention-chips",
      "crm.new-deal",
      "crm.move",
      "crm.bulk-bar",
      "crm.bulk-transfer",
      "crm.deal-status",
    ],
  },
  {
    id: "tasks-schedule",
    title: "Como criar e gerenciar Tarefas e Compromissos (Agenda Mês, Semana, Dia e Lista)",
    moduleLabel: "Tarefas",
    routePath: "/tarefas",
    chapterId: "tasks",
    keywords: [
      "criar tarefa",
      "nova tarefa",
      "agendar ligacao",
      "agendar reuniao",
      "agendar follow-up",
      "minhas tarefas",
      "tarefas atrasadas",
      "calendario de tarefas",
      "concluir tarefa",
    ],
    whereToClick:
      "Módulo Tarefas (4º ícone na barra lateral esquerda, /tarefas) -> botão '+ Nova Tarefa' no canto superior direito (ou dentro da aba 'Tarefas' na ficha de qualquer negociação).",
    stepByStep: [
      "No módulo Tarefas, escolha no topo a visualização desejada: 'Mês', 'Semana', 'Dia' ou 'Todas (Lista)'.",
      "Use os filtros de status ('Atrasadas', 'Hoje', 'Pendentes', 'Concluídas') e de tipo ('Ligação', 'Reunião', 'Follow-up', 'Proposta', 'Visita').",
      "Para agendar: clique em '+ Nova Tarefa', escolha o tipo de atividade, defina data/hora, selecione a Negociação vinculada (a empresa já é associada automaticamente pela negociação) e salve.",
      "Para concluir uma tarefa: clique no ícone de check ao lado da tarefa na lista ou dentro do detalhe do card.",
    ],
    relatedStepIds: [
      "tasks.views",
      "tasks.status-filters",
      "tasks.new",
      "tasks.modal-deal",
      "tasks.complete",
    ],
  },
  {
    id: "contacts-accounts-cnpj",
    title: "Como cadastrar Contatos e Empresas (com busca automática de CNPJ na Receita)",
    moduleLabel: "Base de Clientes",
    routePath: "/clientes/contatos",
    chapterId: "contacts",
    keywords: [
      "cadastrar cliente",
      "novo contato",
      "criar contato",
      "cadastrar empresa",
      "nova empresa",
      "consultar cnpj",
      "busca cnpj",
      "receita federal",
      "base de clientes",
      "duplicidade de telefone",
    ],
    whereToClick:
      "Módulo Base de Clientes (5º ícone na barra lateral esquerda, /clientes) -> alterne no topo entre as abas 'Contatos' e 'Empresas'.",
    stepByStep: [
      "Cadastrar Novo Contato: na aba 'Contatos', clique em '+ Novo Contato' no topo direito, informe Nome, Telefone/WhatsApp, E-mail e selecione a Negociação vinculada (ou crie uma na hora). Se o número já estiver cadastrado, o sistema avisa automaticamente para evitar duplicidade.",
      "Cadastrar Nova Empresa com CNPJ automático: mude para a aba 'Empresas' no topo, clique em '+ Nova Empresa', selecione 'Pessoa Jurídica (PJ)', digite o CNPJ e clique no botão da Lupa ao lado do campo. O sistema preenche automaticamente Razão Social, Nome Fantasia, CNAE, Porte e Endereço.",
    ],
    relatedStepIds: [
      "contacts.subtabs",
      "contacts.new",
      "contacts.duplicate-guard",
      "contacts.account-new",
      "contacts.account-cnpj-lookup",
    ],
  },
  {
    id: "wallet-inactivity-templates",
    title: "Como gerenciar Minha Carteira e acompanhar o Alerta de Inatividade (50/60 dias)",
    moduleLabel: "Minha Carteira",
    routePath: "/carteira/clientes",
    chapterId: "wallet",
    keywords: [
      "minha carteira",
      "perder carteira",
      "inatividade",
      "50 dias",
      "60 dias",
      "risco de perda",
      "clientes inativos",
      "retomar cliente da carteira",
    ],
    whereToClick:
      "Módulo Minha Carteira (6º ícone na barra lateral esquerda, /carteira).",
    stepByStep: [
      "Acesse 'Minha Carteira' na barra lateral esquerda para ver todos os clientes sob sua titularidade e os KPIs de saúde da carteira.",
      "Fique atento à coluna de dias sem interação: clientes com mais de 50 dias sem contato entram em alerta de atenção, pois ao atingir 60 dias de inatividade podem ser liberados da carteira exclusiva.",
      "Clique no botão de ação rápida 'Chamar no Chat' na linha do cliente para abrir a conversa e registrar novo contato imediatamente.",
    ],
    relatedStepIds: [
      "wallet.kpis",
      "wallet.inactivity-rule",
      "wallet.open-chat",
      "wallet.templates",
    ],
  },
  {
    id: "profile-status-theme-wizard",
    title: "Como mudar Status (Disponível / Pausa / Desconectado), Tema, Senha e rever o Tour Guiado (Wizard)",
    moduleLabel: "Perfil & Preferências (Rodapé da Barra Lateral)",
    routePath: "/inicio",
    chapterId: "profile",
    keywords: [
      "mudar status",
      "ficar disponivel",
      "entrar em pausa",
      "pausa",
      "desconectado",
      "trocar senha",
      "mudar senha",
      "alterar senha",
      "mudar tema",
      "modo escuro",
      "modo claro",
      "foto de perfil",
      "avatar",
      "wizard",
      "tour guiado",
      "treinamento",
      "onboarding",
      "atalhos de teclado",
    ],
    whereToClick:
      "No rodapé inferior esquerdo da barra lateral (Sidebar), clique sobre o seu Avatar / Foto de Perfil.",
    stepByStep: [
      "Status Operacional: no menu do seu perfil (rodapé esquerdo), escolha entre 'Disponível' (apto a receber atendimentos), 'Em Pausa' ou 'Desconectado'.",
      "Tema e Densidade Visual: no mesmo menu ou modal de perfil, alterne entre os temas Claro, Escuro, Voice ou Sistema.",
      "Alterar Nome, Avatar ou Senha: clique em 'Meu Perfil / Editar Perfil', atualize sua foto/nome ou preencha o campo 'Nova Senha' e clique em Salvar.",
      "Rever o Treinamento Guiado (Wizard): dentro do modal de Perfil, clique no botão 'Iniciar / Rever Tour Guiado' para abrir o passo a passo interativo na tela quando quiser.",
    ],
    relatedStepIds: [
      "profile.entry",
      "profile.status",
      "profile.theme",
      "profile.modal-password",
      "profile.rerun-tour",
    ],
  },
  {
    id: "admin-management-modules",
    title: "Guia dos Módulos da Diretoria e Administração (Gestão Comercial, War Room BI, Fagner Admin, Monitorar, Estatísticas, Grupos de Acesso e Ajustes)",
    moduleLabel: "Módulos de Gestão & Diretoria (Parte Inferior da Sidebar)",
    routePath: "/gestao-comercial",
    chapterId: "admin",
    keywords: [
      "gestao comercial",
      "publicar diretriz",
      "war room",
      "bi comercial",
      "fagner admin",
      "base de conhecimento",
      "subir manual",
      "configurar vtex",
      "monitorar",
      "estatisticas",
      "custos de ia",
      "custos whatsapp",
      "grupos de acesso",
      "criar operador",
      "criar usuario",
      "pastas de setores",
      "permissoes",
      "conexao whatsapp",
      "parear whatsapp",
    ],
    whereToClick:
      "Parte inferior da barra lateral esquerda (módulos exclusivos de Gestão/Diretoria conforme permissões do Grupo de Acesso).",
    stepByStep: [
      "Gestão Comercial (/gestao-comercial): crie e envie Diretrizes para os operadores, audite as evidências de ligação/WhatsApp enviadas e acompanhe as carteiras individuais.",
      "War Room BI (/bi-comercial): analise receita ganha, pipeline aberto, conversão por etapa, ranking de vendedores e motivos de perda.",
      "Fagner Admin (/valentina): acesse o Chat Executivo com múltiplos tópicos/pastas, Relatórios IA, Auditoria QA, Base de Conhecimento (upload de manuais PDF), Configuração SDR e a aba 'Loja VTEX' (configuração da conta tecfag, política de canais e simulador de SKU/frete).",
      "Monitorar (/monitor) & Estatísticas (/analytics): acompanhe filas e Visitantes do Site em tempo real em Monitorar; em Estatísticas -> aba 'Custos', use o botão do WhatsApp no topo direito para alternar entre Custos de IA (Vertex AI) e Custos da API Oficial WhatsApp Meta.",
      "Grupos de Acesso (/grupos): gerencie Operadores & Usuários (com busca, filtro por pastas de setores, edição completa de usuário, troca direta de grupo no card e redefinição de senha), Permissões por Grupo, Setores e Carteiras Globais.",
      "Ajustes (/configuracoes): gerencie as Conexões WhatsApp (Meta Oficial e QR Code Baileys), Etiquetas globais, Respostas Rápidas do sistema e Conector MCP.",
    ],
    relatedStepIds: [],
  },
];

const HOW_TO_INTENT_REGEX =
  /\b(como\s+(eu\s+)?(posso|faco|faço|consigo|devo|funciona|usar|uso|abrir|abro|clicar|clico|transferir|transfiro|assumir|assumo|finalizar|finalizo|encerrar|encerro|vincular|vinculo|criar|crio|cadastrar|cadastro|enviar|envio|marcar|marco|concluir|concluo|filtrar|filtro|mover|movo|alterar|altero|mudar|mudo|trocar|troco|ativar|ativo|configurar|configuro|achar|acho|encontrar|encontro|ver|vejo|acessar|acesso)|onde\s+(fica|esta|estao|clico|clicar|abro|abrir|acho|encontro|vejo|altero|mudo|transfiro|crio|cadastro|envio)|passo\s+a\s+passo|me\s+(ensina|explica|ajuda|orienta|mostra)\s+(a|como|onde)|qual\s+(o\s+)?(caminho|botao|botão|menu|aba|lugar)\s+para|para\s+que\s+serve|o\s+que\s+faz\s+o\s+botao|wizzard|wizard|onboarding|tour\s+guiado|treinamento\s+guiado|guia\s+do\s+sistema)\b/i;

const SYSTEM_UI_FEATURE_REGEX =
  /\b(transferir\s+(um\s+)?(cliente|atendimento|conversa|chat|card|negocio|negociacao)|assumir\s+(um\s+)?(atendimento|cliente|chat|da\s+fila)|puxar\s+da\s+fila|finalizar\s+(atendimento|conversa|chat)|reabrir\s+(atendimento|conversa|chat)|nota\s+interna|resposta\s+rapida|respostas\s+rapidas|template\s+(da\s+meta|oficial|whatsapp)|janela\s+de\s+24\s*h|vincular\s+(negociacao|negocio|card)|diretriz(es)?\s+do\s+gestor|concluir\s+diretriz|anexar\s+evidencia|evidencia\s+de\s+(ligacao|whatsapp|negocio)|jornada\s+(do\s+cliente|no\s+site)|acoes\s+em\s+lote|transferir\s+em\s+(lote|massa)|prioridade\s+ia|consulta(r)?\s+cnpj|alerta\s+de\s+inatividade|perder\s+carteira|mudar\s+status|entrar\s+em\s+pausa|trocar\s+senha|grupos\s+de\s+acesso|pastas\s+de\s+setores)\b/i;

const OPERATIONAL_DATA_OR_MACHINE_EXCLUSION_REGEX =
  /\b(quais\s+(?:os\s+|as\s+)?clientes?\b|quem\s+esta\s+(?:aguardando|esperando|na\s+fila)|clientes?\s+(?:estao\s+|que\s+estao\s+)?(?:aguardando|esperando|sem\s+resposta)|aguardando\s+minha\s+resposta|(?:pode\s+|consegue\s+)?(?:avaliar|avalia|analisar|analisa|auditar|audita)\s+(?:a\s+)?(?:minha\s+conversa|meu\s+atendimento|conversa\s+com|chat\s+com|atendimento\s+com)|pratic\s*seal|vsf[-_\s]?\d*|pamq[a-z0-9]+|quero\s+a\s+seladora|manda\s+uma\s+foto\s+dela|foto\s+d[aeo]\s+maquina)\b/i;

/**
 * Detecta se a pergunta do operador ou gestor pede ajuda/orientação sobre como executar
 * alguma ação no sistema, onde clicar ou como funciona algum módulo/botão da plataforma.
 */
export function isSystemHowToOrWizardQuery(
  query: string,
  _recentContext = ""
): boolean {
  const raw = `${query || ""}`.trim();
  if (!raw) return false;
  const norm = normalizeText(raw);

  // Nunca sequestrar consultas operacionais de fila real, avaliação de conversa com cliente ou busca de máquinas
  if (OPERATIONAL_DATA_OR_MACHINE_EXCLUSION_REGEX.test(norm) && !/\b(como\s+(?:eu\s+)?(?:faco|posso|devo|clico)|onde\s+(?:fica|clico|esta)|passo\s+a\s+passo)\b/i.test(norm)) {
    return false;
  }

  if (HOW_TO_INTENT_REGEX.test(raw) && SYSTEM_UI_FEATURE_REGEX.test( norm )) {
    return true;
  }
  if (HOW_TO_INTENT_REGEX.test(norm)) {
    for (const pb of SYSTEM_ACTION_PLAYBOOKS) {
      if (pb.keywords.some((kw) => norm.includes(normalizeText(kw)))) {
        return true;
      }
    }
  }
  // Só ativa por SYSTEM_UI_FEATURE_REGEX isolado se houver verbo/intenção de dúvida de uso na própria pergunta
  if (
    SYSTEM_UI_FEATURE_REGEX.test(norm) &&
    /\b(como|onde|qual\s+botao|qual\s+caminho|passo\s+a\s+passo|ajuda|ensina|explica|orienta|para\s+outro\s+(?:vendedor|operador|setor))\b/i.test(norm)
  ) {
    return true;
  }
  return false;
}

const GUIDE_STOPWORDS = new Set([
  "como",
  "onde",
  "qual",
  "quais",
  "para",
  "pelo",
  "pela",
  "com",
  "sem",
  "meu",
  "minha",
  "meus",
  "minhas",
  "cliente",
  "clientes",
  "conversa",
  "conversas",
  "atendimento",
  "atendimentos",
  "resposta",
  "respostas",
  "agora",
  "hoje",
  "pode",
  "fagner",
  "sistema",
  "painel",
  "tela",
  "aba",
]);

/**
 * Busca os Playbooks de ação e os Steps exatos do Onboarding Wizard (237 steps)
 * mais relevantes para a dúvida do operador ou gestor.
 */
export function resolveSystemGuideForQuery(
  query: string,
  recentContext = ""
): MatchedSystemGuideResult {
  const isHowTo = isSystemHowToOrWizardQuery(query, recentContext);
  if (!isHowTo) {
    return {
      isSystemHowTo: false,
      matchedPlaybooks: [],
      matchedWizardSteps: [],
      promptContext: "",
    };
  }

  const queryNorm = normalizeText(query || "");
  const queryTokens = queryNorm
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 4 && !GUIDE_STOPWORDS.has(t));

  // 1. Pontuar Playbooks de Ação estritamente contra a pergunta atual (queryNorm)
  const scoredPlaybooks = SYSTEM_ACTION_PLAYBOOKS.map((playbook) => {
    let score = 0;
    for (const kw of playbook.keywords) {
      const kwNorm = normalizeText(kw);
      if (!kwNorm) continue;
      if (queryNorm.includes(kwNorm)) {
        score += 120 + kwNorm.length * 2;
      }
    }
    const titleNorm = normalizeText(playbook.title);
    for (const token of queryTokens) {
      if (titleNorm.includes(token)) score += 25;
    }
    return { playbook, score };
  })
    .filter((item) => item.score >= 50)
    .sort((a, b) => b.score - a.score);

  const matchedPlaybooks = scoredPlaybooks.slice(0, 3).map((s) => s.playbook);

  // 2. Pontuar os 237 Steps do Onboarding Wizard
  const relatedIdsSet = new Set<string>();
  for (const pb of matchedPlaybooks) {
    for (const sid of pb.relatedStepIds) relatedIdsSet.add(sid);
  }

  const scoredSteps = ONBOARDING_STEPS.map((stepMeta) => {
    const copy = ONBOARDING_STEP_COPY_PT_BR[stepMeta.id];
    if (!copy) return null;
    const chapterCopy = ONBOARDING_CHAPTER_COPY[stepMeta.chapterId];
    const titleNorm = normalizeText(copy.title);
    const bodyNorm = normalizeText(copy.body);

    let score = 0;
    if (relatedIdsSet.has(stepMeta.id)) {
      score += 200;
    }
    for (const token of queryTokens) {
      if (titleNorm.includes(token)) score += 35;
      if (bodyNorm.includes(token)) score += 15;
    }
    return {
      id: stepMeta.id,
      chapterId: stepMeta.chapterId,
      chapterTitle: chapterCopy?.title || stepMeta.chapterId,
      title: copy.title,
      body: copy.body,
      routePath: stepMeta.routePath,
      score,
    };
  })
    .filter((item): item is NonNullable<typeof item> => Boolean(item && item.score >= 50))
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);

  const lines: string[] = [
    "══════════════════════════════════════════════════════════════════════════════",
    "🧭 GUIA OFICIAL DE NAVEGAÇÃO DO SISTEMA & ONBOARDING WIZARD (PASSO A PASSO DE TELA)",
    "══════════════════════════════════════════════════════════════════════════════",
    "ATENÇÃO: O usuário está perguntando como realizar uma ação no sistema, onde clicar ou como funciona um módulo da plataforma.",
    "Você conhece 100% da interface do sistema (todos os 8 capítulos e 237 passos do Fagner Onboarding Wizard). Explique de forma prática, clara e direta ONDE CLICAR (módulo na barra lateral, aba, posição do botão na tela) e o PASSO A PASSO exato:",
    "",
  ];

  if (matchedPlaybooks.length > 0) {
    lines.push("📌 PASSO A PASSO EXATO NA INTERFACE PARA ESTA SOLICITAÇÃO:");
    for (const pb of matchedPlaybooks) {
      lines.push(`\n▸ ${pb.title.toUpperCase()} (${pb.moduleLabel} — rota ${pb.routePath})`);
      lines.push(`  • Onde clicar: ${pb.whereToClick}`);
      lines.push(`  • Passo a passo:`);
      pb.stepByStep.forEach((st, idx) => {
        lines.push(`    ${idx + 1}. ${st}`);
      });
      if (pb.importantRules && pb.importantRules.length > 0) {
        lines.push(`  • Dicas e regras importantes:`);
        pb.importantRules.forEach((rule) => {
          lines.push(`    - ${rule}`);
        });
      }
    }
    lines.push("");
  }

  if (scoredSteps.length > 0) {
    lines.push("📘 PASSOS OFICIAIS DO ONBOARDING WIZARD RELACIONADOS:");
    for (const st of scoredSteps) {
      lines.push(
        `  • [${st.chapterTitle} -> ${st.title} (${st.routePath})]: ${st.body}`
      );
    }
    lines.push("");
  }

  lines.push("🗺️ MAPA RÁPIDO DOS MÓDULOS DA BARRA LATERAL ESQUERDA (SIDEBAR):");
  for (const chMeta of ONBOARDING_CHAPTER_META) {
    const chCopy = ONBOARDING_CHAPTER_COPY[chMeta.id];
    if (!chCopy) continue;
    lines.push(`  • ${chCopy.title}: ${chCopy.summary}`);
  }
  lines.push("");

  const promptContext = lines.join("\n");

  return {
    isSystemHowTo: true,
    matchedPlaybooks,
    matchedWizardSteps: scoredSteps.map(({ score: _score, ...rest }) => rest),
    promptContext,
  };
}

/**
 * Resumo compacto permanente para o prompt base do Fagner (Operador e Diretoria),
 * garantindo que ele sempre saiba orientar cliques na tela mesmo em perguntas mistas.
 */
export function getCompactSystemNavigationCheatSheet(): string {
  return [
    "🧭 DOMÍNIO COMPLETO DA INTERFACE DO SISTEMA (ONBOARDING WIZARD):",
    "- Você domina 100% das telas, botões e fluxos do sistema e pode ensinar qualquer operador ou gestor onde clicar:",
    "  1. Início (/inicio): KPIs da carteira e 'Diretrizes do Gestor' -> botão 'Concluir' exige Passo 1 (Evidência: áudio de Ligação ou conversa/print de WhatsApp) e Passo 2 (Desfecho: Continua em Andamento, Ganha ou Perdida + Nota obrigatória).",
    "  2. Atendimentos / Chat (/chat): abas 'Fila', 'Meus', 'Automação', 'Finalizados' e 'Todos' + filtros de canal (WhatsApp, Instagram, Messenger, Site). Para atender da Fila: clicar em 'Assumir' no topo direito. Para passar o cliente a outro vendedor ou setor: clicar no botão 'Transferir' (ícone ⇄ no cabeçalho superior direito da conversa, ao lado de 'Finalizar'). Na barra inferior do chat ficam: 'Nota Interna' (caixa amarela invisível ao cliente), 'Respostas Rápidas' (atalho '/' ou ícone ⚡), 'Catálogo de Produtos', 'Template Oficial Meta' (quando janela 24h fecha) e 'Assistente Fagner Inline' (✨). Na Ficha Lateral Direita ficam as 'Negociações Vinculadas' (trocar/criar negócio) e 'Jornada no Site'.",
    "  3. Negociações / CRM (/crm): seletor de Funil no topo esquerdo, visões Kanban/Lista/Prioridade IA, chips de temperatura ('Sem Tarefa', 'Esfriando 3d+', 'Parados 7d+', 'Críticos 15d+'), botão '+ Nova Negociação', e seleção em massa nos checkboxes dos cards para 'Transferir Responsável em Lote', mudar etapa ou criar tarefas.",
    "  4. Tarefas (/tarefas): calendário Mês/Semana/Dia/Todas, filtros de atrasadas/hoje e botão '+ Nova Tarefa' vinculada à negociação.",
    "  5. Base de Clientes (/clientes): abas 'Contatos' e 'Empresas' (cadastro PJ com botão de Lupa no CNPJ que busca dados na Receita Federal automaticamente) e botão 'Jornada' (mostra páginas visitadas no site, tempo, scroll e cliques).",
    "  6. Minha Carteira (/carteira): gestão de clientes próprios (alerta amarelo aos 50 dias sem contato e perda de exclusividade aos 60 dias) e aba 'Meus Templates' para criar respostas pessoais.",
    "  7. Perfil e Status (Avatar no rodapé inferior esquerdo da barra lateral): alternar status ('Disponível', 'Em Pausa', 'Desconectado'), trocar Tema (Claro/Escuro/Voice), alterar Senha e botão 'Rever Tour Guiado (Wizard)'.",
  ].join("\n");
}

import React, { useState, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Search, X, MessageSquare, Check, Sparkles, Send, HelpCircle, ArrowLeft } from "lucide-react";
import { TemplateBindings } from "@/lib/whatsapp/meta-template-common";

export interface ApprovedMetaTemplate {
  id: string;
  name: string;
  language: string;
  category: string;
  bodyText: string;
  variableCount: number;
  supported: boolean;
  bindings: TemplateBindings;
  components?: Array<{
    type?: string;
    format?: string;
    text?: string;
    buttons?: Array<{ type?: string; text?: string; url?: string; phone_number?: string }>;
  }>;
}

interface MetaTemplateSelectModalProps {
  isOpen: boolean;
  onClose: () => void;
  templates: ApprovedMetaTemplate[];
  customerName?: string;
  operatorName?: string;
  onSend: (template: ApprovedMetaTemplate, parameters: string[]) => Promise<boolean>;
  loading?: boolean;
}

export function MetaTemplateSelectModal({
  isOpen,
  onClose,
  templates,
  customerName = "Cliente",
  operatorName = "Atendente",
  onSend,
  loading = false,
}: MetaTemplateSelectModalProps) {
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("ALL");
  const [selectedTemplate, setSelectedTemplate] = useState<ApprovedMetaTemplate | null>(null);
  const [parameters, setParameters] = useState<string[]>([]);
  const [sending, setSending] = useState(false);

  // Categorias únicas dos templates disponíveis
  const categories = useMemo(() => {
    const cats = new Set<string>();
    templates.forEach((t) => {
      if (t.category) cats.add(t.category.toUpperCase());
    });
    return Array.from(cats);
  }, [templates]);

  // Filtragem de templates
  const filteredTemplates = useMemo(() => {
    return templates.filter((t) => {
      if (!t.supported) return false;
      const matchesSearch =
        t.name.toLowerCase().includes(search.toLowerCase()) ||
        t.bodyText.toLowerCase().includes(search.toLowerCase());
      const matchesCat =
        selectedCategory === "ALL" ||
        t.category?.toUpperCase() === selectedCategory;
      return matchesSearch && matchesCat;
    });
  }, [templates, search, selectedCategory]);

  const handleSelect = (template: ApprovedMetaTemplate) => {
    setSelectedTemplate(template);
    // Inicializar parâmetros de variáveis
    const initialParams = Array.from({ length: template.variableCount }, (_, idx) => {
      const binding = template.bindings?.[String(idx + 1)];
      if (binding === "customer_name") return customerName;
      if (binding === "operator_name") return operatorName;
      return "";
    });
    setParameters(initialParams);
  };

  const handleBack = () => {
    setSelectedTemplate(null);
    setParameters([]);
  };

  const handleConfirmSend = async () => {
    if (!selectedTemplate) return;
    if (parameters.length !== selectedTemplate.variableCount || parameters.some((p) => !p.trim())) {
      return;
    }
    setSending(true);
    try {
      const success = await onSend(selectedTemplate, parameters);
      if (success) {
        onClose();
        handleBack();
      }
    } finally {
      setSending(false);
    }
  };

  // Texto preview interpolado
  const previewText = useMemo(() => {
    if (!selectedTemplate) return "";
    return selectedTemplate.bodyText.replace(/\{\{(\d+)\}\}/g, (_, num) => {
      const idx = Number(num) - 1;
      const val = parameters[idx]?.trim();
      if (val) return val;
      const binding = selectedTemplate.bindings?.[num];
      if (binding === "customer_name") return `@${customerName}`;
      if (binding === "operator_name") return `@${operatorName}`;
      return `{{${num}}}`;
    });
  }, [selectedTemplate, parameters, customerName, operatorName]);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) { onClose(); handleBack(); } }}>
      <DialogContent className="max-w-3xl p-0 overflow-hidden bg-card border-border shadow-2xl rounded-2xl flex flex-col max-h-[85vh]">
        {/* Header no estilo RD Conversas */}
        <div className="px-6 py-4 border-b border-border flex items-center justify-between bg-muted/20">
          <div className="flex items-center gap-3">
            {selectedTemplate && (
              <button
                type="button"
                onClick={handleBack}
                className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                title="Voltar à lista"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
            )}
            <div>
              <DialogTitle className="text-base font-bold text-foreground">
                {selectedTemplate ? `Configurar: ${selectedTemplate.name}` : "Buscar mensagem template"}
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                {selectedTemplate
                  ? "Confira os dados e preencha as variáveis antes de enviar pelo WhatsApp."
                  : "Selecione um template oficial aprovado pela Meta para retomar o contato."}
              </DialogDescription>
            </div>
          </div>
        </div>

        {!selectedTemplate ? (
          /* ── LISTAGEM DE TEMPLATES (Estilo RD Conversas) ── */
          <div className="flex flex-col flex-1 overflow-hidden p-6 space-y-4">
            {/* Barra de Busca com Ícone de Lupa */}
            <div className="relative">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Pesquisar..."
                className="pl-10 h-10 rounded-xl bg-background border-border/80 text-sm focus-visible:ring-primary/20"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            {/* Categorias / Badges */}
            {categories.length > 0 && (
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
                <button
                  type="button"
                  onClick={() => setSelectedCategory("ALL")}
                  className={`px-3 py-1.5 rounded-lg font-semibold transition-colors cursor-pointer ${
                    selectedCategory === "ALL"
                      ? "bg-primary text-primary-foreground shadow-xs"
                      : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  TODOS
                </button>
                {categories.map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setSelectedCategory(cat)}
                    className={`px-3 py-1.5 rounded-lg font-semibold transition-colors cursor-pointer ${
                      selectedCategory === cat
                        ? "bg-primary text-primary-foreground shadow-xs"
                        : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground"
                    }`}
                  >
                    {cat === "UTILITY" ? "UTILIDADE" : cat}
                  </button>
                ))}
              </div>
            )}

            {/* Lista de Cards de Templates */}
            <div className="flex-1 overflow-y-auto space-y-3 pr-1">
              {filteredTemplates.length === 0 ? (
                <div className="p-8 text-center border border-dashed border-border rounded-xl">
                  <p className="text-xs text-muted-foreground">
                    Nenhum template aprovado compatível encontrado para esta busca.
                  </p>
                </div>
              ) : (
                filteredTemplates.map((template) => {
                  const hasButtons = template.components?.some((c) => c.type === "BUTTONS");
                  const buttonsComponent = template.components?.find((c) => c.type === "BUTTONS");
                  return (
                    <div
                      key={`${template.name}:${template.language}`}
                      onClick={() => handleSelect(template)}
                      className="group border border-border/80 hover:border-primary/50 bg-background hover:bg-muted/20 p-4 rounded-xl transition-all cursor-pointer shadow-xs hover:shadow-sm"
                    >
                      {/* Topo do Card: Ícone WhatsApp verde + Nome + Categoria */}
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <div className="flex items-center gap-2">
                          {/* Ícone de balão verde característico do WhatsApp */}
                          <div className="h-5 w-5 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                            <MessageSquare className="h-3 w-3 fill-current" />
                          </div>
                          <span className="text-xs font-bold text-foreground font-mono">
                            {template.name}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-muted text-muted-foreground uppercase">
                            {template.category === "UTILITY" ? "UTILIDADE" : template.category}
                          </span>
                          <span className="text-[10px] font-medium text-muted-foreground">
                            {template.language}
                          </span>
                        </div>
                      </div>

                      {/* Texto do Corpo do Template */}
                      <p className="text-xs text-muted-foreground/90 line-clamp-3 leading-relaxed">
                        {template.bodyText.replace(/\{\{(\d+)\}\}/g, (_, num) => {
                          const binding = template.bindings?.[num];
                          if (binding === "customer_name") return `@${customerName}`;
                          if (binding === "operator_name") return `@${operatorName}`;
                          return `{{${num}}}`;
                        })}
                      </p>

                      {/* Botões do template (se houver) */}
                      {hasButtons && buttonsComponent?.buttons && (
                        <div className="mt-2.5 pt-2 border-t border-border/60 flex flex-wrap gap-1.5">
                          {buttonsComponent.buttons.map((btn, bIdx) => (
                            <span
                              key={bIdx}
                              className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-muted/60 text-foreground border border-border/60"
                            >
                              [{btn.text}]
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        ) : (
          /* ── CONFIGURAÇÃO E CONFIRMAÇÃO DO TEMPLATE SELECIONADO ── */
          <div className="flex flex-col flex-1 overflow-hidden p-6 space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-12 gap-5 flex-1 overflow-y-auto pr-1">
              {/* Coluna Esquerda: Variáveis a preencher */}
              <div className="md:col-span-6 space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    Variáveis da Mensagem ({selectedTemplate.variableCount})
                  </h4>
                  <span className="text-[11px] text-muted-foreground">
                    {selectedTemplate.category} · {selectedTemplate.language}
                  </span>
                </div>

                {selectedTemplate.variableCount === 0 ? (
                  <p className="text-xs text-muted-foreground bg-muted/30 p-3 rounded-xl border border-border/60">
                    Este template não possui variáveis variáveis e está pronto para ser enviado.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {Array.from({ length: selectedTemplate.variableCount }, (_, idx) => {
                      const num = String(idx + 1);
                      const binding = selectedTemplate.bindings?.[num] || "manual";
                      const isAuto = binding === "customer_name" || binding === "operator_name";

                      return (
                        <div key={idx} className="space-y-1">
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-semibold text-foreground">
                              Variável {`{{${num}}}`}
                            </span>
                            <span className="text-[10px] text-muted-foreground">
                              {binding === "customer_name"
                                ? "Preenchido com o Contato"
                                : binding === "operator_name"
                                ? "Preenchido com o Atendente"
                                : "Preenchimento Manual"}
                            </span>
                          </div>
                          <Input
                            value={parameters[idx] || ""}
                            readOnly={isAuto}
                            onChange={(e) => {
                              const val = e.target.value;
                              setParameters((prev) =>
                                prev.map((item, i) => (i === idx ? val : item))
                              );
                            }}
                            placeholder={`Informe o valor para {{${num}}}`}
                            className={`h-9 text-xs rounded-xl ${
                              isAuto
                                ? "bg-muted/50 border-border/60 text-muted-foreground cursor-not-allowed"
                                : "bg-background border-border text-foreground"
                            }`}
                          />
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Coluna Direita: Preview do WhatsApp */}
              <div className="md:col-span-6 flex flex-col">
                <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">
                  Prévia da Mensagem (WhatsApp)
                </h4>
                <div className="flex-1 rounded-2xl bg-muted/40 p-4 border border-border/80 flex flex-col justify-center items-center">
                  <div className="w-full max-w-sm rounded-xl bg-card border border-border/80 p-3.5 shadow-sm space-y-2">
                    <p className="text-xs text-foreground whitespace-pre-wrap leading-relaxed">
                      {previewText}
                    </p>
                    {/* Botões do template (se houver) */}
                    {selectedTemplate.components?.some((c) => c.type === "BUTTONS") && (
                      <div className="pt-2 border-t border-border/60 flex flex-col gap-1.5">
                        {selectedTemplate.components
                          ?.find((c) => c.type === "BUTTONS")
                          ?.buttons?.map((btn, bIdx) => (
                            <div
                              key={bIdx}
                              className="text-center py-1.5 rounded-lg bg-muted/60 text-primary font-semibold text-xs border border-border/60"
                            >
                              {btn.text}
                            </div>
                          ))}
                      </div>
                    )}
                    <div className="flex justify-end text-[10px] text-muted-foreground pt-1">
                      Agora
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Ações Inferiores */}
            <div className="pt-4 border-t border-border flex items-center justify-between">
              <button
                type="button"
                onClick={handleBack}
                className="px-4 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
              >
                Voltar à busca
              </button>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 rounded-xl text-xs font-semibold border border-border text-foreground hover:bg-muted transition-colors cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={
                    sending ||
                    parameters.length !== selectedTemplate.variableCount ||
                    parameters.some((p) => !p.trim())
                  }
                  onClick={handleConfirmSend}
                  className="inline-flex items-center gap-2 px-5 py-2 rounded-xl text-xs font-bold bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 transition-all cursor-pointer shadow-soft"
                >
                  <Send className="h-3.5 w-3.5" />
                  <span>{sending ? "Enviando..." : "Enviar Mensagem"}</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

interface Meta24hInfoModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function Meta24hInfoModal({ isOpen, onClose }: Meta24hInfoModalProps) {
  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-lg p-6 bg-card border-border shadow-2xl rounded-2xl">
        <DialogHeader className="space-y-2">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
              <HelpCircle className="h-5 w-5" />
            </div>
            <DialogTitle className="text-base font-bold text-foreground">
              Como funciona a Janela de 24 Horas da Meta?
            </DialogTitle>
          </div>
          <DialogDescription className="text-xs text-muted-foreground leading-relaxed pt-1">
            Entenda as regras da política oficial do WhatsApp Business Cloud API:
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3.5 text-xs text-foreground/90 my-2">
          <div className="p-3.5 rounded-xl bg-muted/40 border border-border/60 space-y-1.5">
            <p className="font-bold text-foreground">1. Janela Ativa de 24 Horas</p>
            <p className="text-muted-foreground leading-relaxed">
              Toda vez que o cliente envia uma mensagem, abre-se uma janela de 24 horas. Durante esse período, os atendentes podem responder livremente com qualquer texto ou arquivo sem custos adicionais por mensagem.
            </p>
          </div>

          <div className="p-3.5 rounded-xl bg-muted/40 border border-border/60 space-y-1.5">
            <p className="font-bold text-foreground">2. Janela Expirada (+24h)</p>
            <p className="text-muted-foreground leading-relaxed">
              Após 24 horas sem resposta do cliente, a Meta bloqueia mensagens normais para proteção contra spam. Para retomar contato, é obrigatório enviar um <strong>Template Aprovado</strong> (Utilidade ou Marketing).
            </p>
          </div>

          <div className="p-3.5 rounded-xl bg-muted/40 border border-border/60 space-y-1.5">
            <p className="font-bold text-foreground">3. Reabertura Automática</p>
            <p className="text-muted-foreground leading-relaxed">
              Assim que o cliente responder à sua mensagem template, a janela de 24 horas se reabre imediatamente e o campo de digitação volta ao normal.
            </p>
          </div>
        </div>

        <div className="flex justify-end pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 rounded-xl text-xs font-bold bg-primary text-primary-foreground hover:opacity-90 transition-all cursor-pointer"
          >
            Entendido
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

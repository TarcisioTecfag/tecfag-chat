import React, { useCallback, useEffect, useRef, useState } from "react";
import { Bold, Italic, Link2, List, ListOrdered, Loader2, Mail, Paperclip, Plus, Send, Underline, X } from "lucide-react";
import { toast } from "sonner";
import { useChat } from "@/hooks/useChatState";

type Recipient = { contactId: string; name: string; email: string; isPrimary: boolean };
type DealEmail = {
  id: string;
  direction: "outbound" | "inbound";
  fromAddress: string;
  toAddress: string;
  ccAddresses?: string[];
  subject: string;
  bodyText: string | null;
  isVerified: boolean;
  sentAt: string;
  operatorName?: string | null;
  metadata?: { delivery?: string; attachments?: Array<{ name: string; size: number }> };
};
type EmailData = { emails: DealEmail[]; recipients: Recipient[]; sender: string; smtpConfigured: boolean };
type Draft = { contactId: string; subject: string; bodyHtml: string; cc: string; bcc: string };

export function DealEmailTab({ dealId, onSent }: { dealId: string; onSent: () => Promise<unknown> | void }) {
  const { tenant, currentOperatorId, operatorProfile } = useChat();
  const [data, setData] = useState<EmailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "outbound" | "inbound">("all");
  const [composerOpen, setComposerOpen] = useState(false);
  const [contactId, setContactId] = useState("");
  const [subject, setSubject] = useState("");
  const [bodyHtml, setBodyHtml] = useState("");
  const [bodyText, setBodyText] = useState("");
  const [cc, setCc] = useState("");
  const [bcc, setBcc] = useState("");
  const [showCc, setShowCc] = useState(false);
  const [showBcc, setShowBcc] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const [draftSaved, setDraftSaved] = useState(false);
  const [expandedEmailId, setExpandedEmailId] = useState<string | null>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const draftReady = useRef(false);
  const draftKey = `crm-email-draft:${tenant || ""}:${dealId}:${currentOperatorId || ""}`;

  const loadEmails = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch(`/api/crm/deals/${encodeURIComponent(dealId)}/emails`, { credentials: "include", signal });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "Não foi possível carregar os e-mails.");
    setData(result as EmailData);
    setContactId((previous) => previous || result.recipients?.find((item: Recipient) => item.isPrimary)?.contactId || result.recipients?.[0]?.contactId || "");
  }, [dealId]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    loadEmails(controller.signal)
      .catch((error) => { if (!controller.signal.aborted) toast.error(error.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [loadEmails]);

  useEffect(() => {
    if (!composerOpen || !draftReady.current) return;
    setDraftSaved(false);
    const timer = window.setTimeout(() => {
      const draft: Draft = { contactId, subject, bodyHtml, cc, bcc };
      try {
        localStorage.setItem(draftKey, JSON.stringify(draft));
        setDraftSaved(true);
      } catch {
        setDraftSaved(false);
      }
    }, 500);
    return () => window.clearTimeout(timer);
  }, [composerOpen, contactId, subject, bodyHtml, cc, bcc, draftKey]);

  useEffect(() => {
    if (!composerOpen) return;
    const handleEscape = (event: KeyboardEvent) => { if (event.key === "Escape" && !sending) setComposerOpen(false); };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [composerOpen, sending]);

  const openComposer = () => {
    let draft: Draft | null = null;
    try { draft = JSON.parse(localStorage.getItem(draftKey) || "null") as Draft | null; } catch { /* rascunho inválido */ }
    const defaultContact = data?.recipients.find((item) => item.isPrimary)?.contactId || data?.recipients[0]?.contactId || "";
    setContactId(data?.recipients.some((item) => item.contactId === draft?.contactId) ? draft!.contactId : defaultContact);
    setSubject(draft?.subject || "");
    setBodyHtml(draft?.bodyHtml || "");
    setCc(draft?.cc || "");
    setBcc(draft?.bcc || "");
    setShowCc(Boolean(draft?.cc));
    setShowBcc(Boolean(draft?.bcc));
    setFiles([]);
    setDraftSaved(Boolean(draft));
    setComposerOpen(true);
    draftReady.current = true;
    window.setTimeout(() => {
      if (editorRef.current) {
        editorRef.current.innerHTML = draft?.bodyHtml || "";
        setBodyText(editorRef.current.innerText || "");
      }
    }, 0);
  };

  const syncEditor = () => {
    setBodyHtml(editorRef.current?.innerHTML || "");
    setBodyText(editorRef.current?.innerText || "");
  };

  const format = (command: string) => {
    editorRef.current?.focus();
    document.execCommand(command, false);
    syncEditor();
  };

  const addLink = () => {
    const url = window.prompt("Endereço do link (https:// ou mailto:)");
    if (!url || !/^(https?:\/\/|mailto:)/i.test(url)) return;
    editorRef.current?.focus();
    document.execCommand("createLink", false, url);
    syncEditor();
  };

  const addFiles = (selected: FileList | null) => {
    if (!selected) return;
    const next = [...files, ...Array.from(selected)];
    if (next.length > 5 || next.some((file) => !file.size || file.size > 10 * 1024 * 1024) || next.reduce((sum, file) => sum + file.size, 0) > 20 * 1024 * 1024) {
      toast.error("Anexe até 5 arquivos, com 10 MB por arquivo e 20 MB no total.");
      return;
    }
    setFiles(next);
    if (fileRef.current) fileRef.current.value = "";
  };

  const sendEmail = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!contactId || !subject.trim() || !bodyText.trim()) {
      toast.error("Selecione um contato e preencha assunto e mensagem.");
      return;
    }
    setSending(true);
    try {
      const form = new FormData();
      form.set("contactId", contactId);
      form.set("subject", subject.trim());
      form.set("bodyText", bodyText.trim());
      form.set("bodyHtml", bodyHtml);
      form.set("cc", cc.trim());
      form.set("bcc", bcc.trim());
      files.forEach((file) => form.append("attachments", file));
      const response = await fetch(`/api/crm/deals/${encodeURIComponent(dealId)}/emails/send`, {
        method: "POST", credentials: "include", body: form,
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Não foi possível enviar o e-mail.");
      localStorage.removeItem(draftKey);
      draftReady.current = false;
      setComposerOpen(false);
      setSubject("");
      setBodyHtml("");
      setBodyText("");
      setFiles([]);
      if (result.logged === false) {
        toast.warning(`E-mail enviado, mas o histórico não atualizou. ID: ${result.messageId || "indisponível"}`);
      } else if (result.partial) {
        toast.warning("E-mail enviado ao contato. Alguns destinatários em cópia foram recusados pelo servidor.");
      } else {
        toast.success("E-mail aceito pelo servidor de envio.");
      }
      try {
        await Promise.all([loadEmails(), Promise.resolve(onSent())]);
      } catch (error) {
        console.warn("E-mail enviado, mas a lista não atualizou:", error);
        toast.warning("E-mail enviado. Atualize a negociação para ver o histórico mais recente.");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível enviar o e-mail.");
    } finally {
      setSending(false);
    }
  };

  const visibleEmails = (data?.emails || []).filter((email) => filter === "all" || email.direction === filter);
  const selectedRecipient = data?.recipients.find((item) => item.contactId === contactId);

  return (
    <div className="space-y-4 animate-in fade-in-50 duration-200">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs">
          <label htmlFor="deal-email-filter" className="font-semibold text-muted-foreground">Exibir</label>
          <select id="deal-email-filter" value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)} className="h-9 rounded-lg border border-border bg-card px-3 font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30">
            <option value="all">Todos</option>
            <option value="outbound">Enviados</option>
            <option value="inbound">Recebidos</option>
          </select>
        </div>
        <button type="button" onClick={openComposer} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-4 text-xs font-bold text-primary-foreground hover:opacity-90">
          <Plus className="h-4 w-4" /> Criar e-mail
        </button>
      </div>
      <p className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
        Recebimento automático de respostas e confirmação de leitura: <strong className="text-foreground">em manutenção</strong>.
      </p>

      {loading ? (
        <div className="flex min-h-40 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
      ) : visibleEmails.length ? (
        <div className="space-y-2">
          {visibleEmails.map((email) => (
            <button key={email.id} type="button" onClick={() => setExpandedEmailId((id) => id === email.id ? null : email.id)} className="w-full rounded-xl border border-border bg-card p-4 text-left transition hover:border-primary/40 hover:bg-muted/20">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="rounded-md bg-primary/10 px-2 py-1 text-[10px] font-bold text-primary">{email.isVerified && email.metadata?.delivery === "smtp_accepted" ? "Enviado" : "Registrado"}</span>
                  <strong className="truncate text-sm text-foreground">{email.subject}</strong>
                </div>
                <time className="shrink-0 text-[10px] text-muted-foreground">{new Date(email.sentAt).toLocaleString("pt-BR")}</time>
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">De <span className="font-semibold text-foreground">{email.fromAddress}</span> · Para <span className="font-semibold text-foreground">{email.toAddress}</span></p>
              {email.bodyText && <p className={`mt-2 whitespace-pre-wrap text-xs text-muted-foreground ${expandedEmailId === email.id ? "" : "line-clamp-2"}`}>{email.bodyText}</p>}
              {expandedEmailId === email.id && Boolean(email.ccAddresses?.length) && <p className="mt-2 text-[11px] text-muted-foreground">CC: {email.ccAddresses?.join(", ")}</p>}
              {expandedEmailId === email.id && Boolean(email.metadata?.attachments?.length) && <p className="mt-2 text-[11px] text-muted-foreground">Anexos: {email.metadata?.attachments?.map((file) => file.name).join(", ")}</p>}
            </button>
          ))}
        </div>
      ) : (
        <div className="flex min-h-44 items-center gap-5 rounded-xl border border-border bg-card p-5">
          <div className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary"><Mail className="h-8 w-8" /></div>
          <div className="min-w-0 flex-1">
            <h4 className="text-sm font-bold text-foreground">{filter === "all" ? "Nenhum e-mail nesta negociação" : "Nenhum e-mail com este filtro"}</h4>
            <p className="mt-1 text-xs text-muted-foreground">{filter === "all" ? "Envie uma mensagem para iniciar o histórico por e-mail." : "Selecione outro filtro para ver o histórico."}</p>
          </div>
          <button type="button" onClick={openComposer} className="hidden shrink-0 items-center gap-1 rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-xs font-bold text-primary hover:bg-primary/15 sm:inline-flex"><Plus className="h-3.5 w-3.5" /> Criar e-mail</button>
        </div>
      )}

      {composerOpen && (
        <div className="fixed inset-0 z-[160] bg-black/50" onMouseDown={(event) => { if (event.target === event.currentTarget && !sending) setComposerOpen(false); }}>
          <aside role="dialog" aria-modal="true" aria-label="Criar e-mail" className="absolute inset-y-0 right-0 flex w-full max-w-[620px] flex-col border-l border-border bg-card shadow-2xl animate-in slide-in-from-right duration-200">
            <header className="flex h-16 shrink-0 items-center justify-between border-b border-border px-5">
              <h3 className="text-base font-bold text-foreground">Criar e-mail</h3>
              <button type="button" disabled={sending} onClick={() => setComposerOpen(false)} className="rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50" aria-label="Fechar"><X className="h-4 w-4" /></button>
            </header>
            <form onSubmit={sendEmail} className="flex min-h-0 flex-1 flex-col">
              <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
                <div className="space-y-4 text-xs">
                  <div className="grid grid-cols-[52px_1fr] items-center gap-2">
                    <label className="font-bold text-foreground">De *</label>
                    <div className="rounded-lg bg-muted px-3 py-2.5 font-medium text-foreground">{data?.sender ? (data.sender.includes("<") ? data.sender : `${operatorProfile?.name || "Comercial"} <${data.sender}>`) : "SMTP não configurado"}</div>
                  </div>
                  <div className="grid grid-cols-[52px_1fr_auto_auto] items-center gap-2">
                    <label htmlFor="deal-email-to" className="font-bold text-foreground">Para *</label>
                    <select id="deal-email-to" value={contactId} onChange={(event) => setContactId(event.target.value)} disabled={!data?.recipients.length} className="min-w-0 rounded-lg border border-border bg-card px-3 py-2.5 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-50">
                      {!data?.recipients.length && <option value="">Nenhum contato com e-mail</option>}
                      {data?.recipients.map((item) => <option key={item.contactId} value={item.contactId}>{item.name} &lt;{item.email}&gt;</option>)}
                    </select>
                    <button type="button" onClick={() => setShowCc((value) => !value)} className="font-bold text-primary hover:underline">CC</button>
                    <button type="button" onClick={() => setShowBcc((value) => !value)} className="font-bold text-primary hover:underline">BCC</button>
                  </div>
                  {!data?.recipients.length && <p className="ml-[60px] text-[11px] text-muted-foreground">Vincule um contato com e-mail à negociação para enviar.</p>}
                  {selectedRecipient && <p className="ml-[60px] text-[11px] text-muted-foreground">Destinatário: {selectedRecipient.email}</p>}
                  {showCc && <div className="grid grid-cols-[52px_1fr] items-center gap-2"><label htmlFor="deal-email-cc" className="font-bold text-foreground">CC</label><input id="deal-email-cc" value={cc} onChange={(event) => setCc(event.target.value)} placeholder="email@empresa.com, outro@empresa.com" className="rounded-lg border border-border bg-card px-3 py-2.5 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30" /></div>}
                  {showBcc && <div className="grid grid-cols-[52px_1fr] items-center gap-2"><label htmlFor="deal-email-bcc" className="font-bold text-foreground">BCC</label><input id="deal-email-bcc" value={bcc} onChange={(event) => setBcc(event.target.value)} placeholder="email@empresa.com" className="rounded-lg border border-border bg-card px-3 py-2.5 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30" /></div>}
                </div>

                <div className="border-t border-border pt-4">
                  <label htmlFor="deal-email-subject" className="mb-2 block text-xs font-bold text-foreground">Assunto *</label>
                  <input id="deal-email-subject" value={subject} onChange={(event) => setSubject(event.target.value)} maxLength={250} placeholder="Assunto do e-mail" className="h-10 w-full rounded-lg border border-border bg-card px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30" />
                </div>

                <div>
                  <label className="mb-2 block text-xs font-bold text-foreground">Mensagem *</label>
                  <div className="overflow-hidden rounded-lg border border-border bg-card focus-within:ring-2 focus-within:ring-primary/30">
                    <div className="flex flex-wrap gap-1 border-b border-border bg-muted/30 p-2">
                      {([
                        [Bold, "bold", "Negrito"], [Italic, "italic", "Itálico"], [Underline, "underline", "Sublinhado"],
                        [List, "insertUnorderedList", "Lista"], [ListOrdered, "insertOrderedList", "Lista numerada"],
                      ] as const).map(([Icon, command, label]) => <button key={command} type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => format(command)} title={label} aria-label={label} className="rounded p-1.5 text-muted-foreground hover:bg-primary/10 hover:text-primary"><Icon className="h-4 w-4" /></button>)}
                      <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={addLink} title="Inserir link" aria-label="Inserir link" className="rounded p-1.5 text-muted-foreground hover:bg-primary/10 hover:text-primary"><Link2 className="h-4 w-4" /></button>
                    </div>
                    <div ref={editorRef} contentEditable suppressContentEditableWarning onInput={syncEditor} data-placeholder="Escreva sua mensagem..." className="min-h-64 max-h-[45vh] overflow-y-auto p-3 text-sm leading-relaxed text-foreground outline-none empty:before:text-muted-foreground empty:before:content-[attr(data-placeholder)]" />
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 text-[11px]">
                  <div>
                    <input ref={fileRef} type="file" multiple className="hidden" onChange={(event) => addFiles(event.target.files)} />
                    <button type="button" onClick={() => fileRef.current?.click()} className="inline-flex items-center gap-1.5 rounded-lg bg-primary/10 px-3 py-2 font-bold text-primary hover:bg-primary/15"><Paperclip className="h-3.5 w-3.5" /> Anexar arquivo</button>
                  </div>
                  <span className="text-muted-foreground">{draftSaved ? "Texto do rascunho salvo neste navegador" : "Salvando rascunho..."}</span>
                </div>
                {files.length > 0 && <div className="flex flex-wrap gap-2">{files.map((file, index) => <span key={`${file.name}-${index}`} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-muted px-2 py-1 text-[11px] text-foreground"><Paperclip className="h-3 w-3" />{file.name}<button type="button" onClick={() => setFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))} aria-label={`Remover ${file.name}`}><X className="h-3 w-3" /></button></span>)}</div>}
                {!data?.smtpConfigured && <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs text-foreground">Configure o servidor SMTP deste tenant em Ajustes para habilitar o envio.</div>}
              </div>
              <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-border bg-card px-5 py-4">
                <button type="button" disabled={sending} onClick={() => setComposerOpen(false)} className="rounded-lg border border-border px-4 py-2 text-xs font-bold text-foreground hover:bg-muted disabled:opacity-50">Cancelar</button>
                <button type="submit" disabled={sending || !data?.smtpConfigured || !contactId || !subject.trim() || !bodyText.trim()} className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-bold text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50">{sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}{sending ? "Enviando..." : "Enviar"}</button>
              </footer>
            </form>
          </aside>
        </div>
      )}
    </div>
  );
}

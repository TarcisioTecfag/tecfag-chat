import React, { useState, useMemo } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { bodyVariableIndexes } from "@/lib/whatsapp/meta-template-common";

export function ComprehensiveTemplateCreator({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (open: boolean) => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [bodyText, setBodyText] = useState("");
  const [category, setCategory] = useState<"UTILITY" | "MARKETING">("UTILITY");
  const [busy, setBusy] = useState(false);
  
  const variables = useMemo(() => bodyVariableIndexes(bodyText), [bodyText]);
  const [bindings, setBindings] = useState<Record<string, string>>({});

  async function create() {
    setBusy(true);
    try {
      const response = await fetch("/api/settings/rd-marketing/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          name, 
          language: "pt_BR", 
          category, 
          bodyText, 
          examples: variables.map(() => "Exemplo"),
          bindings 
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      toast.success("Template enviado para aprovação!");
      onCreated();
      onOpenChange(false);
      setName("");
      setBodyText("");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader><DialogTitle>Criar Template Completo</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-6 py-4">
          <div className="space-y-4">
            <Label>Nome (ex: orcamento_final)</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
            
            <Label>Categoria</Label>
            <Select value={category} onValueChange={(v: any) => setCategory(v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="UTILITY">Utilidade</SelectItem>
                <SelectItem value="MARKETING">Marketing</SelectItem>
              </SelectContent>
            </Select>

            <Label>Corpo da Mensagem</Label>
            <Textarea className="h-32" value={bodyText} onChange={(e) => setBodyText(e.target.value)} />

            {variables.map((idx) => (
              <div key={idx} className="flex gap-2 items-center text-xs">
                <span>Variável {'{{'}{idx}{'}}'}</span>
                <Select value={bindings[idx] || "manual"} onValueChange={(v) => setBindings({...bindings, [idx]: v})}>
                  <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="manual">Preencher manual</SelectItem>
                    <SelectItem value="customer_name">Nome do Cliente</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>
          <div className="bg-muted p-4 rounded-xl">
            <Label>Preview</Label>
            <div className="bg-card p-3 rounded-lg border text-sm whitespace-pre-wrap mt-2">
              {bodyText || "Aguardando conteúdo..."}
            </div>
          </div>
        </div>
        <Button onClick={create} disabled={busy} className="w-full">Criar e Enviar para Meta</Button>
      </DialogContent>
    </Dialog>
  );
}

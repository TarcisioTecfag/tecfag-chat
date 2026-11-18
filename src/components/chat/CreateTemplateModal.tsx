import { useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export function CreateTemplateModal({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (open: boolean) => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [bodyText, setBodyText] = useState("");
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true);
    try {
      const response = await fetch("/api/settings/rd-marketing/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, language: "pt_BR", category: "UTILITY", bodyText, examples: [] }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      toast.success("Template enviado para aprovação da Meta!");
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
      <DialogContent>
        <DialogHeader><DialogTitle>Criar Novo Template WhatsApp</DialogTitle></DialogHeader>
        <div className="space-y-4 py-4">
          <Input placeholder="Nome do template (ex: orcamento_final)" value={name} onChange={(e) => setName(e.target.value)} />
          <Textarea placeholder="Texto da mensagem..." value={bodyText} onChange={(e) => setBodyText(e.target.value)} />
        </div>
        <DialogFooter>
          <Button onClick={create} disabled={busy}>Criar e Enviar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

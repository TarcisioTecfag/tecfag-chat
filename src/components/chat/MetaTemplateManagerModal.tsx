import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MetaTemplatesManager } from "./MetaTemplatesManager";

export function MetaTemplateManagerModal({ open, onOpenChange, tenant }: { open: boolean; onOpenChange: (open: boolean) => void; tenant: string | null }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[90vw] h-[90vh]">
        <DialogHeader><DialogTitle>Gestão Oficial de Templates Meta</DialogTitle></DialogHeader>
        <div className="overflow-y-auto h-full">
            <MetaTemplatesManager tenant={tenant} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

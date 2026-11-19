import React from "react";
import { BookOpen, Key, Shield } from "lucide-react";
import { SystemTooltip } from "@/components/ui/tooltip";
import { McpSettingsTab } from "./McpSettingsTab";
import { ApiLibrarySettingsTab } from "./ApiLibrarySettingsTab";

export type ApiMcpHubSection = "keys" | "library";

interface ApiAndMcpHubTabProps {
  activeSection: ApiMcpHubSection;
  onChangeSection: (section: ApiMcpHubSection) => void;
}

export function ApiAndMcpHubTab({
  activeSection,
  onChangeSection,
}: ApiAndMcpHubTabProps) {
  return (
    <div className="space-y-6 w-full">
      {/* Navegação unificada interna: Chaves/Permissões/Auditoria + Biblioteca/Docs/Playground */}
      <div className="rounded-2xl bg-card border border-border p-3 shadow-soft flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <div className="h-9 w-9 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
            <Shield className="h-4 w-4 text-primary" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-extrabold text-foreground truncate">
              Central de API &amp; Conector MCP
            </h3>
            <p className="text-[11px] text-muted-foreground truncate">
              Gerencie chaves, permissões (Somente Leitura vs. Leitura + Escrita), auditoria e documentação no mesmo lugar.
            </p>
          </div>
        </div>

        <div className="inline-flex items-center gap-1.5 rounded-xl bg-muted/40 border border-border p-1 shrink-0">
          <SystemTooltip content="Gerenciar Link Principal, Links Individuais, permissões de Leitura/Escrita e Histórico de Auditoria">
            <button
              type="button"
              onClick={() => onChangeSection("keys")}
              className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-bold transition cursor-pointer whitespace-nowrap ${
                activeSection === "keys"
                  ? "bg-primary text-primary-foreground shadow-soft"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Key className="h-3.5 w-3.5 shrink-0" />
              Chaves, Permissões &amp; Auditoria
            </button>
          </SystemTooltip>

          <SystemTooltip content="Explorar catálogo REST, 40 ferramentas MCP, Webhooks, snippets prontos, Playground ao vivo e exportar PDF">
            <button
              type="button"
              onClick={() => onChangeSection("library")}
              className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-bold transition cursor-pointer whitespace-nowrap ${
                activeSection === "library"
                  ? "bg-primary text-primary-foreground shadow-soft"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <BookOpen className="h-3.5 w-3.5 shrink-0" />
              Biblioteca de API &amp; Playground
            </button>
          </SystemTooltip>
        </div>
      </div>

      {activeSection === "keys" ? <McpSettingsTab /> : <ApiLibrarySettingsTab />}
    </div>
  );
}

import React, { useState } from "react";
import { Search, UserCheck, Phone, MessageSquare, ExternalLink, Tag, Calendar, Building } from "lucide-react";

interface EnrichedContact {
  id: string;
  name: string;
  phone: string;
  company: string;
  lastCallDate: string;
  totalCalls: number;
  tags: string[];
  rdCrmDealId?: string;
  rdCrmDealLink?: string;
  extractedNotes: string;
}

export function ClientesTab() {
  const [searchTerm, setSearchTerm] = useState("");

  const [contacts] = useState<EnrichedContact[]>([
    {
      id: "c-1",
      name: "João Silva",
      phone: "+55 14 99836-4338",
      company: "Valem Embalagens",
      lastCallDate: "10/08/2026",
      totalCalls: 3,
      tags: ["Válvulas Spray", "Lote Grande (10k)", "Cliente Quente"],
      rdCrmDealId: "deal-9872",
      rdCrmDealLink: "https://crm.rdstation.com/deals/9872",
      extractedNotes: "Interessado em válvulas 300ml alumínio. Aguardando proposta comercial por WhatsApp."
    },
    {
      id: "c-2",
      name: "Mariana Costa",
      phone: "+55 11 98765-4321",
      company: "Distribuidora XYZ",
      lastCallDate: "09/08/2026",
      totalCalls: 1,
      tags: ["Frascos PET", "Primeiro Contato"],
      extractedNotes: "Solicitou envio de catálogo em PDF."
    }
  ]);

  const filteredContacts = contacts.filter(c => 
    c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    c.phone.includes(searchTerm) ||
    c.company.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="flex flex-col gap-6 p-6 overflow-y-auto h-full text-slate-100">
      {/* Top Header & Search */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 bg-slate-900/80 border border-slate-800 rounded-xl p-4">
        <div>
          <h3 className="text-base font-bold text-slate-100">Contatos Enriquecidos por Voz</h3>
          <p className="text-xs text-slate-400 mt-0.5">Leads com perfil de consumo extraído automaticamente pela Valentina após ligações.</p>
        </div>

        <div className="relative w-full sm:w-72">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input 
            type="text" 
            placeholder="Filtrar clientes por nome ou tag..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-4 py-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500/50"
          />
        </div>
      </div>

      {/* Grid de Cards de Contatos */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {filteredContacts.map((contact) => (
          <div key={contact.id} className="bg-slate-900/80 border border-slate-800 rounded-xl p-5 flex flex-col justify-between gap-4">
            <div>
              <div className="flex items-start justify-between gap-3 mb-2">
                <div>
                  <h4 className="text-base font-bold text-slate-100">{contact.name}</h4>
                  <p className="text-xs text-slate-400 flex items-center gap-1 mt-0.5">
                    <Building className="w-3.5 h-3.5" /> {contact.company}
                  </p>
                </div>

                {contact.rdCrmDealLink && (
                  <a 
                    href={contact.rdCrmDealLink} 
                    target="_blank" 
                    rel="noreferrer"
                    className="flex items-center gap-1 px-2.5 py-1 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded-lg text-[11px] font-semibold transition-colors"
                  >
                    RD Station CRM
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>

              <div className="text-xs text-slate-300 bg-slate-950/60 border border-slate-800/80 rounded-lg p-3 my-3">
                <span className="text-slate-400 font-semibold block mb-1">Notas extraídas da ligação:</span>
                {contact.extractedNotes}
              </div>

              {/* Tags de interesse */}
              <div className="flex flex-wrap gap-1.5 mt-2">
                {contact.tags.map((tag, idx) => (
                  <span key={idx} className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-500/10 text-blue-300 border border-blue-500/20 rounded-md text-[10px] font-medium">
                    <Tag className="w-2.5 h-2.5" />
                    {tag}
                  </span>
                ))}
              </div>
            </div>

            {/* Rodapé com Ações Rápidas */}
            <div className="pt-3 border-t border-slate-800 flex items-center justify-between gap-2 text-xs">
              <div className="text-[11px] text-slate-400 flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5" /> Última ligação: {contact.lastCallDate}
              </div>

              <div className="flex items-center gap-2">
                <button className="flex items-center gap-1 px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-medium transition-colors">
                  <MessageSquare className="w-3.5 h-3.5 text-emerald-400" />
                  WhatsApp
                </button>
                <button className="flex items-center gap-1 px-2.5 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-medium transition-colors">
                  <Phone className="w-3.5 h-3.5" />
                  Ligar
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

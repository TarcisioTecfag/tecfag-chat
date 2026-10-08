// ══════════════════════════════════════════════════════════════════════════════
// 🔄 TIPOS DO DASHBOARD DE RODÍZIO (Fagner / Valentina)
// ══════════════════════════════════════════════════════════════════════════════

export interface RodizioStats {
  totalLeads: number;
  syncedToCrm: number;
  triageDone: number;
  triageRate: number;
  activeSessions: number;
  avgScore: string | number;
  costPerLead?: number;
  totalCost30d?: number;
  leadsWithCnpj?: number;
}

export interface LeadByDay {
  day: string;
  count: number;
}

export interface LeadByFunnel {
  funnel: string;
  count: number;
}

export interface OperatorCard {
  id: string;
  name: string;
  company?: string | null;
  created_at: string;
  chatId?: string;
  rdDealId?: string;
  phone?: string | null;
  subject?: string | null;
}

export interface OperatorRow {
  id: string;
  name: string;
  email?: string;
  avatar?: string | null;
  count: number;
  compensation: number;
  sector?: string | null;
  allowed_subflows?: string[] | null;
  is_sdr?: boolean;
  isParticipating?: boolean;
  isOnLeave?: boolean;
  isPenalized?: boolean;
  cards?: OperatorCard[];
}

export interface CrmDeal {
  id: string;
  name: string;
  company: string | null;
  phone: string | null;
  rd_deal_id: string;
  operator_name: string | null;
  sector: string | null;
  funnel: string | null;
  created_at: string;
}

export interface OperatorOption {
  id: string;
  name: string;
  rd_crm_user_id?: string | null;
  sector?: string | null;
  leads_compensation?: number;
  avatar?: string | null;
}

export interface SectorConfig {
  key: string;
  label: string;
  shortLabel: string;
  color: string;
  accent: string;
  bgLight: string;
  bgDark: string;
  borderLight: string;
  borderDark: string;
  badgeBg: string;
  badgeText: string;
}

import React, { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, ArrowRight, MessageCircle } from "lucide-react";
import { ChatHeader } from "./ChatHeader";
import { ChatBubble, Message, Attachment } from "./ChatBubble";
import { ChatInput } from "./ChatInput";
import { TypingIndicator } from "./TypingIndicator";
import {
  playNotificationSound,
  requestNotificationPermission,
  showBrowserNotification,
} from "./notifications";
import { AVATAR_URL, BACKEND_URL, TENANT_ID, buildLiveChatWsUrl } from "../../config";
import { WidgetMessageOutbox, type PendingWidgetMessage } from "../../lib/message-outbox";
import { getBrowserSiteEntry } from "../../lib/site-entry";

// ─── Campanha Sazonal: Black November 2026 (expira automaticamente em 30/11/2026 23:59:59 BRT) ─
const BLACK_NOVEMBER_END_MS = new Date("2026-11-30T23:59:59-03:00").getTime();
const BLACK_NOVEMBER_STORAGE_KEY = "tecfag_black_november_enabled";

function isWithinBlackNovemberWindow(): boolean {
  return Date.now() <= BLACK_NOVEMBER_END_MS;
}

function getInitialBlackNovemberState(): boolean {
  if (!isWithinBlackNovemberWindow()) return false;
  try {
    const saved = localStorage.getItem(BLACK_NOVEMBER_STORAGE_KEY);
    if (saved === "false") return false;
  } catch {}
  return true;
}

const COOKIE_KEY = "tecfag_visitor_id";
const STORAGE_KEY_MESSAGES = "tecfag_chat_messages";
const STORAGE_KEY_CHAT_ID = "tecfag_chat_id";
const STORAGE_KEY_VISITOR_NAME = "tecfag_visitor_name";
const STORAGE_KEY_VISITOR_EMAIL = "tecfag_visitor_email";
const STORAGE_KEY_VISITOR_PHONE = "tecfag_visitor_phone";
const STORAGE_KEY_NAME_CONFIRMED = "tecfag_name_confirmed";
const STORAGE_KEY_IS_OPEN = "tecfag_chat_is_open";
const STORAGE_KEY_OPERATOR_NAME = "tecfag_operator_name";
const STORAGE_KEY_LAST_ACTIVITY = "tecfag_chat_last_activity";

function normalizeBrPhoneDigits(raw: string): string {
  let digits = (raw || "").replace(/\D/g, "");
  if (digits.length > 11 && digits.startsWith("55")) {
    digits = digits.slice(2);
  }
  return digits.slice(0, 11);
}

function formatBrPhoneMask(raw: string): string {
  const d = normalizeBrPhoneDigits(raw);
  if (!d) return "";
  if (d.length <= 2) return `(${d}`;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7, 11)}`;
}

function isValidEmailAddress(email: string): boolean {
  const trimmed = (email || "").trim();
  return trimmed.length <= 180 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(trimmed);
}

function isValidBrPhone(raw: string): boolean {
  const d = normalizeBrPhoneDigits(raw);
  if (d.length !== 10 && d.length !== 11) return false;
  if (/^(\d)\1+$/.test(d)) return false;
  const ddd = Number(d.slice(0, 2));
  return ddd >= 11 && ddd <= 99;
}

const MSG_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 horas
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const INTERNAL_LOG_REGEX = /^\[[A-Z0-9_]+[:\]]/s;

function getOrCreateCookieId(): string {
  try {
    let id = localStorage.getItem(COOKIE_KEY);
    if (!id) {
      id =
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `v_${Math.random().toString(36).substring(2, 15)}${Date.now().toString(36)}`;
      localStorage.setItem(COOKIE_KEY, id);
    }
    return id;
  } catch {
    return `v_${Date.now()}`;
  }
}

interface CurrentProduct {
  slug: string;
  displayName: string;
  productUrl: string;
}

function extractVtexProductSlug(url: string): string | null {
  const match = (url || "").match(/\/([^/?#]+)\/p(?:[?#]|$)/);
  return match ? match[1] : null;
}

function slugToDisplayName(slug: string): string {
  return slug
    .replace(/---[^-]+$/, "")
    .replace(/-+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

function extractFirstNameForGreeting(raw: string): string {
  const clean = (raw || "").replace(/\s+/g, " ").trim();
  if (!clean) return "";
  const first = clean.split(" ")[0]?.replace(/[^\p{L}'-]/gu, "") || "";
  if (first.length < 2) return "";
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
}

const DEFAULT_WELCOME_MESSAGE: Message = {
  id: "welcome-msg",
  content: "Sou o Fagner, assistente virtual da Tecfag! Como posso te ajudar hoje? 😊",
  sender: "ai",
  timestamp: new Date().toISOString(),
};

function sanitizeLoadedMessages(msgs: any[]): Message[] {
  return msgs
    .map((m, idx): Message | null => {
      const content = typeof m.content === "string" ? m.content : typeof m.text === "string" ? m.text : "";
      const sender: Message["sender"] =
        m.sender === "visitor" || m.sender === "ai" || m.sender === "agent" || m.sender === "system"
          ? m.sender
          : m.isSystem
            ? "system"
            : m.isAgent
              ? "ai"
              : "visitor";
      const isAgentJoined = Boolean(m.isAgentJoined);
      if (!isAgentJoined && (sender === "ai" || sender === "agent")) {
        const txt = content.trim();
        const isLog = INTERNAL_LOG_REGEX.test(txt) && !/^\[AUDIO:/i.test(txt) && !/^\[(?:Anexo_Cliente|IMAGE):/i.test(txt);
        if (isLog && !m.agentAttachments?.length) return null;
      }
      const finalContent =
        isAgentJoined && UUID_REGEX.test(content)
          ? "Atendente está respondendo este chat"
          : content;
      return {
        id: String(m.id ?? (idx === 0 ? "welcome-msg" : `msg_${idx}_${Date.now()}`)),
        content: finalContent,
        sender,
        timestamp: m.timestamp || new Date().toISOString(),
        deliveryState: m.deliveryState,
        agentAttachments: m.agentAttachments,
        serverTs: m.serverTs,
        isSystem: Boolean(m.isSystem || sender === "system"),
        isAgentJoined,
        quotedMessageId: typeof m.quotedMessageId === "string" ? m.quotedMessageId : undefined,
        quotedMessageSender:
          typeof m.quotedMessageSender === "string" ? m.quotedMessageSender : undefined,
        quotedMessageContent:
          typeof m.quotedMessageContent === "string" ? m.quotedMessageContent : undefined,
      };
    })
    .filter((m): m is Message => m !== null);
}

function loadStoredMessages(): Message[] {
  try {
    const rawLocal = localStorage.getItem(STORAGE_KEY_MESSAGES);
    if (rawLocal) {
      const parsed = JSON.parse(rawLocal);
      if (parsed && typeof parsed === "object" && Array.isArray(parsed.messages)) {
        if (Date.now() - Number(parsed.savedAt || 0) <= MSG_EXPIRY_MS) {
          const cleaned = sanitizeLoadedMessages(parsed.messages);
          if (cleaned.length > 0) {
            if (!cleaned.some((m) => m.id === "welcome-msg")) {
              cleaned[0] = { ...cleaned[0], id: "welcome-msg" };
            }
            return cleaned;
          }
        } else {
          localStorage.removeItem(STORAGE_KEY_MESSAGES);
        }
      }
    }
    const rawSession = sessionStorage.getItem(STORAGE_KEY_MESSAGES);
    if (rawSession) {
      const parsed = JSON.parse(rawSession);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const cleaned = sanitizeLoadedMessages(parsed);
        if (cleaned.length > 0) return cleaned;
      }
    }
  } catch {}
  return [DEFAULT_WELCOME_MESSAGE];
}

function saveStoredMessages(msgs: Message[]): void {
  try {
    const serializable = msgs.slice(-60).map((m) => ({
      ...m,
      attachments: undefined, // File objects não são serializáveis
    }));
    localStorage.setItem(
      STORAGE_KEY_MESSAGES,
      JSON.stringify({ messages: serializable, savedAt: Date.now() }),
    );
    sessionStorage.setItem(STORAGE_KEY_MESSAGES, JSON.stringify(serializable));
    sessionStorage.setItem(STORAGE_KEY_LAST_ACTIVITY, String(Date.now()));
  } catch {}
}

function clearStoredMessages(): void {
  try {
    localStorage.removeItem(STORAGE_KEY_MESSAGES);
    sessionStorage.removeItem(STORAGE_KEY_MESSAGES);
  } catch {}
}

// ─── Posição e dimensões responsivas da janela de chat ───────────────────────
const CHAT_W = 380;
const CHAT_H_MAX = 580;
const CHAT_H_MIN = 440;
const CHAT_MARGIN = 24;
const MOBILE_BREAKPOINT = 640;

interface ViewportLayout {
  isMobile: boolean;
  width: number;
  height: number;
  offsetTop: number;
  viewportW: number;
  viewportH: number;
}

function getViewportLayout(): ViewportLayout {
  if (typeof window === "undefined") {
    return { isMobile: false, width: CHAT_W, height: CHAT_H_MAX, offsetTop: 0, viewportW: 1024, viewportH: 800 };
  }
  const vv = window.visualViewport;
  const viewportW = Math.round(vv?.width || window.innerWidth || 1024);
  const viewportH = Math.round(vv?.height || window.innerHeight || 800);
  const offsetTop = Math.round(vv?.offsetTop || 0);
  const isMobile = (window.innerWidth || viewportW) < MOBILE_BREAKPOINT;

  if (isMobile) {
    return {
      isMobile: true,
      width: viewportW,
      height: viewportH,
      offsetTop,
      viewportW,
      viewportH,
    };
  }

  const desktopH = Math.max(
    CHAT_H_MIN,
    Math.min(CHAT_H_MAX, Math.floor(viewportH * 0.82)),
  );
  return {
    isMobile: false,
    width: Math.min(CHAT_W, Math.max(300, viewportW - CHAT_MARGIN * 2)),
    height: Math.min(desktopH, Math.max(360, viewportH - CHAT_MARGIN * 2)),
    offsetTop: 0,
    viewportW,
    viewportH,
  };
}

function getInitialChatPos(layout: ViewportLayout = getViewportLayout()) {
  if (layout.isMobile) {
    return { x: 0, y: layout.offsetTop };
  }
  return {
    x: CHAT_MARGIN,
    y: Math.max(CHAT_MARGIN, layout.viewportH - layout.height - CHAT_MARGIN),
  };
}

export const ChatWidget: React.FC = () => {
  const [isOpen, setIsOpen] = useState<boolean>(() => {
    try {
      return sessionStorage.getItem(STORAGE_KEY_IS_OPEN) === "true";
    } catch {
      return false;
    }
  });
  const [isBlackNovember, setIsBlackNovember] = useState<boolean>(getInitialBlackNovemberState);
  const activeAvatar = isBlackNovember
    ? `${BACKEND_URL}/fagner-black-november.png`
    : AVATAR_URL || `${BACKEND_URL}/fagner-avatar.jpg`;

  const [messages, setMessages] = useState<Message[]>(loadStoredMessages);
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isTyping, setIsTyping] = useState(false);
  const [, setIsConnected] = useState(false);

  const [visitorName, setVisitorName] = useState<string>(() => {
    try {
      return (
        localStorage.getItem(STORAGE_KEY_VISITOR_NAME) ||
        sessionStorage.getItem(STORAGE_KEY_VISITOR_NAME) ||
        ""
      );
    } catch {
      return "";
    }
  });

  const [visitorEmail, setVisitorEmail] = useState<string>(() => {
    try {
      return (
        localStorage.getItem(STORAGE_KEY_VISITOR_EMAIL) ||
        sessionStorage.getItem(STORAGE_KEY_VISITOR_EMAIL) ||
        ""
      );
    } catch {
      return "";
    }
  });

  const [visitorPhone, setVisitorPhone] = useState<string>(() => {
    try {
      const saved =
        localStorage.getItem(STORAGE_KEY_VISITOR_PHONE) ||
        sessionStorage.getItem(STORAGE_KEY_VISITOR_PHONE) ||
        "";
      return saved ? formatBrPhoneMask(saved) : "";
    } catch {
      return "";
    }
  });

  const [preChatNameInput, setPreChatNameInput] = useState<string>(() => visitorName);
  const [preChatEmailInput, setPreChatEmailInput] = useState<string>(() => visitorEmail);
  const [preChatPhoneInput, setPreChatPhoneInput] = useState<string>(() => visitorPhone);
  const [preChatError, setPreChatError] = useState<string | null>(null);

  const [, setNameConfirmed] = useState<boolean>(() => {
    try {
      return (
        sessionStorage.getItem(STORAGE_KEY_NAME_CONFIRMED) === "true" ||
        (Boolean(localStorage.getItem(STORAGE_KEY_VISITOR_NAME)) &&
          Boolean(localStorage.getItem(STORAGE_KEY_VISITOR_EMAIL)) &&
          Boolean(localStorage.getItem(STORAGE_KEY_VISITOR_PHONE)))
      );
    } catch {
      return false;
    }
  });

  const hasCompletePreChat = Boolean(
    visitorName.trim().length >= 2 &&
      isValidEmailAddress(visitorEmail) &&
      isValidBrPhone(visitorPhone),
  );
  const hasActiveConversation = messages.some((m) => m.sender === "visitor");

  const [preChatMode, setPreChatMode] = useState<boolean>(false);
  const [chatStarted, setChatStarted] = useState<boolean>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_MESSAGES);
      if (raw) {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed?.messages) && parsed.messages.length > 0;
      }
    } catch {}
    return false;
  });
  const [chatStartedAt, setChatStartedAt] = useState<string | null>(null);
  const [showRestartConfirm, setShowRestartConfirm] = useState(false);
  const [bubblePhase, setBubblePhase] = useState<"icon" | "pill">("icon");

  const [currentProduct, setCurrentProduct] = useState<CurrentProduct | null>(() => {
    const href = typeof window !== "undefined" ? window.location?.href || "" : "";
    const slug = extractVtexProductSlug(href);
    if (!slug) return null;
    return { slug, displayName: slugToDisplayName(slug), productUrl: href };
  });
  const [dismissedProductSlug, setDismissedProductSlug] = useState<string | null>(null);
  const [pendingProductInquiry, setPendingProductInquiry] = useState<CurrentProduct | null>(null);

  const [, setChatId] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem(STORAGE_KEY_CHAT_ID) || null;
    } catch {
      return null;
    }
  });
  const [operatorName, setOperatorName] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem(STORAGE_KEY_OPERATOR_NAME) || null;
    } catch {
      return null;
    }
  });

  // ── Layout responsivo + posição arrastável da janela de chat ─────────
  const [viewportLayout, setViewportLayout] = useState<ViewportLayout>(getViewportLayout);
  const viewportLayoutRef = useRef(viewportLayout);
  const [chatPos, setChatPos] = useState(() => getInitialChatPos(viewportLayout));
  const chatPosRef = useRef(chatPos);
  const dragStartMouse = useRef({ x: 0, y: 0 });
  const dragStartPos = useRef({ x: 0, y: 0 });
  const visitorIdentityRef = useRef({ name: visitorName, email: visitorEmail, phone: visitorPhone });
  useEffect(() => {
    visitorIdentityRef.current = { name: visitorName, email: visitorEmail, phone: visitorPhone };
  }, [visitorName, visitorEmail, visitorPhone]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const buttonWrapperRef = useRef<HTMLDivElement>(null);
  const chatWindowRef = useRef<HTMLDivElement>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const mountedRef = useRef(true);
  const isOpenRef = useRef(isOpen);
  const outboxRef = useRef<WidgetMessageOutbox | null>(null);
  const unpersistedRef = useRef(new Map<string, Omit<PendingWidgetMessage, "state">>());
  const currentPageviewIdRef = useRef<string | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heartbeatIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const getTimestamp = () => {
    const now = new Date();
    return `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`;
  };

  const getOutbox = useCallback(() => {
    if (!outboxRef.current) {
      outboxRef.current = new WidgetMessageOutbox(
        localStorage,
        JSON.stringify(["site-message-outbox-v1", BACKEND_URL, TENANT_ID, getOrCreateCookieId()]),
      );
    }
    return outboxRef.current;
  }, []);

  const syncPendingMessages = useCallback(() => {
    const entries = getOutbox().snapshot();
    setMessages((previous) => {
      const updated = previous.map((message) => {
        const entry = entries.find((item) => item.id === message.id);
        return entry && message.deliveryState !== entry.state
          ? { ...message, deliveryState: entry.state }
          : message;
      });
      const missing: Message[] = entries
        .filter((entry) => !updated.some((message) => message.id === entry.id))
        .map((entry) => ({
          id: entry.id,
          content: entry.displayText,
          sender: "visitor",
          timestamp: new Date(entry.createdAt).toISOString(),
          deliveryState: entry.state,
        }));
      return !missing.length && updated.every((message, index) => message === previous[index])
        ? previous
        : [...updated, ...missing];
    });
  }, [getOutbox]);

  const flushOutbox = useCallback(
    (force = false) => {
      const socket = wsRef.current;
      if (!mountedRef.current || socket?.readyState !== WebSocket.OPEN) return;
      try {
        getOutbox().sendNext((payload) => socket.send(JSON.stringify(payload)), Date.now(), force);
        syncPendingMessages();
      } catch {}
    },
    [getOutbox, syncPendingMessages],
  );

  // Força posicionamento com inline !important (vence regras globais do VTEX IO)
  useEffect(() => {
    if (!isOpen && buttonWrapperRef.current) {
      const el = buttonWrapperRef.current;
      const mobileOffset = viewportLayout.isMobile ? "16px" : "24px";
      el.style?.setProperty?.("position", "fixed", "important");
      el.style?.setProperty?.("bottom", mobileOffset, "important");
      el.style?.setProperty?.("left", mobileOffset, "important");
      el.style?.setProperty?.("z-index", "99999", "important");
      el.style?.setProperty?.("transform", "none", "important");
      el.style?.setProperty?.("display", "block", "important");
      el.style?.setProperty?.("visibility", "visible", "important");
      el.style?.setProperty?.("opacity", "1", "important");
    }
  }, [isOpen, bubblePhase, viewportLayout.isMobile]);

  useEffect(() => {
    if (isOpen && chatWindowRef.current) {
      const el = chatWindowRef.current;
      el.style?.setProperty?.("position", "fixed", "important");
      if (viewportLayout.isMobile) {
        el.style?.setProperty?.("left", "0px", "important");
        el.style?.setProperty?.("top", `${viewportLayout.offsetTop}px`, "important");
        el.style?.setProperty?.("width", "100%", "important");
        el.style?.setProperty?.("height", `${viewportLayout.height}px`, "important");
        el.style?.setProperty?.("z-index", "2147483647", "important");
      } else {
        el.style?.setProperty?.("left", `${chatPos.x}px`, "important");
        el.style?.setProperty?.("top", `${chatPos.y}px`, "important");
        el.style?.setProperty?.("width", `${viewportLayout.width}px`, "important");
        el.style?.setProperty?.("height", `${viewportLayout.height}px`, "important");
        el.style?.setProperty?.("z-index", "2147483646", "important");
      }
      el.style?.setProperty?.("transform", "none", "important");
    }
  }, [isOpen, chatPos, viewportLayout]);

  // Trava scroll do fundo da loja VTEX enquanto o chat mobile está aberto em tela cheia
  useEffect(() => {
    if (!isOpen || !viewportLayout.isMobile || typeof document === "undefined" || !document.body) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [isOpen, viewportLayout.isMobile]);

  // Alterna o botão flutuante entre ícone e pílula com Fagner a cada 3.2s
  useEffect(() => {
    if (isOpen) return;
    const cycle = setInterval(() => {
      setBubblePhase((p) => (p === "icon" ? "pill" : "icon"));
    }, 3200);
    return () => clearInterval(cycle);
  }, [isOpen]);

  useEffect(() => {
    chatPosRef.current = chatPos;
  }, [chatPos]);

  useEffect(() => {
    viewportLayoutRef.current = viewportLayout;
  }, [viewportLayout]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const syncViewport = () => {
      const next = getViewportLayout();
      setViewportLayout(next);
      if (next.isMobile) {
        setChatPos({ x: 0, y: next.offsetTop });
      } else {
        setChatPos((p) => ({
          x: Math.max(CHAT_MARGIN, Math.min(p.x, next.viewportW - next.width - CHAT_MARGIN)),
          y: Math.max(CHAT_MARGIN, Math.min(p.y, next.viewportH - next.height - CHAT_MARGIN)),
        }));
      }
    };
    window.addEventListener("resize", syncViewport);
    const vv = window.visualViewport;
    vv?.addEventListener?.("resize", syncViewport);
    vv?.addEventListener?.("scroll", syncViewport);
    return () => {
      window.removeEventListener("resize", syncViewport);
      vv?.removeEventListener?.("resize", syncViewport);
      vv?.removeEventListener?.("scroll", syncViewport);
    };
  }, []);

  const handleHeaderDragStart = useCallback((e: React.MouseEvent) => {
    if (viewportLayoutRef.current.isMobile) return;
    if (e.button !== 0) return;
    if ((e.target as HTMLElement)?.closest?.("button, a")) return;
    e.preventDefault();

    dragStartMouse.current = { x: e.clientX, y: e.clientY };
    dragStartPos.current = { ...chatPosRef.current };

    const onMove = (ev: MouseEvent) => {
      const layout = viewportLayoutRef.current;
      const dx = ev.clientX - dragStartMouse.current.x;
      const dy = ev.clientY - dragStartMouse.current.y;
      const nx = Math.max(0, Math.min(layout.viewportW - layout.width, dragStartPos.current.x + dx));
      const ny = Math.max(0, Math.min(layout.viewportH - layout.height, dragStartPos.current.y + dy));
      setChatPos({ x: nx, y: ny });
    };

    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, []);

  useEffect(() => {
    isOpenRef.current = isOpen;
    try {
      sessionStorage.setItem(STORAGE_KEY_IS_OPEN, String(isOpen));
    } catch {}
    if (isOpen) {
      const next = getViewportLayout();
      setViewportLayout(next);
      setBubblePhase("icon");
      setUnreadCount(0);
      setChatPos(getInitialChatPos(next));
      requestNotificationPermission();
    }
  }, [isOpen]);

  useEffect(() => {
    saveStoredMessages(messages);
  }, [messages]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isTyping, isOpen]);

  const handleJumpToMessage = useCallback((targetId: string) => {
    if (!targetId || !scrollRef.current) return;
    const escaped =
      typeof CSS !== "undefined" && typeof CSS.escape === "function"
        ? CSS.escape(targetId)
        : targetId.replace(/["\\]/g, "\\$&");
    const targetEl = scrollRef.current.querySelector(
      `[data-widget-msg-id="${escaped}"]`,
    ) as HTMLElement | null;
    if (targetEl) {
      targetEl.scrollIntoView({ behavior: "smooth", block: "center" });
      setHighlightedMessageId(targetId);
      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
      highlightTimerRef.current = setTimeout(() => {
        setHighlightedMessageId((cur) => (cur === targetId ? null : cur));
      }, 1600);
    }
  }, []);

  const addAgentMessage = useCallback(
    (
      text: string,
      agentAttachments?: { url: string; name: string; mimeType: string; size?: number }[],
      messageId?: string,
      serverTs?: string,
      quoted?: {
        id?: string | null;
        sender?: string | null;
        content?: string | null;
      },
    ) => {
      const ts = serverTs || getTimestamp();
      setMessages((prev) => {
        if (messageId && prev.some((m) => m.id === messageId)) return prev;
        return [
          ...prev,
          {
            id: messageId || `msg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            content: text,
            sender: "ai",
            timestamp: ts,
            agentAttachments,
            serverTs,
            ...(quoted?.content
              ? {
                  quotedMessageId: quoted.id || null,
                  quotedMessageSender: quoted.sender || null,
                  quotedMessageContent: quoted.content,
                }
              : {}),
          },
        ];
      });
      setChatStartedAt(
        (prev) =>
          prev ??
          new Date().toLocaleString("pt-BR", {
            dateStyle: "short",
            timeStyle: "short",
          }),
      );

      if (!isOpenRef.current) {
        playNotificationSound();
        showBrowserNotification("Nova mensagem - Tecfag", text);
        setUnreadCount((c) => c + 1);
      } else if (typeof document !== "undefined" && document.hidden) {
        playNotificationSound();
        showBrowserNotification("Nova mensagem - Tecfag", text);
      }
    },
    [],
  );

  const connectWebSocket = useCallback(() => {
    if (!mountedRef.current) return;
    if (
      wsRef.current?.readyState === WebSocket.OPEN ||
      wsRef.current?.readyState === WebSocket.CONNECTING
    ) {
      return;
    }

    const cookieId = getOrCreateCookieId();
    const wsUrl = buildLiveChatWsUrl(cookieId);

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        if (wsRef.current !== ws || !mountedRef.current) return;
        setIsConnected(true);
        const currentHref = window.location?.href || "";
        const currentTitle = document.title || "";
        const entry = getBrowserSiteEntry();
        const entryParams = (() => {
          try {
            return new URL(entry?.url || currentHref).searchParams;
          } catch {
            return new URLSearchParams(window.location?.search || "");
          }
        })();
        ws.send(
          JSON.stringify({
            type: "VISITOR_CONNECT",
            cookieId,
            currentPage: currentHref,
            pageTitle: currentTitle,
            referrer: document.referrer || undefined,
            entryUrl: entry?.url || undefined,
            entryTitle: entry?.title || undefined,
            entryReferrer: entry?.referrer || undefined,
            utmSource: entryParams.get("utm_source") || undefined,
            utmMedium: entryParams.get("utm_medium") || undefined,
            utmCampaign: entryParams.get("utm_campaign") || undefined,
            siteContext: {
              entry: entry
                ? { url: entry.url, title: entry.title, referrer: entry.referrer || undefined }
                : undefined,
              page: { url: currentHref, title: currentTitle, referrer: document.referrer || undefined },
            },
          }),
        );
        const savedIdentity = visitorIdentityRef.current;
        if (savedIdentity.name || savedIdentity.email || savedIdentity.phone) {
          ws.send(
            JSON.stringify({
              type: "SET_VISITOR_NAME",
              name: savedIdentity.name || undefined,
              email: savedIdentity.email || undefined,
              phone: savedIdentity.phone ? normalizeBrPhoneDigits(savedIdentity.phone) : undefined,
            }),
          );
        }
        flushOutbox(true);

        if (heartbeatIntervalRef.current) clearInterval(heartbeatIntervalRef.current);
        heartbeatIntervalRef.current = setInterval(() => {
          if (!isWithinBlackNovemberWindow()) {
            setIsBlackNovember(false);
          }
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "HEARTBEAT" }));
          }
        }, 30000);
      };

      ws.onmessage = (event) => {
        if (wsRef.current !== ws || !mountedRef.current) return;
        try {
          const data = JSON.parse(event.data);

          switch (data.type) {
            case "message_ack": {
              if (typeof data.messageId === "string" && getOutbox().acknowledge(data.messageId)) {
                setMessages((previous) =>
                  previous.map((message) =>
                    message.id === data.messageId
                      ? { ...message, deliveryState: "confirmed" }
                      : message,
                  ),
                );
                flushOutbox(true);
              }
              break;
            }
            case "product_inquiry_rejected": {
              if (typeof data.messageId === "string") {
                getOutbox().fail(data.messageId);
                syncPendingMessages();
              }
              break;
            }
            case "CONNECTED": {
              if (data.pageviewId) {
                currentPageviewIdRef.current = data.pageviewId;
              }
              if (typeof data.blackNovemberActive === "boolean") {
                const active = data.blackNovemberActive && isWithinBlackNovemberWindow();
                setIsBlackNovember(active);
                try {
                  localStorage.setItem(BLACK_NOVEMBER_STORAGE_KEY, String(active));
                } catch {}
              }
              break;
            }
            case "BLACK_NOVEMBER_STATUS": {
              if (typeof data.active === "boolean") {
                const active = data.active && isWithinBlackNovemberWindow();
                setIsBlackNovember(active);
                try {
                  localStorage.setItem(BLACK_NOVEMBER_STORAGE_KEY, String(active));
                } catch {}
              }
              break;
            }
            case "PAGEVIEW_RECORDED":
            case "pageview_recorded":
            case "VISITOR_PAGE_UPDATE": {
              if (data.pageviewId) {
                currentPageviewIdRef.current = data.pageviewId;
              }
              break;
            }
            case "PROACTIVE_PULSE": {
              if (!isOpenRef.current) {
                playNotificationSound();
                setUnreadCount((c) => c + 1);
              }
              break;
            }
            case "PROACTIVE_MESSAGE": {
              if (!isOpenRef.current) {
                setUnreadCount((c) => c + 1);
              }
              break;
            }
            case "TYPING_START":
              setIsTyping(true);
              break;
            case "TYPING_STOP":
              setIsTyping(false);
              break;
            case "typing":
              setIsTyping(Boolean(data.isTyping));
              break;
            case "CHAT_REPLY": {
              setIsTyping(false);
              if (data.chatId) {
                setChatId(data.chatId);
                try {
                  sessionStorage.setItem(STORAGE_KEY_CHAT_ID, data.chatId);
                } catch {}
              }
              const replyContent: string = data.content || "";
              const incomingAttachments:
                | { url: string; name: string; mimeType: string; size?: number }[]
                | undefined = data.attachments;
              const isInternalLog =
                /^\[[A-Z0-9_]+[:\]]/s.test(replyContent.trim()) &&
                !/^\[AUDIO:/i.test(replyContent.trim()) &&
                !/^\[(?:AGENT_ATTACHMENTS|Anexo_Cliente|IMAGE):/i.test(replyContent.trim());
              if (isInternalLog && !incomingAttachments?.length) break;

              const quotedPayload =
                typeof data.quotedMessageContent === "string" && data.quotedMessageContent.trim()
                  ? {
                      id: typeof data.quotedMessageId === "string" ? data.quotedMessageId : null,
                      sender:
                        typeof data.quotedMessageSender === "string"
                          ? data.quotedMessageSender
                          : null,
                      content: data.quotedMessageContent,
                    }
                  : undefined;

              const isHistory = data.fromHistory === true;
              if (isHistory) {
                setMessages((prev) => {
                  const alreadyExists = prev.some((m) => {
                    if (data.messageId && m.id === data.messageId) return true;
                    if (m.sender !== "ai" && m.sender !== "agent") return false;
                    if (m.content !== replyContent) return false;
                    if (data.timestamp && m.serverTs) return m.serverTs === data.timestamp;
                    return true;
                  });
                  if (alreadyExists) return prev;
                  return [
                    ...prev,
                    {
                      id: data.messageId || `msg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
                      content: replyContent,
                      sender: data.sender === "visitor" ? "visitor" : "ai",
                      timestamp: data.timestamp || getTimestamp(),
                      serverTs: data.timestamp ?? undefined,
                      agentAttachments: incomingAttachments,
                      ...(quotedPayload
                        ? {
                            quotedMessageId: quotedPayload.id,
                            quotedMessageSender: quotedPayload.sender,
                            quotedMessageContent: quotedPayload.content,
                          }
                        : {}),
                      ...(data.sender === "visitor" ? { deliveryState: "confirmed" as const } : {}),
                    },
                  ];
                });
              } else {
                addAgentMessage(
                  replyContent,
                  incomingAttachments,
                  data.messageId,
                  data.timestamp,
                  quotedPayload,
                );
              }
              break;
            }
            case "AGENT_JOINED":
            case "operator_joined":
            case "SYSTEM_MESSAGE": {
              setIsTyping(false);
              if (data.operatorName) {
                setOperatorName(data.operatorName);
                try {
                  sessionStorage.setItem(STORAGE_KEY_OPERATOR_NAME, data.operatorName);
                } catch {}
              }
              const sysText =
                data.message ??
                (data.operatorName
                  ? `${data.operatorName} iniciou o atendimento`
                  : data.content ?? "");
              if (!sysText) break;
              const isHistory = data.fromHistory === true;
              setMessages((prev) => {
                const alreadyExists = prev.some(
                  (m) => (m.isAgentJoined || m.sender === "system") && m.content === sysText,
                );
                if (alreadyExists) return prev;
                return [
                  ...prev,
                  {
                    id: `sys_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                    content: sysText,
                    sender: "system",
                    isSystem: true,
                    isAgentJoined: true,
                    timestamp: getTimestamp(),
                  },
                ];
              });
              if (!isHistory) {
                playNotificationSound();
                if (!isOpenRef.current) {
                  setUnreadCount((c) => c + 1);
                }
              }
              break;
            }
            case "CHAT_CLOSED": {
              setIsTyping(false);
              setOperatorName(null);
              try {
                sessionStorage.removeItem(STORAGE_KEY_OPERATOR_NAME);
              } catch {}
              addAgentMessage(data.message || "Atendimento encerrado. Obrigado pelo contato! 😊");
              break;
            }
            default:
              break;
          }
        } catch {}
      };

      ws.onclose = (event) => {
        if (wsRef.current !== ws || !mountedRef.current) return;
        setIsConnected(false);
        if (heartbeatIntervalRef.current) clearInterval(heartbeatIntervalRef.current);
        // Código 1008 = recusa definitiva do servidor (canal desativado, origem ou tenant não autorizado).
        // Não entrar em loop infinito de reconexão para não sobrecarregar o servidor.
        if (event?.code === 1008) {
          console.warn(
            "[TecfagChat] Conexão encerrada definitivamente pelo servidor (1008):",
            event.reason || "canal indisponível",
          );
          return;
        }
        reconnectTimeoutRef.current = setTimeout(() => {
          connectWebSocket();
        }, 4000);
      };

      ws.onerror = () => {
        ws.close();
      };
    } catch {}
  }, [addAgentMessage, flushOutbox, getOutbox, syncPendingMessages]);

  useEffect(() => {
    mountedRef.current = true;
    try {
      syncPendingMessages();
    } catch {}
    connectWebSocket();
    const outboxTimer = setInterval(() => flushOutbox(), 5000);

    let lastUrl = window.location?.href || "";
    let pageEntryTime = Date.now();
    let maxScrollDepth = 0;

    const onScroll = () => {
      if (typeof document === "undefined" || !document.documentElement) return;
      const el = document.documentElement;
      const scrollTop = window.scrollY || el.scrollTop || 0;
      const scrollHeight = (el.scrollHeight || 0) - (el.clientHeight || window.innerHeight || 0);
      if (scrollHeight > 0) {
        const depth = Math.min(100, Math.round((scrollTop / scrollHeight) * 100));
        if (depth > maxScrollDepth) maxScrollDepth = depth;
      }
    };
    window.addEventListener("scroll", onScroll, { passive: true });

    const flushPageTime = () => {
      const timeSpent = Math.round((Date.now() - pageEntryTime) / 1000);
      if (timeSpent < 2 || wsRef.current?.readyState !== WebSocket.OPEN) return;
      wsRef.current.send(
        JSON.stringify({
          type: "PAGEVIEW_UPDATE",
          pageviewId: currentPageviewIdRef.current || undefined,
          url: lastUrl,
          timeSpent,
          timeOnPage: timeSpent,
          scrollDepth: maxScrollDepth,
        }),
      );
    };

    const urlCheckInterval = setInterval(() => {
      const currentUrl = window.location?.href || "";
      if (currentUrl !== lastUrl) {
        flushPageTime();
        lastUrl = currentUrl;
        pageEntryTime = Date.now();
        maxScrollDepth = 0;
        currentPageviewIdRef.current = null;

        if (wsRef.current?.readyState === WebSocket.OPEN) {
          const entry = getBrowserSiteEntry();
          wsRef.current.send(
            JSON.stringify({
              type: "PAGE_UPDATE",
              url: currentUrl,
              pageTitle: document.title,
              entryUrl: entry?.url || undefined,
              entryTitle: entry?.title || undefined,
              entryReferrer: entry?.referrer || undefined,
            }),
          );
        }

        const slug = extractVtexProductSlug(currentUrl);
        if (slug) {
          setCurrentProduct({
            slug,
            displayName: slugToDisplayName(slug),
            productUrl: currentUrl,
          });
          setDismissedProductSlug(null);
        } else {
          setCurrentProduct(null);
          setDismissedProductSlug(null);
        }
      }
    }, 2000);

    const flushInterval = setInterval(flushPageTime, 30000);
    const onBeforeUnload = () => flushPageTime();
    window.addEventListener("beforeunload", onBeforeUnload);

    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") flushPageTime();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    const handleCtaClick = (e: MouseEvent) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      const target = e.target as HTMLElement | null;
      if (!target || typeof target.closest !== "function") return;
      if (target.closest("#tecfag-chat-root")) return;

      const el = target.closest("a, button, [data-cta], [data-tecfag-product-inquiry]") as HTMLElement | null;
      if (!el) return;

      const href = (el as HTMLAnchorElement).href ?? "";
      let clickType: string | null = null;

      if (el.hasAttribute?.("data-tecfag-product-inquiry")) {
        clickType = "product_view";
      } else if (/wa\.me|whatsapp/i.test(href)) {
        clickType = "whatsapp";
      } else if (/^tel:/i.test(href)) {
        clickType = "phone";
      } else if (el.dataset?.cta) {
        clickType = "cta_button";
      } else {
        const txt = (el.innerText || el.getAttribute?.("aria-label") || "").toLowerCase();
        if (/whatsapp|zap/i.test(txt)) clickType = "whatsapp";
        else if (/or[cç]amento|comprar|pedido|solicitar|falar|chat/i.test(txt)) clickType = "cta_button";
      }

      if (!clickType) return;

      ws.send(
        JSON.stringify({
          type: "CLICK_EVENT",
          clickType,
          url: window.location?.href || "",
          pageTitle: document.title || "",
          elementId: el.id || undefined,
          elementText: (el.innerText || el.getAttribute?.("aria-label") || "").slice(0, 80),
        }),
      );
    };
    document.addEventListener("click", handleCtaClick, { capture: true, passive: true });

    return () => {
      mountedRef.current = false;
      clearInterval(outboxTimer);
      flushPageTime();
      clearInterval(urlCheckInterval);
      clearInterval(flushInterval);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      document.removeEventListener("click", handleCtaClick, { capture: true });
      if (heartbeatIntervalRef.current) clearInterval(heartbeatIntervalRef.current);
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
      const socket = wsRef.current;
      wsRef.current = null;
      socket?.close();
    };
  }, [connectWebSocket, flushOutbox, syncPendingMessages]);

  const queueVisitorMessage = useCallback(
    (
      displayText: string,
      payload: Omit<PendingWidgetMessage["payload"], "messageId">,
      attachments?: Attachment[],
    ) => {
      const id = `usr_${crypto.randomUUID()}`;
      const intent = {
        id,
        createdAt: Date.now(),
        displayText,
        payload: {
          ...payload,
          type: payload.type as "CHAT_MESSAGE" | "PRODUCT_INQUIRY",
          messageId: id,
        },
      };
      setChatStartedAt(
        (prev) =>
          prev ??
          new Date().toLocaleString("pt-BR", {
            dateStyle: "short",
            timeStyle: "short",
          }),
      );
      try {
        getOutbox().enqueue(intent);
        syncPendingMessages();
        if (attachments && attachments.length > 0) {
          setMessages((prev) =>
            prev.map((m) => (m.id === id ? { ...m, attachments } : m)),
          );
        }
        flushOutbox();
        connectWebSocket();
        return true;
      } catch {
        unpersistedRef.current.set(id, intent);
        setMessages((previous) => [
          ...previous,
          {
            id,
            content: displayText,
            sender: "visitor",
            timestamp: new Date().toISOString(),
            deliveryState: "failed",
            attachments,
          },
        ]);
        return false;
      }
    },
    [getOutbox, syncPendingMessages, flushOutbox, connectWebSocket],
  );

  const retryMessage = useCallback(
    (id: string) => {
      try {
        const entry = getOutbox().snapshot().find((item) => item.id === id);
        if (entry) getOutbox().retry(id);
        else {
          const intent = unpersistedRef.current.get(id);
          if (!intent) return;
          getOutbox().enqueue(intent);
          unpersistedRef.current.delete(id);
        }
        syncPendingMessages();
        flushOutbox(true);
        connectWebSocket();
      } catch {}
    },
    [getOutbox, syncPendingMessages, flushOutbox, connectWebSocket],
  );

  const startThreePartGreeting = useCallback((name: string) => {
    setChatStarted(true);
    const ts = getTimestamp();
    const firstName = extractFirstNameForGreeting(name);
    setMessages([
      {
        id: "welcome-msg",
        content: firstName ? `Olá, ${firstName} 👋` : "Olá! 👋",
        sender: "ai",
        timestamp: ts,
      },
    ]);
    setTimeout(() => {
      setMessages((prev) => [
        ...prev,
        {
          id: `welcome-2-${Date.now()}`,
          content: "Sou o Fagner, assistente virtual da Tecfag!",
          sender: "ai",
          timestamp: getTimestamp(),
        },
      ]);
    }, 900);
    setTimeout(() => {
      setMessages((prev) => [
        ...prev,
        {
          id: `welcome-3-${Date.now()}`,
          content: "Como posso te ajudar hoje? 😊",
          sender: "ai",
          timestamp: getTimestamp(),
        },
      ]);
    }, 1800);
  }, []);

  const handleOpen = () => {
    setIsOpen(true);
    setUnreadCount(0);

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: "CLICK_EVENT",
          clickType: "chat_open",
          url: window.location?.href || "",
          elementId: "tecfag-chat-open-btn",
          elementText: "Abriu o Chat IA",
        }),
      );
    }

    if (!hasCompletePreChat && !hasActiveConversation) {
      setPreChatNameInput(visitorName);
      setPreChatEmailInput(visitorEmail);
      setPreChatPhoneInput(visitorPhone);
      setPreChatError(null);
      setPreChatMode(true);
      return;
    }

    if ((visitorName || visitorEmail || visitorPhone) && wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: "SET_VISITOR_NAME",
          name: visitorName || undefined,
          email: visitorEmail || undefined,
          phone: visitorPhone ? normalizeBrPhoneDigits(visitorPhone) : undefined,
        }),
      );
    }

    if (!chatStarted && messages.length <= 1 && visitorName) {
      startThreePartGreeting(visitorName);
    }
  };

  const handlePreChatSubmit = (rawName: string, rawEmail: string, rawPhone: string) => {
    const cleanName = rawName.trim();
    const cleanEmail = rawEmail.trim().toLowerCase();
    const cleanPhoneDigits = normalizeBrPhoneDigits(rawPhone);
    const formattedPhone = formatBrPhoneMask(cleanPhoneDigits);

    if (cleanName.length < 2) {
      setPreChatError("Informe seu nome completo para iniciar o atendimento.");
      return;
    }
    if (!isValidEmailAddress(cleanEmail)) {
      setPreChatError("Informe um e-mail válido (ex.: nome@gmail.com).");
      return;
    }
    if (!isValidBrPhone(cleanPhoneDigits)) {
      setPreChatError("Informe um telefone/WhatsApp válido com DDD (ex.: (14) 99999-9999).");
      return;
    }

    setPreChatError(null);
    setVisitorName(cleanName);
    setVisitorEmail(cleanEmail);
    setVisitorPhone(formattedPhone);
    setPreChatNameInput(cleanName);
    setPreChatEmailInput(cleanEmail);
    setPreChatPhoneInput(formattedPhone);
    setNameConfirmed(true);
    try {
      localStorage.setItem(STORAGE_KEY_VISITOR_NAME, cleanName);
      sessionStorage.setItem(STORAGE_KEY_VISITOR_NAME, cleanName);
      localStorage.setItem(STORAGE_KEY_VISITOR_EMAIL, cleanEmail);
      sessionStorage.setItem(STORAGE_KEY_VISITOR_EMAIL, cleanEmail);
      localStorage.setItem(STORAGE_KEY_VISITOR_PHONE, cleanPhoneDigits);
      sessionStorage.setItem(STORAGE_KEY_VISITOR_PHONE, cleanPhoneDigits);
      sessionStorage.setItem(STORAGE_KEY_NAME_CONFIRMED, "true");
    } catch {}
    setPreChatMode(false);

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: "SET_VISITOR_NAME",
          name: cleanName,
          email: cleanEmail,
          phone: cleanPhoneDigits,
        }),
      );
    }

    if (pendingProductInquiry) {
      const product = pendingProductInquiry;
      setPendingProductInquiry(null);
      setChatStarted(true);
      const visitorMsg = `Quero saber mais sobre ${product.displayName}`;
      const entry = getBrowserSiteEntry();
      queueVisitorMessage(visitorMsg, {
        type: "PRODUCT_INQUIRY",
        productSlug: product.slug,
        productName: product.displayName,
        productUrl: product.productUrl,
        visitorMessage: visitorMsg,
        currentPage: window.location?.href || "",
        pageTitle: document.title || "",
        ...(entry
          ? {
              entryUrl: entry.url,
              entryTitle: entry.title,
              entryReferrer: entry.referrer || undefined,
            }
          : {}),
      });
      setDismissedProductSlug(product.slug);
      return;
    }

    if (messages.length > 1) {
      setChatStarted(true);
      return;
    }

    startThreePartGreeting(cleanName);
  };

  const handleClose = () => {
    setIsOpen(false);
  };

  const handleCloseRequest = () => {
    if (messages.length === 0 || (!chatStarted && messages.length <= 1)) {
      setIsOpen(false);
      return;
    }
    setShowRestartConfirm(true);
  };

  const handleRestartConfirm = useCallback(() => {
    try {
      getOutbox().clear();
    } catch {}
    unpersistedRef.current.clear();

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "RESTART_CHAT" }));
    }

    clearStoredMessages();
    setMessages([DEFAULT_WELCOME_MESSAGE]);
    setChatStarted(false);
    setChatStartedAt(null);
    setShowRestartConfirm(false);
    setIsTyping(false);
    setOperatorName(null);
  }, [getOutbox]);

  const handleProductInquiry = useCallback(
    (product: CurrentProduct) => {
      if (!isOpen) {
        setIsOpen(true);
        setUnreadCount(0);
      }

      if (!hasCompletePreChat && !hasActiveConversation) {
        setPreChatNameInput(visitorName);
        setPreChatEmailInput(visitorEmail);
        setPreChatPhoneInput(visitorPhone);
        setPreChatError(null);
        setPendingProductInquiry(product);
        setPreChatMode(true);
        return;
      }

      if ((visitorName || visitorEmail || visitorPhone) && wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            type: "SET_VISITOR_NAME",
            name: visitorName || undefined,
            email: visitorEmail || undefined,
            phone: visitorPhone ? normalizeBrPhoneDigits(visitorPhone) : undefined,
          }),
        );
      }

      setChatStarted(true);
      const visitorMsg = `Quero saber mais sobre ${product.displayName}`;
      const entry = getBrowserSiteEntry();
      queueVisitorMessage(visitorMsg, {
        type: "PRODUCT_INQUIRY",
        productSlug: product.slug,
        productName: product.displayName,
        productUrl: product.productUrl,
        visitorMessage: visitorMsg,
        currentPage: window.location?.href || "",
        pageTitle: document.title || "",
        ...(entry
          ? {
              entryUrl: entry.url,
              entryTitle: entry.title,
              entryReferrer: entry.referrer || undefined,
            }
          : {}),
      });
      setDismissedProductSlug(product.slug);
    },
    [
      isOpen,
      hasCompletePreChat,
      hasActiveConversation,
      visitorName,
      visitorEmail,
      visitorPhone,
      queueVisitorMessage,
    ],
  );

  useEffect(() => {
    const api = {
      sendProductInquiry: (productSlug: string, productUrl: string, _msg?: string, productName?: string) => {
        handleProductInquiry({
          slug: productSlug,
          displayName: productName || slugToDisplayName(productSlug),
          productUrl: productUrl || window.location?.href || "",
        });
      },
      inquireProduct: (product: { url?: string; name?: string; sku?: string }) => {
        const url = product?.url || window.location?.href || "";
        const slug = product?.name || product?.sku || url.split("/").filter(Boolean).pop() || "Equipamento";
        handleProductInquiry({
          slug,
          displayName: product?.name || slugToDisplayName(slug),
          productUrl: url,
        });
        return true;
      },
      open: () => setIsOpen(true),
      close: () => setIsOpen(false),
    };
    (window as any).TecfagChat = api;
    (window as any).__valemChatWidget = api;

    return () => {
      delete (window as any).TecfagChat;
      delete (window as any).__valemChatWidget;
    };
  }, [handleProductInquiry]);

  const handleSendMessage = async (text: string, attachments?: Attachment[]) => {
    const attList = Array.isArray(attachments) ? attachments : [];
    if (!text && attList.length === 0) return;

    let combinedText = text || "";

    if (attList.length > 0) {
      for (const att of attList) {
        const formData = new FormData();
        formData.append("file", att.file);
        try {
          const res = await fetch(`${BACKEND_URL}/api/chat-upload`, {
            method: "POST",
            body: formData,
          });
          if (res.ok) {
            const data = await res.json();
            combinedText += `\n[Anexo_Cliente: ${data.url}]`;
          }
        } catch (e) {
          console.error("Erro no envio do anexo:", e);
        }
      }
    }

    const finalText = combinedText.trim();
    if (!finalText) return;

    const entry = getBrowserSiteEntry();
    queueVisitorMessage(
      text || finalText,
      {
        type: "CHAT_MESSAGE",
        content: finalText,
        currentPage: window.location?.href || "",
        pageTitle: document.title || "",
        ...(entry
          ? {
              entryUrl: entry.url,
              entryTitle: entry.title,
              entryReferrer: entry.referrer || undefined,
            }
          : {}),
      },
      attList.length > 0 ? attList : undefined,
    );
  };

  // ── Animation variants (idênticos ao widget legado chat-widget-pro) ──
  const cardVariants = {
    hidden: { opacity: 0, scale: 0.85, y: 20 },
    visible: {
      opacity: 1,
      scale: 1,
      y: 0,
      transition: { type: "spring" as const, stiffness: 350, damping: 25, mass: 0.8 },
    },
    exit: {
      opacity: 0,
      scale: 0.85,
      y: 20,
      transition: { duration: 0.18 },
    },
  };

  return (
    <>
      {/* ─── Janela de chat arrastável com animação spring ─── */}
      <AnimatePresence>
        {isOpen && (
          <div
            ref={chatWindowRef}
            id="tecfag-chat-window-shell"
            style={{
              position: "fixed",
              left: viewportLayout.isMobile ? 0 : chatPos.x,
              top: viewportLayout.isMobile ? viewportLayout.offsetTop : chatPos.y,
              width: viewportLayout.isMobile ? "100%" : viewportLayout.width,
              height: viewportLayout.height,
              zIndex: viewportLayout.isMobile ? 2147483647 : 2147483646,
            }}
          >
            <motion.div
              id="tecfag-chat-window"
              variants={cardVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
              style={{
                width: "100%",
                height: "100%",
                display: "flex",
                flexDirection: "column",
                overflow: "hidden",
                borderRadius: viewportLayout.isMobile ? "0px" : "16px",
                boxShadow: viewportLayout.isMobile
                  ? "none"
                  : isBlackNovember
                    ? "0 25px 60px -12px rgba(0, 0, 0, 0.55), 0 8px 24px -8px rgba(0, 0, 0, 0.25)"
                    : "0 25px 60px -12px rgba(139, 0, 0, 0.25), 0 8px 24px -8px rgba(0,0,0,0.15)",
                border: viewportLayout.isMobile
                  ? "none"
                  : isBlackNovember
                    ? "1px solid rgba(255, 255, 255, 0.22)"
                    : "1px solid hsl(0 10% 90%)",
                background: "hsl(0 0% 100%)",
              }}
            >
          {preChatMode ? (
            <div
              className="flex flex-col h-full text-white overflow-hidden shadow-2xl relative w-full flex-1"
              style={{
                background: isBlackNovember
                  ? "linear-gradient(135deg, #09090b 0%, #27272a 50%, #09090b 100%)"
                  : "linear-gradient(135deg, #7f1d1d 0%, #9a1c1c 50%, #450a0a 100%)",
                color: "white",
                display: "flex",
                flexDirection: "column",
                height: "100%",
                width: "100%",
                flex: 1,
                position: "relative",
                overflow: "hidden",
                borderRadius: viewportLayout.isMobile ? "0px" : "16px",
              }}
            >
              <button
                type="button"
                aria-label="Fechar"
                className="absolute top-4 right-4 cursor-pointer p-2 z-10"
                style={{
                  position: "absolute",
                  top: viewportLayout.isMobile ? "calc(12px + env(safe-area-inset-top, 0px))" : 14,
                  right: 14,
                  cursor: "pointer",
                  padding: 8,
                  zIndex: 10,
                  background: "transparent",
                  border: "none",
                  color: "#ffffff",
                }}
                onClick={handleClose}
              >
                <span className="text-xl font-light opacity-60 hover:opacity-100 transition-opacity" style={{ fontSize: 20, opacity: 0.78 }}>
                  ✕
                </span>
              </button>

              <div
                className="flex-1 flex flex-col items-center justify-center text-center"
                style={{
                  flex: 1,
                  minHeight: 0,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: viewportLayout.isMobile
                    ? "calc(24px + env(safe-area-inset-top, 0px)) 20px calc(24px + env(safe-area-inset-bottom, 0px))"
                    : "28px 28px 24px",
                  textAlign: "center",
                  overflowY: "auto",
                  overscrollBehavior: "contain",
                  position: "relative",
                  zIndex: 5,
                }}
              >
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: "spring", stiffness: 300, delay: 0.1 }}
                  className="bg-white/10 rounded-full flex items-center justify-center shadow-xl backdrop-blur-sm border border-white/20 overflow-hidden"
                  style={{
                    width: viewportLayout.isMobile ? 68 : 74,
                    height: viewportLayout.isMobile ? 68 : 74,
                    flexShrink: 0,
                    borderRadius: "50%",
                    overflow: "hidden",
                    marginBottom: 16,
                    boxShadow: isBlackNovember
                      ? "0 0 0 2px rgba(255,255,255,0.4), 0 12px 28px rgba(0,0,0,0.55)"
                      : "0 0 0 2px rgba(255,255,255,0.25), 0 12px 28px rgba(127,29,29,0.45)",
                  }}
                >
                  <img
                    src={activeAvatar}
                    alt="Fagner"
                    style={{
                      width: "100%",
                      height: "100%",
                      objectFit: "cover",
                      objectPosition: "top",
                      borderRadius: "50%",
                    }}
                  />
                </motion.div>

                <motion.h3
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.18 }}
                  className="font-bold tracking-tight"
                  style={{ fontSize: 22, fontWeight: 700, margin: "0 0 6px", color: "#ffffff", lineHeight: 1.2 }}
                >
                  Bem-vindo à Tecfag!
                </motion.h3>

                <motion.p
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.25 }}
                  className="text-sm leading-relaxed px-2 font-medium"
                  style={{
                    fontSize: 13.5,
                    margin: "0 0 18px",
                    lineHeight: 1.45,
                    padding: "0 6px",
                    fontWeight: 500,
                    color: isBlackNovember ? "rgba(255,255,255,0.82)" : "rgba(254,226,226,0.86)",
                  }}
                >
                  Preencha seus dados para o Fagner iniciar seu atendimento personalizado.
                </motion.p>

                <motion.form
                  initial={{ opacity: 0, y: 18 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.32 }}
                  noValidate
                  className="w-full flex flex-col gap-3 relative z-10"
                  style={{
                    width: "100%",
                    maxWidth: 360,
                    display: "flex",
                    flexDirection: "column",
                    gap: 10,
                    position: "relative",
                    zIndex: 10,
                    textAlign: "left",
                  }}
                  onSubmit={(e) => {
                    e.preventDefault();
                    handlePreChatSubmit(preChatNameInput, preChatEmailInput, preChatPhoneInput);
                  }}
                >
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <label
                      htmlFor="tecfag-prechat-name"
                      style={{
                        fontSize: 11.5,
                        fontWeight: 600,
                        color: "rgba(255,255,255,0.82)",
                        paddingLeft: 2,
                      }}
                    >
                      Nome completo *
                    </label>
                    <input
                      id="tecfag-prechat-name"
                      autoFocus={!viewportLayout.isMobile}
                      name="name"
                      type="text"
                      autoComplete="name"
                      value={preChatNameInput}
                      onChange={(e) => {
                        setPreChatNameInput(e.target.value);
                        if (preChatError) setPreChatError(null);
                      }}
                      placeholder="Digite seu nome..."
                      className={
                        isBlackNovember
                          ? "w-full bg-black/35 border border-white/25 rounded-xl text-white placeholder-white/55 focus:outline-none focus:ring-2 focus:ring-white/60 focus:bg-black/50 transition-all font-medium shadow-inner"
                          : "w-full bg-black/20 border border-white/20 rounded-xl text-white placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-red-400 focus:bg-black/30 transition-all font-medium shadow-inner"
                      }
                      style={{
                        width: "100%",
                        background: isBlackNovember ? "rgba(0,0,0,0.35)" : "rgba(0,0,0,0.22)",
                        border: "1px solid rgba(255,255,255,0.24)",
                        borderRadius: 11,
                        padding: "11px 14px",
                        color: "#ffffff",
                        fontSize: viewportLayout.isMobile ? 16 : 14,
                        fontWeight: 500,
                        outline: "none",
                      }}
                      required
                    />
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <label
                      htmlFor="tecfag-prechat-email"
                      style={{
                        fontSize: 11.5,
                        fontWeight: 600,
                        color: "rgba(255,255,255,0.82)",
                        paddingLeft: 2,
                      }}
                    >
                      E-mail *
                    </label>
                    <input
                      id="tecfag-prechat-email"
                      name="email"
                      type="email"
                      inputMode="email"
                      autoComplete="email"
                      value={preChatEmailInput}
                      onChange={(e) => {
                        setPreChatEmailInput(e.target.value);
                        if (preChatError) setPreChatError(null);
                      }}
                      placeholder="seuemail@gmail.com"
                      className={
                        isBlackNovember
                          ? "w-full bg-black/35 border border-white/25 rounded-xl text-white placeholder-white/55 focus:outline-none focus:ring-2 focus:ring-white/60 focus:bg-black/50 transition-all font-medium shadow-inner"
                          : "w-full bg-black/20 border border-white/20 rounded-xl text-white placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-red-400 focus:bg-black/30 transition-all font-medium shadow-inner"
                      }
                      style={{
                        width: "100%",
                        background: isBlackNovember ? "rgba(0,0,0,0.35)" : "rgba(0,0,0,0.22)",
                        border: "1px solid rgba(255,255,255,0.24)",
                        borderRadius: 11,
                        padding: "11px 14px",
                        color: "#ffffff",
                        fontSize: viewportLayout.isMobile ? 16 : 14,
                        fontWeight: 500,
                        outline: "none",
                      }}
                      required
                    />
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <label
                      htmlFor="tecfag-prechat-phone"
                      style={{
                        fontSize: 11.5,
                        fontWeight: 600,
                        color: "rgba(255,255,255,0.82)",
                        paddingLeft: 2,
                      }}
                    >
                      WhatsApp / Telefone com DDD *
                    </label>
                    <input
                      id="tecfag-prechat-phone"
                      name="phone"
                      type="tel"
                      inputMode="tel"
                      autoComplete="tel"
                      value={preChatPhoneInput}
                      onChange={(e) => {
                        setPreChatPhoneInput(formatBrPhoneMask(e.target.value));
                        if (preChatError) setPreChatError(null);
                      }}
                      placeholder="(14) 99999-9999"
                      className={
                        isBlackNovember
                          ? "w-full bg-black/35 border border-white/25 rounded-xl text-white placeholder-white/55 focus:outline-none focus:ring-2 focus:ring-white/60 focus:bg-black/50 transition-all font-medium shadow-inner"
                          : "w-full bg-black/20 border border-white/20 rounded-xl text-white placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-red-400 focus:bg-black/30 transition-all font-medium shadow-inner"
                      }
                      style={{
                        width: "100%",
                        background: isBlackNovember ? "rgba(0,0,0,0.35)" : "rgba(0,0,0,0.22)",
                        border: "1px solid rgba(255,255,255,0.24)",
                        borderRadius: 11,
                        padding: "11px 14px",
                        color: "#ffffff",
                        fontSize: viewportLayout.isMobile ? 16 : 14,
                        fontWeight: 500,
                        outline: "none",
                      }}
                      required
                    />
                  </div>

                  {preChatError && (
                    <div
                      role="alert"
                      style={{
                        background: "rgba(239, 68, 68, 0.24)",
                        border: "1px solid rgba(254, 202, 202, 0.55)",
                        borderRadius: 10,
                        padding: "8px 12px",
                        fontSize: 12,
                        lineHeight: 1.4,
                        color: "#fee2e2",
                        fontWeight: 500,
                      }}
                    >
                      {preChatError}
                    </div>
                  )}

                  <button
                    type="submit"
                    className="w-full font-bold rounded-xl transition-all flex items-center justify-center gap-2 hover:scale-[1.02] active:scale-[0.98]"
                    style={
                      isBlackNovember
                        ? {
                            width: "100%",
                            marginTop: 4,
                            padding: "13px 0",
                            borderRadius: 12,
                            fontWeight: 700,
                            fontSize: 15,
                            background: "linear-gradient(135deg, #ffffff 0%, #d4d4d8 100%)",
                            color: "#09090b",
                            boxShadow: "0 0 24px rgba(255,255,255,0.28)",
                            border: "none",
                            cursor: "pointer",
                          }
                        : {
                            width: "100%",
                            marginTop: 4,
                            padding: "13px 0",
                            borderRadius: 12,
                            fontWeight: 700,
                            fontSize: 15,
                            background: "#dc2626",
                            color: "#ffffff",
                            boxShadow: "0 0 20px rgba(220,38,38,0.4)",
                            border: "none",
                            cursor: "pointer",
                          }
                    }
                  >
                    Iniciar Atendimento
                  </button>
                </motion.form>
              </div>

              <div
                style={{
                  position: "absolute",
                  bottom: -96,
                  left: -80,
                  width: 256,
                  height: 256,
                  borderRadius: "50%",
                  filter: "blur(64px)",
                  pointerEvents: "none",
                  background: isBlackNovember ? "rgba(255,255,255,0.16)" : "rgba(220,38,38,0.2)",
                }}
              />
              <div
                style={{
                  position: "absolute",
                  top: -96,
                  right: -80,
                  width: 256,
                  height: 256,
                  borderRadius: "50%",
                  filter: "blur(64px)",
                  pointerEvents: "none",
                  background: isBlackNovember ? "rgba(255,255,255,0.12)" : "rgba(239,68,68,0.1)",
                }}
              />
            </div>
          ) : (
            <>
              {/* Header serve como alça de drag no desktop */}
              <div
                onMouseDown={handleHeaderDragStart}
                style={{ cursor: viewportLayout.isMobile ? "default" : "grab", flexShrink: 0 }}
              >
                <ChatHeader
                  onMinimize={() => setIsOpen(false)}
                  onClose={handleCloseRequest}
                  onRestart={handleCloseRequest}
                  operatorName={operatorName}
                  messages={messages.map((m) => ({
                    sender: m.sender === "visitor" ? "visitor" : "agent",
                    content: m.content,
                  }))}
                  isBlackNovember={isBlackNovember}
                  isMobile={viewportLayout.isMobile}
                  avatarSrc={activeAvatar}
                />
              </div>

              <div
                id="tecfag-messages-area"
                ref={scrollRef}
                className="flex-1 overflow-y-auto px-4 py-4 chat-scrollbar relative"
                style={{
                  background: isBlackNovember
                    ? "linear-gradient(180deg, hsl(0 0% 100%) 0%, hsl(0 0% 93%) 100%)"
                    : "linear-gradient(180deg, hsl(0 0% 100%) 0%, hsl(0 73% 97%) 100%)",
                  minHeight: 0,
                  flex: "1 1 0%",
                  overflowY: "auto",
                  overscrollBehavior: "contain",
                  padding: "16px",
                }}
              >
                {chatStartedAt && (
                  <div style={{ textAlign: "center", marginBottom: "12px" }}>
                    <span
                      style={{
                        display: "inline-block",
                        background: "rgba(0,0,0,0.06)",
                        borderRadius: "20px",
                        padding: "3px 12px",
                        fontSize: "10px",
                        color: "#888",
                        fontWeight: 500,
                        letterSpacing: "0.01em",
                      }}
                    >
                      Conversa iniciada em {chatStartedAt}
                    </span>
                  </div>
                )}

                {messages.map((msg) => (
                  <ChatBubble
                    key={msg.id}
                    message={msg}
                    isBlackNovember={isBlackNovember}
                    highlighted={highlightedMessageId === msg.id}
                    onJumpToMessage={handleJumpToMessage}
                    onRetry={retryMessage}
                    onSelectRating={(rating) => {
                      if (wsRef.current?.readyState === WebSocket.OPEN) {
                        wsRef.current.send(JSON.stringify({ type: "NPS_RATING", rating }));
                      }
                    }}
                  />
                ))}

                <AnimatePresence>
                  {isTyping && <TypingIndicator isBlackNovember={isBlackNovember} />}
                </AnimatePresence>

                {/* ── Banner de produto contextual VTEX (/slug/p) ── */}
                <AnimatePresence mode="wait">
                {currentProduct && !preChatMode && dismissedProductSlug !== currentProduct.slug && (
                  <motion.div
                    key={currentProduct.slug}
                    initial={{ opacity: 0, y: 10, scale: 0.97 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 6, scale: 0.97 }}
                    transition={{ duration: 0.22, ease: "easeOut" }}
                    style={{ marginTop: 12, marginBottom: 4, paddingLeft: 2, paddingRight: 2 }}
                  >
                    <button
                      type="button"
                      onClick={() => handleProductInquiry(currentProduct)}
                      title={`Quero saber mais sobre ${currentProduct.displayName}`}
                      onMouseEnter={(e) => {
                        (e.currentTarget as HTMLButtonElement).style.transform = "scale(1.015)";
                      }}
                      onMouseLeave={(e) => {
                        (e.currentTarget as HTMLButtonElement).style.transform = "scale(1)";
                      }}
                      style={{
                        width: "100%",
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        padding: "11px 14px",
                        background: isBlackNovember
                          ? "linear-gradient(135deg, #09090b 0%, #27272a 60%, #18181b 100%)"
                          : "linear-gradient(135deg, #7f1d1d 0%, #b91c1c 60%, #7f1d1d 100%)",
                        border: "1px solid rgba(255,255,255,0.16)",
                        borderRadius: 14,
                        cursor: "pointer",
                        boxShadow: isBlackNovember
                          ? "0 4px 18px -4px rgba(0,0,0,0.45), 0 1px 4px rgba(0,0,0,0.1)"
                          : "0 4px 18px -4px rgba(139,0,0,0.45), 0 1px 4px rgba(0,0,0,0.1)",
                        color: "#fff",
                        textAlign: "left",
                        transition: "all 0.15s ease",
                        outline: "none",
                      }}
                    >
                      <span
                        style={{
                          flexShrink: 0,
                          width: 32,
                          height: 32,
                          borderRadius: 8,
                          background: "rgba(255,255,255,0.15)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="white"
                          strokeWidth="2.2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <circle cx="11" cy="11" r="8" />
                          <path d="m21 21-4.35-4.35" />
                        </svg>
                      </span>

                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span
                          style={{
                            display: "block",
                            fontSize: 10,
                            fontWeight: 600,
                            letterSpacing: "0.06em",
                            color: "rgba(255,255,255,0.7)",
                            textTransform: "uppercase",
                            marginBottom: 1,
                          }}
                        >
                          Clique e pergunte ao Fagner
                        </span>
                        <span
                          style={{
                            display: "block",
                            fontSize: 13,
                            fontWeight: 700,
                            color: "#fff",
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            lineHeight: 1.3,
                          }}
                        >
                          Quero saber mais sobre {currentProduct.displayName}
                        </span>
                      </span>

                      <span style={{ flexShrink: 0, opacity: 0.8 }}>
                        <ArrowRight size={14} />
                      </span>
                    </button>
                  </motion.div>
                )}
                </AnimatePresence>
              </div>

              <ChatInput
                onSend={handleSendMessage}
                onSendMessage={handleSendMessage}
                isBlackNovember={isBlackNovember}
                isMobile={viewportLayout.isMobile}
              />

              {/* ── Modal de confirmação de reinicialização ── */}
              <AnimatePresence>
              {showRestartConfirm && (
                <motion.div
                  key="restart-overlay"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.18 }}
                  style={{
                    position: "absolute",
                    inset: 0,
                    zIndex: 20,
                    background: "rgba(10,0,0,0.65)",
                    backdropFilter: "blur(6px)",
                    WebkitBackdropFilter: "blur(6px)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    borderRadius: viewportLayout.isMobile ? "0px" : "16px",
                    padding: "24px",
                  }}
                >
                  <motion.div
                    initial={{ scale: 0.82, opacity: 0, y: 12 }}
                    animate={{ scale: 1, opacity: 1, y: 0 }}
                    exit={{ scale: 0.82, opacity: 0, y: 12 }}
                    transition={{ type: "spring", stiffness: 340, damping: 24 }}
                    style={{
                      background: "#fff",
                      borderRadius: "20px",
                      padding: "32px 28px 28px",
                      width: "100%",
                      maxWidth: "320px",
                      textAlign: "center",
                      boxShadow:
                        "0 24px 60px -8px rgba(139,0,0,0.35), 0 8px 24px -4px rgba(0,0,0,0.18)",
                    }}
                  >
                    <div
                      style={{
                        width: 56,
                        height: 56,
                        background: isBlackNovember
                          ? "linear-gradient(135deg, #09090b, #3f3f46)"
                          : "linear-gradient(135deg, #7f1d1d, #dc2626)",
                        borderRadius: "50%",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        margin: "0 auto 20px",
                        boxShadow: isBlackNovember
                          ? "0 8px 24px -4px rgba(0,0,0,0.45)"
                          : "0 8px 24px -4px rgba(220,38,38,0.45)",
                      }}
                    >
                      <svg
                        width="24"
                        height="24"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="white"
                        strokeWidth="2.2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <polyline points="1 4 1 10 7 10" />
                        <path d="M3.51 15a9 9 0 1 0 .49-4" />
                      </svg>
                    </div>

                    <h3
                      style={{
                        fontFamily: "Inter, sans-serif",
                        fontSize: 18,
                        fontWeight: 700,
                        color: "#1a0000",
                        marginBottom: 10,
                        lineHeight: 1.3,
                      }}
                    >
                      Reiniciar atendimento?
                    </h3>

                    <p
                      style={{
                        fontFamily: "Inter, sans-serif",
                        fontSize: 14,
                        color: "#6b7280",
                        lineHeight: 1.6,
                        marginBottom: 28,
                      }}
                    >
                      Seu histórico de conversa será apagado e um novo atendimento será iniciado.
                      Seus dados ficam mantidos.
                    </p>

                    <div style={{ display: "flex", gap: 12 }}>
                      <button
                        type="button"
                        onClick={handleRestartConfirm}
                        style={{
                          flex: 1,
                          padding: "12px 0",
                          borderRadius: 12,
                          border: "2px solid #e5e7eb",
                          background: "#f9fafb",
                          color: "#374151",
                          fontFamily: "Inter, sans-serif",
                          fontSize: 14,
                          fontWeight: 600,
                          cursor: "pointer",
                        }}
                      >
                        Sim, reiniciar
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setShowRestartConfirm(false);
                          setIsOpen(false);
                        }}
                        style={{
                          flex: 1,
                          padding: "12px 0",
                          borderRadius: 12,
                          border: "none",
                          background: isBlackNovember
                            ? "linear-gradient(135deg, #09090b, #3f3f46)"
                            : "linear-gradient(135deg, #7f1d1d, #dc2626)",
                          color: "#fff",
                          fontFamily: "Inter, sans-serif",
                          fontSize: 14,
                          fontWeight: 700,
                          cursor: "pointer",
                          boxShadow: isBlackNovember
                            ? "0 4px 16px -4px rgba(0,0,0,0.5)"
                            : "0 4px 16px -4px rgba(220,38,38,0.5)",
                        }}
                      >
                        Minimizar
                      </button>
                    </div>
                  </motion.div>
                </motion.div>
              )}
              </AnimatePresence>
            </>
          )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ─── Botão flutuante original com mola Framer Motion (alterna ícone <-> pílula a cada 3.2s) ─── */}
      {!isOpen && (
        <div ref={buttonWrapperRef} id="tecfag-fab-button">
          <div style={{ position: "relative" }}>
            <motion.button
              type="button"
              onClick={handleOpen}
              whileTap={{ scale: 0.92 }}
              animate={{ width: bubblePhase === "icon" ? 56 : 220 }}
              transition={{ type: "spring", stiffness: 350, damping: 30 }}
              style={{
                position: "relative",
                display: "flex",
                alignItems: "center",
                overflow: "hidden",
                color: "white",
                cursor: "pointer",
                border: "none",
                outline: "none",
                background: isBlackNovember
                  ? "linear-gradient(135deg, #09090b 0%, #27272a 55%, #52525b 100%)"
                  : "linear-gradient(135deg, #7f1d1d, #dc2626)",
                boxShadow: isBlackNovember
                  ? "0 8px 32px -4px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.22)"
                  : "0 8px 32px -4px rgba(139, 0, 0, 0.5)",
                borderRadius: "9999px",
                height: "56px",
                maxWidth: "calc(100vw - 32px)",
                padding: 0,
              }}
              aria-label="Abrir chat"
            >
              <AnimatePresence mode="wait">
              {bubblePhase === "icon" ? (
                <motion.span
                  key="icon"
                  initial={{ opacity: 0, scale: 0.7 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.7 }}
                  transition={{ duration: 0.22, ease: "easeOut" }}
                  style={{
                    position: "absolute",
                    inset: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <MessageCircle size={24} />
                </motion.span>
              ) : (
                <motion.span
                  key="pill"
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -10 }}
                  transition={{ duration: 0.28, ease: "easeOut", delay: 0.05 }}
                  style={{
                    position: "absolute",
                    inset: 0,
                    display: "flex",
                    alignItems: "center",
                    paddingLeft: "8px",
                    paddingRight: "16px",
                    height: "100%",
                  }}
                >
                  <span
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: "50%",
                      overflow: "hidden",
                      flexShrink: 0,
                      marginRight: "10px",
                      boxShadow: "0 0 0 2px rgba(255,255,255,0.3)",
                      display: "inline-flex",
                    }}
                  >
                    <img
                      src={activeAvatar}
                      alt="Fagner"
                      style={{
                        width: "100%",
                        height: "100%",
                        objectFit: "cover",
                        objectPosition: "top",
                      }}
                    />
                  </span>
                  <span
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      lineHeight: 1.2,
                      overflow: "hidden",
                      whiteSpace: "nowrap",
                      textAlign: "left",
                    }}
                  >
                    <span
                      style={{
                        fontSize: 12,
                        fontWeight: 600,
                        letterSpacing: "0.03em",
                        color: "rgba(255,255,255,0.95)",
                      }}
                    >
                      Falar com atendente
                    </span>
                    <span style={{ fontSize: 10, color: "rgba(255,255,255,0.7)" }}>
                      Fagner • Online agora
                    </span>
                  </span>
                </motion.span>
              )}
              </AnimatePresence>
            </motion.button>

            {unreadCount > 0 && (
              <span
                style={{
                  position: "absolute",
                  top: -4,
                  right: -4,
                  width: 20,
                  height: 20,
                  borderRadius: "50%",
                  background: "#facc15",
                  color: isBlackNovember ? "#09090b" : "#7f1d1d",
                  fontSize: 10,
                  fontWeight: 700,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  boxShadow: "0 0 0 2px white",
                  zIndex: 20,
                }}
              >
                {unreadCount}
              </span>
            )}
          </div>
        </div>
      )}
    </>
  );
};

export default ChatWidget;

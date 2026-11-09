import React, { useState, useEffect, useRef, useCallback } from "react";
import { X, ArrowRight } from "lucide-react";
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

// ─── Campanha Sazonal: Black November 2026 ────────────────────────────────────
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
  return false;
}

const COOKIE_KEY = "tecfag_visitor_id";
const STORAGE_KEY_MESSAGES = "tecfag_chat_messages";
const STORAGE_KEY_CHAT_ID = "tecfag_chat_id";
const STORAGE_KEY_VISITOR_NAME = "tecfag_visitor_name";
const STORAGE_KEY_NAME_CONFIRMED = "tecfag_name_confirmed";
const STORAGE_KEY_IS_OPEN = "tecfag_chat_is_open";
const STORAGE_KEY_OPERATOR_NAME = "tecfag_operator_name";
const STORAGE_KEY_LAST_ACTIVITY = "tecfag_chat_last_activity";

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

const DEFAULT_WELCOME_MESSAGE: Message = {
  id: "welcome-msg",
  content: "Sou o Fagner, Especialista em automações industriais! Como posso te ajudar hoje? 😊",
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

// ─── Posição inicial da janela de chat (canto inferior esquerdo) ──────────────
const CHAT_W = 380;
const CHAT_H = 440;
const CHAT_MARGIN = 24;

function getInitialChatPos() {
  const innerH = typeof window !== "undefined" && window.innerHeight ? window.innerHeight : 800;
  return {
    x: CHAT_MARGIN,
    y: Math.max(CHAT_MARGIN, innerH - CHAT_H - CHAT_MARGIN - 72),
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

  const [nameConfirmed, setNameConfirmed] = useState<boolean>(() => {
    try {
      return (
        sessionStorage.getItem(STORAGE_KEY_NAME_CONFIRMED) === "true" ||
        Boolean(localStorage.getItem(STORAGE_KEY_VISITOR_NAME))
      );
    } catch {
      return false;
    }
  });

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

  // ── Posição arrastável da janela de chat ──────────────────────────
  const [chatPos, setChatPos] = useState(getInitialChatPos);
  const chatPosRef = useRef(chatPos);
  const dragStartMouse = useRef({ x: 0, y: 0 });
  const dragStartPos = useRef({ x: 0, y: 0 });

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
      el.style?.setProperty?.("position", "fixed", "important");
      el.style?.setProperty?.("bottom", "24px", "important");
      el.style?.setProperty?.("left", "24px", "important");
      el.style?.setProperty?.("z-index", "99999", "important");
      el.style?.setProperty?.("transform", "none", "important");
      el.style?.setProperty?.("display", "block", "important");
      el.style?.setProperty?.("visibility", "visible", "important");
      el.style?.setProperty?.("opacity", "1", "important");
    }
  }, [isOpen, bubblePhase]);

  useEffect(() => {
    if (isOpen && chatWindowRef.current) {
      const el = chatWindowRef.current;
      el.style?.setProperty?.("position", "fixed", "important");
      el.style?.setProperty?.("left", `${chatPos.x}px`, "important");
      el.style?.setProperty?.("top", `${chatPos.y}px`, "important");
      el.style?.setProperty?.("z-index", "99999", "important");
      el.style?.setProperty?.("transform", "none", "important");
    }
  }, [isOpen, chatPos]);

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
    const onResize = () => {
      if (typeof window === "undefined" || !window.innerWidth) return;
      setChatPos((p) => ({
        x: Math.min(p.x, window.innerWidth - CHAT_W - CHAT_MARGIN),
        y: Math.min(p.y, window.innerHeight - CHAT_H - CHAT_MARGIN),
      }));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const handleHeaderDragStart = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement)?.closest?.("button, a")) return;
    e.preventDefault();

    dragStartMouse.current = { x: e.clientX, y: e.clientY };
    dragStartPos.current = { ...chatPosRef.current };

    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - dragStartMouse.current.x;
      const dy = ev.clientY - dragStartMouse.current.y;
      const nx = Math.max(0, Math.min(window.innerWidth - CHAT_W, dragStartPos.current.x + dx));
      const ny = Math.max(0, Math.min(window.innerHeight - CHAT_H, dragStartPos.current.y + dy));
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
      setBubblePhase("icon");
      setUnreadCount(0);
      setChatPos(getInitialChatPos());
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

  const addAgentMessage = useCallback(
    (
      text: string,
      agentAttachments?: { url: string; name: string; mimeType: string; size?: number }[],
      messageId?: string,
      serverTs?: string,
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
        const urlParams = new URLSearchParams(window.location?.search || "");
        ws.send(
          JSON.stringify({
            type: "VISITOR_CONNECT",
            cookieId,
            currentPage: window.location?.href || "",
            pageTitle: document.title || "",
            referrer: document.referrer || undefined,
            utmSource: urlParams.get("utm_source") || undefined,
            utmMedium: urlParams.get("utm_medium") || undefined,
            utmCampaign: urlParams.get("utm_campaign") || undefined,
          }),
        );
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
                      ...(data.sender === "visitor" ? { deliveryState: "confirmed" as const } : {}),
                    },
                  ];
                });
              } else {
                addAgentMessage(replyContent, incomingAttachments, data.messageId, data.timestamp);
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

      ws.onclose = () => {
        if (wsRef.current !== ws || !mountedRef.current) return;
        setIsConnected(false);
        if (heartbeatIntervalRef.current) clearInterval(heartbeatIntervalRef.current);
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
          wsRef.current.send(
            JSON.stringify({
              type: "PAGE_UPDATE",
              url: currentUrl,
              pageTitle: document.title,
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
    setMessages([
      {
        id: "welcome-msg",
        content: `Olá, ${name} 👋`,
        sender: "ai",
        timestamp: ts,
      },
    ]);
    setTimeout(() => {
      setMessages((prev) => [
        ...prev,
        {
          id: `welcome-2-${Date.now()}`,
          content: "Sou o Fagner, Especialista em automações industriais!",
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

    if (!visitorName && !nameConfirmed) {
      setPreChatMode(true);
      return;
    }

    if (visitorName && wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: "SET_VISITOR_NAME",
          name: visitorName,
        }),
      );
    }

    if (!chatStarted && messages.length <= 1 && visitorName) {
      startThreePartGreeting(visitorName);
    }
  };

  const handleNameSubmit = (name: string) => {
    setVisitorName(name);
    setNameConfirmed(true);
    try {
      localStorage.setItem(STORAGE_KEY_VISITOR_NAME, name);
      sessionStorage.setItem(STORAGE_KEY_VISITOR_NAME, name);
      sessionStorage.setItem(STORAGE_KEY_NAME_CONFIRMED, "true");
    } catch {}
    setPreChatMode(false);

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: "SET_VISITOR_NAME",
          name,
        }),
      );
    }

    if (pendingProductInquiry) {
      const product = pendingProductInquiry;
      setPendingProductInquiry(null);
      setChatStarted(true);
      const visitorMsg = `Quero saber mais sobre ${product.displayName}`;
      queueVisitorMessage(visitorMsg, {
        type: "PRODUCT_INQUIRY",
        productSlug: product.slug,
        productName: product.displayName,
        productUrl: product.productUrl,
        visitorMessage: visitorMsg,
        currentPage: window.location?.href || "",
        pageTitle: document.title || "",
      });
      setDismissedProductSlug(product.slug);
      return;
    }

    if (messages.length > 1) {
      setChatStarted(true);
      return;
    }

    startThreePartGreeting(name);
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

      if (!visitorName && !nameConfirmed) {
        setPendingProductInquiry(product);
        setPreChatMode(true);
        return;
      }

      setChatStarted(true);
      const visitorMsg = `Quero saber mais sobre ${product.displayName}`;
      queueVisitorMessage(visitorMsg, {
        type: "PRODUCT_INQUIRY",
        productSlug: product.slug,
        productName: product.displayName,
        productUrl: product.productUrl,
        visitorMessage: visitorMsg,
        currentPage: window.location?.href || "",
        pageTitle: document.title || "",
      });
      setDismissedProductSlug(product.slug);
    },
    [isOpen, visitorName, nameConfirmed, queueVisitorMessage],
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

    queueVisitorMessage(
      text || finalText,
      {
        type: "CHAT_MESSAGE",
        content: finalText,
        currentPage: window.location?.href || "",
        pageTitle: document.title || "",
      },
      attList.length > 0 ? attList : undefined,
    );
  };

  return (
    <>
      {/* ─── Janela de chat arrastável ─── */}
      {isOpen && (
        <div
          ref={chatWindowRef}
          id="tecfag-chat-window"
          className="chat-window-enter"
          style={{
            position: "fixed",
            left: chatPos.x,
            top: chatPos.y,
            width: CHAT_W,
            height: CHAT_H,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            borderRadius: "16px",
            boxShadow: isBlackNovember
              ? "0 25px 60px -12px rgba(0, 0, 0, 0.55), 0 8px 24px -8px rgba(0, 0, 0, 0.25)"
              : "0 25px 60px -12px rgba(139, 0, 0, 0.25), 0 8px 24px -8px rgba(0,0,0,0.15)",
            border: isBlackNovember
              ? "1px solid rgba(255, 255, 255, 0.22)"
              : "1px solid hsl(0 10% 90%)",
            background: "hsl(0 0% 100%)",
          }}
        >
          {preChatMode ? (
            <div
              className="flex flex-col h-full text-white rounded-2xl overflow-hidden shadow-2xl relative w-full flex-1"
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
              }}
            >
              <div
                className="absolute top-4 right-4 cursor-pointer p-2 z-10"
                style={{ position: "absolute", top: 16, right: 16, cursor: "pointer", padding: 8, zIndex: 10 }}
                onClick={handleClose}
              >
                <span className="text-xl font-light opacity-60 hover:opacity-100 transition-opacity" style={{ fontSize: 20, opacity: 0.7 }}>
                  ✕
                </span>
              </div>

              <div
                className="flex-1 flex flex-col items-center justify-center p-8 text-center"
                style={{
                  flex: 1,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: 32,
                  textAlign: "center",
                }}
              >
                <div
                  className="w-20 h-20 bg-white/10 rounded-full flex items-center justify-center mb-6 shadow-xl backdrop-blur-sm border border-white/20 overflow-hidden"
                  style={{
                    width: 80,
                    height: 80,
                    borderRadius: "50%",
                    overflow: "hidden",
                    marginBottom: 24,
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
                </div>

                <h3
                  className="text-2xl font-bold mb-2 tracking-tight"
                  style={{ fontSize: 24, fontWeight: 700, margin: "0 0 8px", color: "#ffffff" }}
                >
                  Bem-vindo à Tecfag!
                </h3>

                <p
                  className="text-sm mb-8 leading-relaxed px-2 font-medium"
                  style={{
                    fontSize: 14,
                    marginBottom: 32,
                    lineHeight: 1.6,
                    padding: "0 8px",
                    fontWeight: 500,
                    color: isBlackNovember ? "rgba(255,255,255,0.82)" : "rgba(254,226,226,0.8)",
                  }}
                >
                  Fagner está pronto para te atender. Como podemos te chamar?
                </p>

                <form
                  className="w-full flex flex-col gap-4 relative z-10"
                  style={{ width: "100%", display: "flex", flexDirection: "column", gap: 16, position: "relative", zIndex: 10 }}
                  onSubmit={(e) => {
                    e.preventDefault();
                    const fd = new FormData(e.currentTarget);
                    const name = (fd.get("name") as string) || "";
                    if (name.trim()) handleNameSubmit(name.trim());
                  }}
                >
                  <input
                    autoFocus
                    name="name"
                    placeholder="Digite seu nome..."
                    className={
                      isBlackNovember
                        ? "w-full bg-black/35 border border-white/25 rounded-xl px-5 py-4 text-white placeholder-white/55 focus:outline-none focus:ring-2 focus:ring-white/60 focus:bg-black/50 transition-all font-medium shadow-inner"
                        : "w-full bg-black/20 border border-white/20 rounded-xl px-5 py-4 text-white placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-red-400 focus:bg-black/30 transition-all font-medium shadow-inner"
                    }
                    style={{
                      width: "100%",
                      background: isBlackNovember ? "rgba(0,0,0,0.35)" : "rgba(0,0,0,0.22)",
                      border: "1px solid rgba(255,255,255,0.22)",
                      borderRadius: 12,
                      padding: "14px 20px",
                      color: "#ffffff",
                      fontSize: 14,
                      fontWeight: 500,
                      outline: "none",
                    }}
                    required
                  />
                  <button
                    type="submit"
                    className="w-full font-bold py-4 rounded-xl transition-all flex items-center justify-center gap-2 hover:scale-[1.02] active:scale-[0.98]"
                    style={
                      isBlackNovember
                        ? {
                            width: "100%",
                            padding: "14px 0",
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
                            padding: "14px 0",
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
                </form>
              </div>
            </div>
          ) : (
            <>
              {/* Header serve como alça de drag */}
              <div onMouseDown={handleHeaderDragStart} style={{ cursor: "grab" }}>
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
                  minHeight: "300px",
                  flex: "1 1 0%",
                  overflowY: "auto",
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
                    onRetry={retryMessage}
                    onSelectRating={(rating) => {
                      if (wsRef.current?.readyState === WebSocket.OPEN) {
                        wsRef.current.send(JSON.stringify({ type: "NPS_RATING", rating }));
                      }
                    }}
                  />
                ))}

                {isTyping && <TypingIndicator isBlackNovember={isBlackNovember} />}

                {/* ── Banner de produto contextual VTEX (/slug/p) ── */}
                {currentProduct && !preChatMode && dismissedProductSlug !== currentProduct.slug && (
                  <div
                    key={currentProduct.slug}
                    style={{ marginTop: 12, marginBottom: 4, paddingLeft: 2, paddingRight: 2 }}
                  >
                    <button
                      type="button"
                      onClick={() => handleProductInquiry(currentProduct)}
                      title={`Quero saber mais sobre ${currentProduct.displayName}`}
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
                  </div>
                )}
              </div>

              <ChatInput
                onSend={handleSendMessage}
                onSendMessage={handleSendMessage}
                isBlackNovember={isBlackNovember}
              />

              {/* ── Modal de confirmação de reinicialização ── */}
              {showRestartConfirm && (
                <div
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
                    borderRadius: "16px",
                    padding: "24px",
                  }}
                >
                  <div
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
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ─── Botão flutuante original (alterna ícone <-> pílula a cada 3.2s) ─── */}
      {!isOpen && (
        <div ref={buttonWrapperRef} id="tecfag-fab-button">
          <div style={{ position: "relative" }}>
            <button
              type="button"
              onClick={handleOpen}
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
                width: bubblePhase === "icon" ? 56 : 220,
                padding: 0,
                transition: "width 0.32s cubic-bezier(0.22, 1, 0.36, 1)",
              }}
              aria-label="Abrir chat"
            >
              {bubblePhase === "icon" ? (
                <span
                  style={{
                    position: "absolute",
                    inset: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="24"
                    height="24"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
                  </svg>
                </span>
              ) : (
                <span
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
                </span>
              )}
            </button>

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

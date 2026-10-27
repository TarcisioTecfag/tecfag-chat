import React, { useState, useEffect, useRef, useCallback } from "react";
import { X, ArrowRight } from "lucide-react";
import { ChatHeader } from "./ChatHeader";
import { ChatBubble, Message } from "./ChatBubble";
import { ChatInput } from "./ChatInput";
import { TypingIndicator } from "./TypingIndicator";
import {
  playNotificationSound,
  requestNotificationPermission,
  showBrowserNotification,
} from "./notifications";
import { AVATAR_URL, BACKEND_URL, buildLiveChatWsUrl } from "../../config";

const COOKIE_KEY = "tecfag_visitor_id";
const STORAGE_KEY_MESSAGES = "tecfag_chat_messages";
const STORAGE_KEY_CHAT_ID = "tecfag_chat_id";
const STORAGE_KEY_MODULE_SELECTED = "tecfag_module_selected";
const STORAGE_KEY_VISITOR_NAME = "tecfag_visitor_name";
const STORAGE_KEY_NAME_CONFIRMED = "tecfag_name_confirmed";
const STORAGE_KEY_IS_OPEN = "tecfag_chat_is_open";
const STORAGE_KEY_OPERATOR_NAME = "tecfag_operator_name";
const STORAGE_KEY_LAST_ACTIVITY = "tecfag_chat_last_activity";

const SESSION_TTL_MS = 2 * 60 * 60 * 1000;

(function cleanupExpiredSession() {
  try {
    const lastActivity = sessionStorage.getItem(STORAGE_KEY_LAST_ACTIVITY);
    if (lastActivity && Date.now() - Number(lastActivity) > SESSION_TTL_MS) {
      sessionStorage.removeItem(STORAGE_KEY_MESSAGES);
      sessionStorage.removeItem(STORAGE_KEY_CHAT_ID);
      sessionStorage.removeItem(STORAGE_KEY_MODULE_SELECTED);
      sessionStorage.removeItem(STORAGE_KEY_VISITOR_NAME);
      sessionStorage.removeItem(STORAGE_KEY_NAME_CONFIRMED);
      sessionStorage.removeItem(STORAGE_KEY_IS_OPEN);
      sessionStorage.removeItem(STORAGE_KEY_OPERATOR_NAME);
      sessionStorage.removeItem(STORAGE_KEY_LAST_ACTIVITY);
    }
  } catch {
    // ignore storage errors
  }
})();

function getOrCreateCookieId(): string {
  let id = localStorage.getItem(COOKIE_KEY);
  if (!id) {
    id = "v_" + Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
    localStorage.setItem(COOKIE_KEY, id);
  }
  return id;
}

const DEFAULT_WELCOME_MESSAGE: Message = {
  id: "welcome-msg",
  content:
    "Olá! Sou o **Fagner**, consultor técnico virtual da **Tecfag**.\n\nEstou aqui para te ajudar com orçamentos de máquinas industriais, peças de reposição ou suporte técnico. Como posso ajudar sua empresa hoje?",
  sender: "ai",
  timestamp: new Date().toISOString(),
};

export const ChatWidget: React.FC = () => {
  const [isOpen, setIsOpen] = useState<boolean>(() => {
    try {
      return sessionStorage.getItem(STORAGE_KEY_IS_OPEN) === "true";
    } catch {
      return false;
    }
  });
  const [isConnected, setIsConnected] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [showProactiveBubble, setShowProactiveBubble] = useState(false);
  const [proactiveMessage, setProactiveMessage] = useState(
    "👋 Olá! Precisa de ajuda com equipamentos industriais?",
  );

  const [visitorName, setVisitorName] = useState<string>(() => {
    try {
      return sessionStorage.getItem(STORAGE_KEY_VISITOR_NAME) || "";
    } catch {
      return "";
    }
  });

  const [nameConfirmed, setNameConfirmed] = useState<boolean>(() => {
    try {
      return sessionStorage.getItem(STORAGE_KEY_NAME_CONFIRMED) === "true";
    } catch {
      return false;
    }
  });

  const [nameInput, setNameInput] = useState("");

  const [messages, setMessages] = useState<Message[]>(() => {
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY_MESSAGES);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch (e) {
      console.error("Failed to parse saved messages", e);
    }
    return [DEFAULT_WELCOME_MESSAGE];
  });

  const [, setChatId] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem(STORAGE_KEY_CHAT_ID) || null;
    } catch {
      return null;
    }
  });

  const [, setHasSelectedModule] = useState<boolean>(() => {
    try {
      return sessionStorage.getItem(STORAGE_KEY_MODULE_SELECTED) === "true";
    } catch {
      return false;
    }
  });

  const [operatorName, setOperatorName] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem(STORAGE_KEY_OPERATOR_NAME) || null;
    } catch {
      return null;
    }
  });

  const [pendingProductInquiry, setPendingProductInquiry] = useState<{
    productSlug: string;
    productUrl: string;
    productName?: string;
    visitorMessage?: string;
  } | null>(null);

  const [showRestartConfirm, setShowRestartConfirm] = useState(false);
  const [isAvatarModalOpen, setIsAvatarModalOpen] = useState(false);

  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragOffset = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const chatWindowRef = useRef<HTMLDivElement>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const currentPageviewIdRef = useRef<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heartbeatIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  const isOpenRef = useRef(isOpen);
  const prevOpenRef = useRef(isOpen);
  useEffect(() => {
    const becameOpen = !prevOpenRef.current && isOpen;
    prevOpenRef.current = isOpen;
    isOpenRef.current = isOpen;
    if (becameOpen && wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: "CLICK_EVENT",
          url: window.location.href,
          pageTitle: document.title,
          elementId: "tecfag-fab-button",
          elementText: "Abrir chat do site",
          clickType: "widget_open",
        }),
      );
    }
  }, [isOpen]);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    if (isOpen) {
      scrollToBottom();
      setUnreadCount(0);
      setShowProactiveBubble(false);
      requestNotificationPermission();
      if (!nameConfirmed) {
        setTimeout(() => nameInputRef.current?.focus(), 200);
      }
    }
  }, [isOpen, messages, isTyping, scrollToBottom, nameConfirmed]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging || !chatWindowRef.current) return;
      const windowWidth = window.innerWidth;
      const windowHeight = window.innerHeight;
      const rect = chatWindowRef.current.getBoundingClientRect();

      let newX = e.clientX - dragOffset.current.x;
      let newY = e.clientY - dragOffset.current.y;

      newX = Math.max(0, Math.min(newX, windowWidth - rect.width));
      newY = Math.max(0, Math.min(newY, windowHeight - rect.height));

      setPosition({ x: newX, y: newY });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    if (isDragging) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    }

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging]);

  const handleDragStart = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!chatWindowRef.current) return;
    const rect = chatWindowRef.current.getBoundingClientRect();
    dragOffset.current = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
    setPosition({ x: rect.left, y: rect.top });
    setIsDragging(true);
  };

  useEffect(() => {
    if (!isOpen) {
      setPosition(null);
    }
  }, [isOpen]);

  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY_MESSAGES, JSON.stringify(messages));
      sessionStorage.setItem(STORAGE_KEY_LAST_ACTIVITY, String(Date.now()));
    } catch (e) {
      console.error("Failed to save messages to sessionStorage", e);
    }
  }, [messages]);

  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY_IS_OPEN, String(isOpen));
      sessionStorage.setItem(STORAGE_KEY_LAST_ACTIVITY, String(Date.now()));
    } catch {
      // ignore
    }
  }, [isOpen]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (!isOpenRef.current && messages.length <= 1) {
        setShowProactiveBubble(true);
      }
    }, 5000);
    return () => clearTimeout(timer);
  }, [messages.length]);

  const connectWebSocket = useCallback(() => {
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
        setIsConnected(true);
        const urlParams = new URLSearchParams(window.location.search);
        ws.send(
          JSON.stringify({
            type: "VISITOR_CONNECT",
            cookieId,
            currentPage: window.location.href,
            pageTitle: document.title,
            referrer: document.referrer || undefined,
            utmSource: urlParams.get("utm_source") || undefined,
            utmMedium: urlParams.get("utm_medium") || undefined,
            utmCampaign: urlParams.get("utm_campaign") || undefined,
          }),
        );

        if (heartbeatIntervalRef.current) clearInterval(heartbeatIntervalRef.current);
        heartbeatIntervalRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "HEARTBEAT" }));
          }
        }, 30000);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          switch (data.type) {
            case "CONNECTED":
              if (data.pageviewId) {
                currentPageviewIdRef.current = data.pageviewId;
              }
              break;

            case "PAGEVIEW_RECORDED":
            case "pageview_recorded":
              if (data.pageviewId) {
                currentPageviewIdRef.current = data.pageviewId;
              }
              break;

            case "TYPING_START":
              setIsTyping(true);
              break;

            case "TYPING_STOP":
              setIsTyping(false);
              break;

            case "CHAT_REPLY": {
              setIsTyping(false);
              if (data.chatId) {
                setChatId(data.chatId);
                sessionStorage.setItem(STORAGE_KEY_CHAT_ID, data.chatId);
              }

              const newMsg: Message = {
                id: data.messageId || "msg_" + Date.now() + Math.random().toString(36).substring(2, 7),
                content: data.content,
                sender: data.sender || "ai",
                timestamp: data.timestamp || new Date().toISOString(),
              };

              if (data.fromHistory) {
                setMessages((prev) => {
                  const alreadyExists = prev.some(
                    (m) => m.id === newMsg.id || (m.sender === newMsg.sender && m.content === newMsg.content),
                  );
                  if (alreadyExists) return prev;
                  return [...prev, newMsg];
                });
              } else {
                setMessages((prev) => {
                  if (data.messageId && prev.some((m) => m.id === data.messageId)) return prev;
                  return [...prev, newMsg];
                });

                if (data.proactive && !isOpenRef.current) {
                  setProactiveMessage(data.content);
                  setShowProactiveBubble(true);
                  setUnreadCount((prev) => prev + 1);
                  playNotificationSound();
                  showBrowserNotification("Tecfag Atendimento", data.content);
                } else if (!isOpenRef.current) {
                  setUnreadCount((prev) => prev + 1);
                  playNotificationSound();
                  showBrowserNotification("Nova mensagem - Tecfag", data.content);
                } else if (document.hidden) {
                  playNotificationSound();
                  showBrowserNotification("Nova mensagem - Tecfag", data.content);
                }
              }
              break;
            }

            case "AGENT_JOINED":
            case "SYSTEM_MESSAGE": {
              setIsTyping(false);
              if (data.operatorName) {
                setOperatorName(data.operatorName);
                try {
                  sessionStorage.setItem(STORAGE_KEY_OPERATOR_NAME, data.operatorName);
                } catch {}
              } else if (data.message) {
                const match = data.message.match(/^(.+?)\s+(?:assumiu|entrou)/i);
                if (match) {
                  setOperatorName(match[1]);
                  try {
                    sessionStorage.setItem(STORAGE_KEY_OPERATOR_NAME, match[1]);
                  } catch {}
                }
              }
              const sysText = data.message || "Um especialista entrou no atendimento.";
              const sysMsg: Message = {
                id: "sys_" + Date.now(),
                content: sysText,
                sender: "system",
                timestamp: new Date().toISOString(),
              };
              setMessages((prev) => {
                const alreadyHasSys = prev.some(
                  (m) => m.sender === "system" && m.content === sysText,
                );
                if (alreadyHasSys) return prev;
                return [...prev, sysMsg];
              });
              if (!data.fromHistory) {
                playNotificationSound();
              }
              break;
            }

            case "CHAT_CLOSED": {
              setIsTyping(false);
              setOperatorName(null);
              try {
                sessionStorage.removeItem(STORAGE_KEY_OPERATOR_NAME);
              } catch {}
              const closeMsg: Message = {
                id: "sys_" + Date.now(),
                content: data.message || "Atendimento encerrado. Obrigado pelo contato!",
                sender: "system",
                timestamp: new Date().toISOString(),
              };
              setMessages((prev) => [...prev, closeMsg]);
              break;
            }

            default:
              break;
          }
        } catch (err) {
          console.error("[TecfagChat] Error parsing WS message:", err);
        }
      };

      ws.onclose = () => {
        setIsConnected(false);
        if (heartbeatIntervalRef.current) clearInterval(heartbeatIntervalRef.current);
        reconnectTimeoutRef.current = setTimeout(() => {
          connectWebSocket();
        }, 4000);
      };

      ws.onerror = () => {
        ws.close();
      };
    } catch (error) {
      console.error("[TecfagChat] Failed to establish WebSocket connection:", error);
    }
  }, []);

  useEffect(() => {
    connectWebSocket();

    let currentUrl = window.location.href;
    let pageEntryTime = Date.now();
    let maxScrollDepth = 0;

    const handleScroll = () => {
      const scrollTop = window.scrollY || document.documentElement.scrollTop;
      const docHeight = document.documentElement.scrollHeight - window.innerHeight;
      if (docHeight > 0) {
        const pct = Math.min(100, Math.round((scrollTop / docHeight) * 100));
        if (pct > maxScrollDepth) maxScrollDepth = pct;
      }
    };
    window.addEventListener("scroll", handleScroll, { passive: true });

    const sendPageviewUpdate = () => {
      const timeSpent = Math.round((Date.now() - pageEntryTime) / 1000);
      if (
        (timeSpent > 0 || maxScrollDepth > 0) &&
        wsRef.current?.readyState === WebSocket.OPEN
      ) {
        wsRef.current.send(
          JSON.stringify({
            type: "PAGEVIEW_UPDATE",
            pageviewId: currentPageviewIdRef.current || undefined,
            url: currentUrl,
            timeOnPage: timeSpent,
            scrollDepth: maxScrollDepth,
          }),
        );
      }
    };

    const urlCheckInterval = setInterval(() => {
      if (window.location.href !== currentUrl) {
        sendPageviewUpdate();
        currentUrl = window.location.href;
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
      }
    }, 2000);

    const periodicUpdateInterval = setInterval(() => {
      sendPageviewUpdate();
    }, 30000);

    const handleBeforeUnload = () => {
      sendPageviewUpdate();
    };
    window.addEventListener("beforeunload", handleBeforeUnload);

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        sendPageviewUpdate();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    const handleCtaClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const widgetRoot = document.getElementById("tecfag-chat-root");
      if (widgetRoot && widgetRoot.contains(target)) return;

      const anchor = target.closest(
        "a, button, [role='button'], [data-cta], [data-tecfag-product-inquiry]",
      ) as HTMLElement | null;
      if (!anchor) return;

      const href = (anchor as HTMLAnchorElement).href || "";
      const text = (anchor.textContent || "").trim().slice(0, 120);
      const id = anchor.id || anchor.getAttribute("data-cta") || "";
      const classes = anchor.className || "";

      let clickType: string | null = null;

      if (anchor.hasAttribute("data-tecfag-product-inquiry")) {
        clickType = "product_view";
      } else if (href.includes("wa.me") || href.includes("whatsapp") || /whatsapp/i.test(text + id + classes)) {
        clickType = "whatsapp_click";
      } else if (href.startsWith("tel:") || /ligar|telefone/i.test(text + id)) {
        clickType = "phone_click";
      } else if (anchor.hasAttribute("data-cta")) {
        clickType = anchor.getAttribute("data-cta") || "cta_click";
      } else if (/comprar|carrinho|add.?to.?cart/i.test(text + id + classes)) {
        clickType = "add_to_cart";
      } else if (/or[cç]amento|solicitar|falar|consultar|cotar|especialista|atendimento/i.test(text + id + classes)) {
        clickType = "cta_click";
      }

      if (clickType && wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            type: "CLICK_EVENT",
            url: window.location.href,
            pageTitle: document.title,
            elementId: id || undefined,
            elementText: text || undefined,
            clickType,
          }),
        );
      }
    };
    document.addEventListener("click", handleCtaClick, { capture: true, passive: true });

    return () => {
      sendPageviewUpdate();
      clearInterval(urlCheckInterval);
      clearInterval(periodicUpdateInterval);
      window.removeEventListener("scroll", handleScroll);
      window.removeEventListener("beforeunload", handleBeforeUnload);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      document.removeEventListener("click", handleCtaClick, { capture: true });
      if (heartbeatIntervalRef.current) clearInterval(heartbeatIntervalRef.current);
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      wsRef.current?.close();
    };
  }, [connectWebSocket]);

  const sendProductInquiry = useCallback(
    (productSlug: string, productUrl: string, visitorMessage?: string, productName?: string) => {
      setIsOpen(true);
      setShowProactiveBubble(false);

      if (!nameConfirmed) {
        setPendingProductInquiry({ productSlug, productUrl, productName, visitorMessage });
        return;
      }

      const displaySlug =
        productName ||
        productSlug
          .replace(/-/g, " ")
          .replace(/\b\w/g, (c) => c.toUpperCase());

      const userMsg: Message = {
        id: "usr_" + Date.now(),
        content: visitorMessage || `Gostaria de informações sobre: **${displaySlug}**`,
        sender: "visitor",
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, userMsg]);
      setHasSelectedModule(true);
      sessionStorage.setItem(STORAGE_KEY_MODULE_SELECTED, "true");

      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            type: "PRODUCT_INQUIRY",
            messageId: "inq_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8),
            productSlug,
            productName: displaySlug,
            productUrl: productUrl || window.location.href,
            visitorMessage,
          }),
        );
      } else {
        connectWebSocket();
        setTimeout(() => {
          if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(
              JSON.stringify({
                type: "PRODUCT_INQUIRY",
                messageId: "inq_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8),
                productSlug,
                productName: displaySlug,
                productUrl: productUrl || window.location.href,
                visitorMessage,
              }),
            );
          }
        }, 1200);
      }
    },
    [nameConfirmed, connectWebSocket],
  );

  useEffect(() => {
    const api = {
      sendProductInquiry,
      inquireProduct: (product: { url?: string; name?: string; sku?: string }) => {
        const url = product?.url || window.location.href;
        const slug = product?.name || product?.sku || url.split("/").filter(Boolean).pop() || "Equipamento";
        sendProductInquiry(slug, url, undefined, product?.name);
        return true;
      },
      open: () => setIsOpen(true),
      close: () => setIsOpen(false),
    };
    (window as any).TecfagChat = api;
    (window as any).__valemChatWidget = api;

    const handleDocClick = (event: MouseEvent) => {
      const target =
        event.target instanceof Element
          ? event.target.closest<HTMLElement>("[data-tecfag-product-inquiry]")
          : null;
      if (!target) return;
      event.preventDefault();
      const url = target.dataset.productUrl || window.location.href;
      const name = target.dataset.productName || target.dataset.productSku || "Equipamento";
      sendProductInquiry(name, url, undefined, name);
    };

    document.addEventListener("click", handleDocClick);
    return () => {
      document.removeEventListener("click", handleDocClick);
      delete (window as any).TecfagChat;
      delete (window as any).__valemChatWidget;
    };
  }, [sendProductInquiry]);

  const handleConfirmName = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = nameInput.trim();
    if (!trimmed) return;

    setVisitorName(trimmed);
    setNameConfirmed(true);
    sessionStorage.setItem(STORAGE_KEY_VISITOR_NAME, trimmed);
    sessionStorage.setItem(STORAGE_KEY_NAME_CONFIRMED, "true");

    const personalizedWelcome: Message = {
      id: "welcome-msg",
      content: `Olá, **${trimmed}**! 😊 Sou o **Fagner**, consultor técnico virtual da **Tecfag**.\n\nEstou aqui para te ajudar com orçamentos de máquinas industriais, peças de reposição ou suporte técnico. Como posso ajudar você hoje?`,
      sender: "ai",
      timestamp: new Date().toISOString(),
    };
    setMessages([personalizedWelcome]);

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: "SET_VISITOR_NAME",
          name: trimmed,
        }),
      );
    }

    if (pendingProductInquiry) {
      const { productSlug, productUrl, productName, visitorMessage } = pendingProductInquiry;
      setPendingProductInquiry(null);
      setTimeout(() => {
        const displaySlug =
          productName ||
          productSlug
            .replace(/-/g, " ")
            .replace(/\b\w/g, (c) => c.toUpperCase());
        const userMsg: Message = {
          id: "usr_" + Date.now(),
          content: visitorMessage || `Gostaria de informações sobre: **${displaySlug}**`,
          sender: "visitor",
          timestamp: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, userMsg]);
        setHasSelectedModule(true);
        sessionStorage.setItem(STORAGE_KEY_MODULE_SELECTED, "true");

        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(
            JSON.stringify({
              type: "PRODUCT_INQUIRY",
              messageId: "inq_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8),
              productSlug,
              productName: displaySlug,
              productUrl: productUrl || window.location.href,
              visitorMessage,
            }),
          );
        }
      }, 300);
    }
  };

  const handleSendMessage = async (content: string, file?: File) => {
    let finalContent = content;

    if (file) {
      try {
        const formData = new FormData();
        formData.append("file", file);

        const res = await fetch(`${BACKEND_URL}/api/chat-upload`, {
          method: "POST",
          body: formData,
        });

        if (!res.ok) {
          throw new Error("Erro no upload do arquivo");
        }

        const data = await res.json();
        const fileUrl = data.url;
        const attachmentTag = `[Anexo_Cliente: ${fileUrl}]`;
        finalContent = finalContent ? `${finalContent}\n${attachmentTag}` : attachmentTag;
      } catch (err) {
        console.error("[TecfagChat] Upload error:", err);
        alert("Não foi possível enviar o arquivo. Tente novamente.");
        return;
      }
    }

    if (!finalContent.trim()) return;

    const newMsg: Message = {
      id: "usr_" + Date.now(),
      content: finalContent,
      sender: "visitor",
      timestamp: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, newMsg]);
    setHasSelectedModule(true);
    sessionStorage.setItem(STORAGE_KEY_MODULE_SELECTED, "true");

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: "CHAT_MESSAGE",
          messageId: newMsg.id,
          content: finalContent,
        }),
      );
    } else {
      connectWebSocket();
      setTimeout(() => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(
            JSON.stringify({
              type: "CHAT_MESSAGE",
              messageId: newMsg.id,
              content: finalContent,
            }),
          );
        } else {
          setMessages((prev) => [
            ...prev,
            {
              id: "err_" + Date.now(),
              content:
                "⚠️ Sem conexão com o servidor no momento. Tentando reconectar...",
              sender: "system",
              timestamp: new Date().toISOString(),
            },
          ]);
        }
      }, 1000);
    }
  };

  const handleRestartChat = () => {
    setShowRestartConfirm(true);
  };

  const confirmRestartChat = () => {
    setShowRestartConfirm(false);
    const freshWelcome: Message = {
      id: "welcome-msg-" + Date.now(),
      content: visitorName
        ? `Olá, **${visitorName}**! 😊 Sou o **Fagner**, consultor técnico virtual da **Tecfag**.\n\nEstou aqui para te ajudar com orçamentos de máquinas industriais, peças de reposição ou suporte técnico. Como posso ajudar você hoje?`
        : DEFAULT_WELCOME_MESSAGE.content,
      sender: "ai",
      timestamp: new Date().toISOString(),
    };
    setMessages([freshWelcome]);
    setChatId(null);
    setHasSelectedModule(false);
    setIsTyping(false);
    setNameConfirmed(false);
    setVisitorName("");
    setNameInput("");
    setOperatorName(null);
    sessionStorage.removeItem(STORAGE_KEY_MESSAGES);
    sessionStorage.removeItem(STORAGE_KEY_CHAT_ID);
    sessionStorage.removeItem(STORAGE_KEY_MODULE_SELECTED);
    sessionStorage.removeItem(STORAGE_KEY_VISITOR_NAME);
    sessionStorage.removeItem(STORAGE_KEY_NAME_CONFIRMED);
    sessionStorage.removeItem(STORAGE_KEY_OPERATOR_NAME);
    sessionStorage.removeItem(STORAGE_KEY_LAST_ACTIVITY);

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "RESTART_CHAT" }));
    }
  };

  return (
    <div className="font-sans antialiased">
      {/* Proactive Welcome Bubble (Bottom-Left) */}
      {!isOpen && showProactiveBubble && (
        <div
          style={{ position: "fixed", bottom: "96px", left: "24px", zIndex: 9998 }}
          className="max-w-[290px] bg-white p-4 rounded-2xl rounded-bl-sm shadow-2xl border border-slate-100 message-enter cursor-pointer group"
          onClick={() => setIsOpen(true)}
        >
          <button
            onClick={(e) => {
              e.stopPropagation();
              setShowProactiveBubble(false);
            }}
            className="absolute -top-2 -right-2 bg-neutral-900 text-white hover:bg-[#E50914] rounded-full p-1 shadow-md transition-colors"
            aria-label="Fechar aviso"
          >
            <X className="w-3.5 h-3.5" />
          </button>
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-full overflow-hidden flex-shrink-0 border-2 border-[#E50914] shadow-md">
              <img
                src={AVATAR_URL}
                alt="Fagner"
                className="w-full h-full object-cover"
              />
            </div>
            <div>
              <p className="text-xs font-bold text-slate-800 mb-0.5 flex items-center gap-1.5">
                Fagner • Tecfag
                <span className="inline-block w-2 h-2 rounded-full bg-emerald-400"></span>
              </p>
              <p className="text-xs text-slate-600 leading-relaxed group-hover:text-slate-900 transition-colors">
                {proactiveMessage}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Main Chat Window (Bottom-Left) */}
      {isOpen && (
        <div
          id="tecfag-chat-window"
          ref={chatWindowRef}
          style={
            position
              ? {
                  position: "fixed",
                  left: `${position.x}px`,
                  top: `${position.y}px`,
                  bottom: "auto",
                  right: "auto",
                  zIndex: 9999,
                }
              : { position: "fixed", bottom: "24px", left: "24px", zIndex: 9999 }
          }
          className={`w-[calc(100vw-2rem)] sm:w-[390px] h-[600px] max-h-[calc(100vh-3rem)] bg-slate-50 rounded-2xl shadow-2xl border border-slate-200/80 flex flex-col overflow-hidden ${
            !position ? "chat-window-enter" : ""
          }`}
        >
          <ChatHeader
            onClose={() => setIsOpen(false)}
            onRestart={handleRestartChat}
            isOnline={isConnected}
            operatorName={operatorName}
            onDragStart={handleDragStart}
            isDragging={isDragging}
            onAvatarClick={() => setIsAvatarModalOpen(true)}
          />

          {/* Pre-Chat Name Screen OR Chat Messages */}
          {!nameConfirmed ? (
            <div
              className="flex-1 flex flex-col items-center justify-center p-6 text-center relative"
              style={{
                background: "linear-gradient(180deg, #fafafa 0%, #f1f5f9 100%)",
              }}
            >
              <div className="relative mb-4">
                <div
                  onClick={() => setIsAvatarModalOpen(true)}
                  className="w-20 h-20 rounded-full overflow-hidden shadow-xl border-[3px] border-[#E50914] cursor-pointer hover:scale-105 transition-transform"
                  title="Ver foto em tamanho real"
                >
                  <img
                    src={AVATAR_URL}
                    alt="Fagner - Consultor Tecfag"
                    className="w-full h-full object-cover"
                  />
                </div>
                <span className="absolute bottom-0.5 right-0.5 w-4 h-4 bg-emerald-400 border-2 border-white rounded-full shadow-sm tecfag-online-badge"></span>
              </div>

              <h4 className="text-base font-bold text-slate-800 mb-1">
                Bem-vindo ao Atendimento Tecfag!
              </h4>
              <p className="text-xs text-slate-500 mb-6 max-w-[260px] leading-relaxed">
                Sou o <strong className="text-slate-700">Fagner</strong>, seu consultor técnico virtual. Para começarmos, como posso te chamar?
              </p>

              <form onSubmit={handleConfirmName} className="w-full max-w-[280px] space-y-3">
                <div className="relative">
                  <input
                    ref={nameInputRef}
                    type="text"
                    value={nameInput}
                    onChange={(e) => setNameInput(e.target.value)}
                    placeholder="Digite seu nome..."
                    maxLength={50}
                    className="w-full px-4 py-3 rounded-xl bg-white border border-slate-200 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:border-[#E50914] focus:ring-2 focus:ring-[#E50914]/15 shadow-sm transition-all"
                  />
                </div>
                <button
                  type="submit"
                  disabled={!nameInput.trim()}
                  className={`w-full py-3 px-4 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all duration-200 ${
                    nameInput.trim()
                      ? "text-white shadow-lg hover:shadow-xl active:scale-[0.98] cursor-pointer"
                      : "bg-slate-200 text-slate-400 cursor-not-allowed"
                  }`}
                  style={
                    nameInput.trim()
                      ? { background: "linear-gradient(135deg, #E50914 0%, #b8070f 100%)" }
                      : undefined
                  }
                >
                  <span>Iniciar Conversa</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </form>

              <p className="text-[10px] text-slate-400 mt-6">
                🔒 Seus dados estão seguros • Atendimento rápido
              </p>
            </div>
          ) : (
            <>
              <div
                className="flex-1 p-4 overflow-y-auto custom-scrollbar relative"
                style={{
                  backgroundImage: `radial-gradient(#cbd5e1 1px, transparent 1px)`,
                  backgroundSize: "20px 20px",
                  backgroundColor: "#f8fafc",
                }}
              >
                <div className="text-center my-2">
                  <span className="text-[11px] font-medium text-slate-400 bg-slate-100/80 backdrop-blur-sm px-3 py-1 rounded-full border border-slate-200/50">
                    Hoje
                  </span>
                </div>

                {messages.map((msg) => (
                  <ChatBubble
                    key={msg.id}
                    message={msg}
                    onSelectOption={(opt) => handleSendMessage(opt)}
                  />
                ))}

                {isTyping && <TypingIndicator />}

                <div ref={messagesEndRef} className="h-1" />
              </div>

              <ChatInput onSendMessage={handleSendMessage} disabled={false} />
            </>
          )}

          {/* Custom Restart Confirmation Modal */}
          {showRestartConfirm && (
            <div className="absolute inset-0 z-50 bg-black/50 backdrop-blur-[2px] flex items-center justify-center p-6 animate-fadeIn">
              <div className="bg-white rounded-2xl shadow-2xl border border-slate-100 p-5 w-full max-w-[300px] text-center">
                <div
                  className="w-12 h-12 rounded-full mx-auto mb-3 flex items-center justify-center text-white shadow-md"
                  style={{ background: "linear-gradient(135deg, #E50914 0%, #b8070f 100%)" }}
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="w-6 h-6"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                    />
                  </svg>
                </div>
                <h4 className="text-sm font-bold text-slate-800 mb-1">
                  Reiniciar conversa?
                </h4>
                <p className="text-xs text-slate-500 mb-4 leading-relaxed">
                  O histórico atual será limpo e uma nova conversa será iniciada do zero.
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setShowRestartConfirm(false)}
                    className="flex-1 py-2.5 px-3 rounded-xl text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 transition-all cursor-pointer"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={confirmRestartChat}
                    className="flex-1 py-2.5 px-3 rounded-xl text-xs font-bold text-white shadow-md hover:shadow-lg transition-all cursor-pointer"
                    style={{ background: "linear-gradient(135deg, #E50914 0%, #b8070f 100%)" }}
                  >
                    Sim, reiniciar
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Avatar Zoom Modal */}
          {isAvatarModalOpen && (
            <div
              className="absolute inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-6 animate-fadeIn"
              onClick={() => setIsAvatarModalOpen(false)}
            >
              <div
                className="relative max-w-[280px] w-full aspect-square rounded-2xl overflow-hidden shadow-2xl border-2 border-[#E50914] animate-scaleUp"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  onClick={() => setIsAvatarModalOpen(false)}
                  className="absolute top-3 right-3 bg-black/60 hover:bg-[#E50914] text-white rounded-full p-1.5 backdrop-blur-md transition-colors z-10 shadow-lg"
                  aria-label="Fechar foto"
                >
                  <X className="w-5 h-5" />
                </button>
                <img
                  src={AVATAR_URL}
                  alt="Fagner - Consultor Técnico Tecfag"
                  className="w-full h-full object-cover"
                />
                <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent p-4 text-left">
                  <p className="text-white font-bold text-base leading-tight">Fagner</p>
                  <p className="text-emerald-400 text-xs font-medium flex items-center gap-1.5 mt-0.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                    Consultor Técnico Virtual • Tecfag
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Floating Action Button (FAB) — Bottom-Left with Fagner Avatar */}
      {!isOpen && (
        <button
          id="tecfag-fab-button"
          onClick={() => setIsOpen(true)}
          style={{
            position: "fixed",
            bottom: "24px",
            left: "24px",
            zIndex: 9999,
            background: "linear-gradient(135deg, #0d0d0d 0%, #1a1a1a 40%, #E50914 100%)",
          }}
          className="tecfag-fab-button flex items-center gap-3 pl-2 pr-5 py-2 text-white rounded-full shadow-2xl transition-all duration-300 group cursor-pointer border-2 border-[#E50914]/60"
          aria-label="Abrir chat de atendimento Tecfag"
        >
          <div className="relative w-12 h-12 rounded-full overflow-hidden border-2 border-[#E50914] shadow-md flex-shrink-0">
            <img
              src={AVATAR_URL}
              alt="Fagner - Consultor Tecfag"
              className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-300"
            />
            <span className="absolute bottom-0 right-0 w-3.5 h-3.5 bg-emerald-400 border-2 border-[#0d0d0d] rounded-full tecfag-online-badge"></span>
          </div>

          <div className="flex flex-col items-start text-left">
            <span className="text-[11px] font-medium text-neutral-300 leading-none mb-0.5">
              Fagner • Tecfag
            </span>
            <span className="text-sm font-bold text-white tracking-wide leading-tight flex items-center gap-1.5">
              Falar Agora
            </span>
          </div>

          {unreadCount > 0 && (
            <span className="absolute -top-1.5 -right-1.5 bg-[#E50914] text-white text-xs font-bold w-6 h-6 rounded-full flex items-center justify-center border-2 border-white shadow-md animate-bounce">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </button>
      )}
    </div>
  );
};

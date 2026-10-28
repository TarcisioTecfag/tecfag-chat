import type { TrainingFrameConfig, TrainingFrameElement } from "./frame-types";
import { handleTrainingRequest } from "./frame-store";
import { installTrainingController } from "./frame-controller";

/** The parent operation never shares transport, storage or DOM with the exercise. */
export function installTrainingFrame(win: Window, config: TrainingFrameConfig) {
  const doc = win.document;
  if (doc.documentElement.dataset.trainingInstalled === config.runId) return;
  doc.documentElement.dataset.trainingInstalled = config.runId;
  const csp = doc.createElement("meta"); csp.httpEquiv = "Content-Security-Policy";
  csp.content = "connect-src 'none'; form-action 'none'; worker-src 'none'; frame-src 'none';";
  doc.head.prepend(csp);
  const trainingStyles = doc.createElement("style");
  trainingStyles.textContent = '[data-training-installed] [data-training-action="true"] { opacity: 1 !important; pointer-events: auto !important; } [data-training-installed]:not([data-training-mini="true"]) [data-crm-chat-widget] { display: none !important; }';
  doc.head.append(trainingStyles);
  // Replacing a child Window property does not change the parent Window or its Storage.
  const memoryStorage = () => {
    const values = new Map<string, string>();
    return { get length() { return values.size; }, key: (i: number) => [...values.keys()][i] ?? null,
      getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(String(k), String(v)); },
      removeItem: (k: string) => { values.delete(k); }, clear: () => values.clear() };
  };
  const local = memoryStorage(), session = memoryStorage();
  local.setItem("chat_tenant", config.tenantId); local.setItem("chat_active_view", "chat");
  local.setItem("chat_selected_id", config.store.conversations[0].id);
  local.setItem("chat_active_queue", "meus"); local.setItem("rbac_current_operator_id", config.operatorId);
  local.setItem("push_notification_dismissed", "true");
  Object.defineProperty(win, "localStorage", { value: local, configurable: true });
  Object.defineProperty(win, "sessionStorage", { value: session, configurable: true });
  Object.defineProperty(win, "indexedDB", { value: undefined, configurable: true });
  Object.defineProperty(win, "caches", { value: undefined, configurable: true });
  Object.defineProperty(win, "Notification", { value: class { static permission = "denied"; static requestPermission() { return Promise.resolve("denied"); } }, configurable: true });
  win.fetch = ((input: RequestInfo | URL, init?: RequestInit) => handleTrainingRequest(config.store, input, init)) as typeof fetch;
  class OfflineStream extends EventTarget {
    static CONNECTING = 0; static OPEN = 1; static CLOSED = 2; readyState = 1;
    onopen = null; onerror = null; onmessage = null; close() { this.readyState = 2; }
    send() { throw Error("Canal externo indisponível no treinamento."); }
  }
  Object.defineProperty(win, "EventSource", { value: OfflineStream, configurable: true });
  Object.defineProperty(win, "WebSocket", { value: OfflineStream, configurable: true });
  Object.defineProperty(win, "XMLHttpRequest", { value: class { open() { throw Error("Transporte externo bloqueado no treinamento."); } }, configurable: true });
  Object.defineProperty(win.navigator, "sendBeacon", { value: () => false, configurable: true });
  if (win.navigator.mediaDevices) Object.defineProperty(win.navigator.mediaDevices, "getUserMedia", { value: () => Promise.reject(Error("O treinamento não utiliza microfone ou câmera.")), configurable: true });
  win.open = () => null;
  doc.addEventListener("submit", (event) => event.preventDefault(), true);
  doc.addEventListener("click", (event) => {
    const anchor = (event.target as Element)?.closest?.("a[href]");
    if (!anchor) return;
    const url = new URL(anchor.getAttribute("href") || "", win.location.href);
    if (url.origin !== win.location.origin || !/^\/(chat|crm|tarefas|tasks|clientes|contatos|carteira|inicio|$)/.test(url.pathname)) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, true);
  // Notifications and identity controls are informational in an isolated exercise.
  const registration = { scope: "onboarding-memory", active: null, installing: null, waiting: null,
    update: async () => undefined, unregister: async () => true,
    pushManager: { getSubscription: async () => null, subscribe: async () => { throw Error("Notificações não são ativadas no treinamento."); } } };
  const serviceWorker = Object.assign(new EventTarget(), { controller: null, ready: Promise.resolve(registration),
    register: async () => registration, getRegistration: async () => registration, getRegistrations: async () => [] });
  Object.defineProperty(win.navigator, "serviceWorker", { value: serviceWorker, configurable: true });
  const controller = installTrainingController(win, config);
  config.onReady(controller);
}

// Runs before the normal app providers mount. Nothing is installed in the operational window.
if (typeof window !== "undefined" && window.parent !== window) {
  const frame = window.frameElement as TrainingFrameElement | null;
  if (frame?.dataset.onboardingFrame === "true") {
    const config = frame.trainingConfig;
    if (config) installTrainingFrame(window, config);
    else {
      window.fetch = async () => { throw Error("Ambiente de treinamento não inicializado."); };
      throw Error("O treinamento não recebeu um contexto válido.");
    }
  }
}

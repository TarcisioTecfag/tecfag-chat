import type { TourStep } from "./types";
import type { TrainingFrameConfig } from "./frame-types";
import { resolveTrainingTarget, TRAINING_TARGETS, PARENT_TRAINING_TARGETS } from "./frame-targets";

type Prepare = (step: TourStep) => boolean | void | Promise<boolean | void>;
/** Only the mutation taught by this step can acknowledge a save. */
export function isTrainingSaveRequest(stepId: string, path: string, method: string) {
  if (["GET", "HEAD", "OPTIONS"].includes(method)) return false;
  const expected = stepId === "wallet.template-delete" ? ["DELETE"] : ["contacts.edit", "chat.contact-edit", "crm.detail-outcomes", "crm.move-terminal", "chat.linked-deal-edit"].includes(stepId) ? ["PATCH", "PUT"] : ["POST"];
  if (!expected.includes(method)) return false;
  const rules: Record<string, RegExp> = {
    "crm.new-deal-save": /^\/api\/crm\/deals$/,
    "crm.quick-company": /^\/api\/crm\/accounts$/,
    "crm.quick-contact": /^\/api\/crm\/contacts$/,
    "tasks.new-save": /^\/api\/crm\/deals\/[^/]+\/activities$/,
    "crm.next-task": /^\/api\/crm\/deals\/[^/]+\/activities$/,
    "crm.participants": /^\/api\/crm\/deals\/[^/]+\/contacts$/,
    "crm.note": /^\/api\/crm\/deals\/[^/]+\/activities$/,
    "contacts.save": /^\/api\/contacts$/,
    "contacts.edit": /^\/api\/contacts\/[^/]+$/,
    "contacts.company-new": /^\/api\/crm\/accounts$/,
    "wallet.template-edit": /^\/api\/templates$/,
    "wallet.template-delete": /^\/api\/templates$/,
    "chat.quick-personal": /^\/api\/templates$/,
    "chat.contact-edit": /^\/api\/contacts\/[^/]+$/,
    "chat.task-create": /^\/api\/chats\/tag-task$/,
    "chat.linked-deal-edit": /^\/api\/crm\/deals\/[^/]+$/,
    "crm.detail-outcomes": /^\/api\/crm\/deals\/[^/]+$/,
    "crm.move-terminal": /^\/api\/crm\/deals\/[^/]+$/,
    "crm.bulk-transfer": /^\/api\/crm\/deals\/bulk$/,
    "crm.bulk-status": /^\/api\/crm\/deals\/bulk$/,
    "crm.bulk-fields": /^\/api\/crm\/deals\/bulk$/,
    "crm.bulk-create": /^\/api\/crm\/deals\/bulk$/,
    "crm.bulk-move": /^\/api\/crm\/deals\/bulk$/,
    "wallet.remove": /^\/api\/contacts\/update-wallet$/,
  };
  return rules[stepId]?.test(path) === true;
}
const surfaces = new WeakMap<Window, Map<string, Prepare>>();
export function registerTrainingSurface(win: Window, key: string, prepare: Prepare) {
  if (!win.document.documentElement.dataset.trainingInstalled) return () => {};
  let registry = surfaces.get(win); if (!registry) { registry = new Map(); surfaces.set(win, registry); }
  registry.set(key, prepare);
  return () => { if (registry?.get(key) === prepare) registry.delete(key); };
}
export function installTrainingController(win: Window, config: TrainingFrameConfig) {
  let step: TourStep | null = null, target: HTMLElement | null = null;
  let epoch = 0, scheduled = 0, disposed = false, measurementEnabled = false;
  let armedSave: { stepId: string; epoch: number; at: number } | null = null;
  const measure = () => {
    scheduled = 0;
    if (!step || disposed || !measurementEnabled) return;
    target = resolveTrainingTarget(win.document, step.id);
    win.document.documentElement.dataset.trainingTarget = target ? step.id : "missing";
    config.onTarget(target);
  };
  const schedule = () => { if (!scheduled) scheduled = win.requestAnimationFrame(measure); };
  const observer = new MutationObserver(schedule);
  observer.observe(win.document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style", "data-state", "hidden", "aria-hidden"] });
  win.addEventListener("resize", schedule); win.addEventListener("scroll", schedule, true);
  const interaction = (event: Event) => {
    if (!step || !target || disposed || !(event.target instanceof Element)) return;
    const spec = TRAINING_TARGETS[step.id];
    if (!spec) return;
    const source = event.target as HTMLElement;
    // Capture sees the open picker before its React handler closes the portal.
    const option = source.closest('[role="option"],[role="menuitemradio"]');
    const relevant = target === source || target.contains(source) || Boolean(option && target.getAttribute("aria-expanded") === "true");
    if (!relevant) return;
    if (spec.event === "save") {
      const submit = source.closest<HTMLButtonElement>('button[type="submit"],button[data-training-save]');
      if (event.type === "click" && submit && !submit.disabled) armedSave = { stepId: step.id, epoch, at: Date.now() };
      return;
    }
    if (spec.event === "input" && (event.type !== "input" || !String((source as HTMLInputElement).value || (source.isContentEditable ? source.textContent : "") || "").trim())) return;
    if (spec.event === "change" && !(["input", "change", "drop"].includes(event.type) || (event.type === "click" && Boolean(option || source.closest('[role="checkbox"],[role="switch"],[role="radio"],input[type="checkbox"],input[type="radio"]'))))) return;
    if ((!spec.event || spec.event === "click") && event.type !== "click") return;
    config.onReceipt(step.id, config.runId);
  };
  const kinds = ["click", "input", "change", "drop"];
  for (const kind of kinds) win.document.addEventListener(kind, interaction, true);
  const originalFetch = win.fetch;
  const wrappedFetch = (async (...args: Parameters<typeof fetch>) => {
    const requestedStep = step, armed = armedSave;
    const url = new URL(typeof args[0] === "object" && "url" in args[0] ? args[0].url : String(args[0]), win.location.href);
    const response = await originalFetch(...args);
    const method = (args[1]?.method || (typeof args[0] === "object" && "method" in args[0] ? args[0].method : "GET")).toUpperCase();
    if (!disposed && requestedStep && armed && armedSave === armed && armed.epoch === epoch && armed.stepId === requestedStep.id && step?.id === requestedStep.id && Date.now() - armed.at < 30000 && isTrainingSaveRequest(requestedStep.id, url.pathname, method) && response.ok) {
      armedSave = null;
      config.onReceipt(requestedStep.id, config.runId);
    }
    return response;
  }) as typeof fetch;
  win.fetch = wrappedFetch;
  const frame = () => new Promise<void>(resolve => win.requestAnimationFrame(() => resolve()));
  return {
    async prepare(next: TourStep) {
      const token = ++epoch;
      step = next; target = null; armedSave = null; measurementEnabled = false;
      win.document.documentElement.dataset.trainingStep = next.id;
      win.document.documentElement.dataset.trainingTarget = "preparing";
      win.document.documentElement.dataset.trainingMini = String(next.surface.startsWith("crm.mini"));
      const frameEl = win.frameElement as HTMLElement | null;
      if (frameEl?.style) {
        frameEl.style.width = next.id === "profile.mobile" ? "390px" : "100%";
      }
      if (typeof win.dispatchEvent === "function" && typeof Event !== "undefined") {
        win.dispatchEvent(new Event("resize"));
      }
      config.onTarget(null); config.onError(null);
      if (PARENT_TRAINING_TARGETS[next.id]) { win.document.documentElement.dataset.trainingTarget = next.id; return; }
      let navigated = false;
      for (let i = 0; i < 300 && !disposed && epoch === token; i++) {
        const navigation = surfaces.get(win)?.get("navigation");
        if (navigation && (await navigation(next)) !== false) { navigated = true; break; }
        await frame();
      }
      if (disposed || epoch !== token) return;
      if (!navigated) { config.onError("Não foi possível abrir o módulo deste exercício."); return; }
      if (["X", "informational_boundary"].includes(next.mode)) return;
      await frame();
      const key = next.surface.startsWith("crm.deal") || next.id === "tasks.reschedule" || next.id === "crm.file-preview" ? "deal" : next.surface.startsWith("crm.mini") ? "mini" : ["profile.entry", "profile.keyboard", "profile.mobile", "profile.notifications", "profile.quick-status", "profile.status-help"].includes(next.id) ? "navigation" : next.chapterId === "profile" ? "profile" : next.view === "commercialHome" ? "home" : next.view;
      let prepared = false;
      for (let i = 0; i < 300 && !disposed && epoch === token; i++) {
        const prepare = surfaces.get(win)?.get(key);
        if (prepare && (await prepare(next)) !== false) { prepared = true; break; }
        if (["welcome", "shell"].includes(next.surface.split(".")[0])) { prepared = true; break; }
        await frame();
      }
      if (disposed || epoch !== token) return;
      if (!prepared) { config.onError("A tela deste exercício ainda não está pronta."); return; }
      let specificPrepared = false, extraPrepared = false, selectionPrepared = false;
      for (let i = 0; i < 120 && !disposed && epoch === token; i++) {
        if (next.surface === "crm.bulk-suite" && !selectionPrepared) {
          const select = surfaces.get(win)?.get("crm.selection");
          if (select) { selectionPrepared = (await select(next)) !== false; await frame(); }
        }
        const specific = surfaces.get(win)?.get(next.surface);
        if (specific && !specificPrepared) { specificPrepared = (await specific(next)) !== false; await frame(); }
        const extraKey = next.surface === "chat.journey-modal" ? "journey" : next.id.startsWith("chat.quick-") ? "quick" : next.id.startsWith("chat.inline-") ? "inline" : next.id.startsWith("chat.linked-deal") ? "linked-deals" : ["chat.message-source", "chat.message-source-states"].includes(next.id) ? "source" : ["chat.meta-search", "chat.meta-preview", "chat.meta-send", "crm.mini-meta"].includes(next.id) ? "meta" : null;
        const extra = extraKey ? surfaces.get(win)?.get(extraKey) : null;
        if (extra && !extraPrepared) { extraPrepared = (await extra(next)) !== false; await frame(); }
        target = resolveTrainingTarget(win.document, next.id);
        if (target) break;
        await frame();
      }
      if (epoch !== token || disposed) return;
      measurementEnabled = true;
      if (!target) { config.onError("Não foi possível localizar este controle na tela. O avanço foi bloqueado."); measure(); return; }
      target.scrollIntoView({ block: "nearest", inline: "nearest" });
      measure();
    },
    dispose() {
      disposed = true; epoch++; armedSave = null;
      observer.disconnect();
      if (scheduled) win.cancelAnimationFrame(scheduled);
      win.removeEventListener("resize", schedule); win.removeEventListener("scroll", schedule, true);
      for (const kind of kinds) win.document.removeEventListener(kind, interaction, true);
      if (win.fetch === wrappedFetch) win.fetch = originalFetch;
    },
  };
}

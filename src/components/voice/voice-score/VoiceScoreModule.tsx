import React, { useEffect, useRef } from "react";
import { createVoiceScoreIcons } from "./lucide-dom";
import "./voice-score.css";

export type VoiceScoreScreen = "team" | "seller" | "call";

interface VoiceScoreModuleProps {
  activeScreen: VoiceScoreScreen;
  onScreenChange?: (screen: VoiceScoreScreen) => void;
}

const TEMPLATES: Record<string, string> = {
  "vp-overview-template": `<div class="vp-hero">
        <section class="vp-panel vp-score-panel" aria-label="Placar SPICED"><div class="vp-panel-top"><div><span class="vp-eyebrow">SCORE SPICED</span><h2 id="vp-score-owner">Equipe comercial</h2></div><span class="vp-info" data-tooltip="Média das cinco dimensões SPICED, com pesos iguais nesta prévia. Régua demonstrativa, a calibrar."><i data-lucide="info" aria-hidden="true"></i></span></div><div id="vp-gauge" class="vp-gauge"></div><div class="vp-score-scale"><span><b class="vp-status-dot vp-status-low"></b>&lt; 65 · atenção</span><span><b class="vp-status-dot vp-status-mid"></b>65–79,9</span><span><b class="vp-status-dot vp-status-high"></b>≥ 80</span></div><div class="vp-score-bottom"><span>Qualidade do diagnóstico</span><span>Escala de 0 a 100</span></div></section>
        <section class="vp-panel vp-history-panel"><div class="vp-panel-top"><div><h2 id="vp-history-title">Evolução da equipe</h2><p id="vp-history-caption">Média por intervalo · outubro de 2026</p></div><span id="vp-history-change" class="vp-delta"></span></div><div class="vp-chart-legend"><span><b class="vp-series-dot"></b><span id="vp-series-name">Equipe</span></span><span id="vp-team-legend" hidden><b class="vp-series-dash"></b>Média da equipe</span><span class="vp-chart-unit">Nota / 100</span></div><div id="vp-history" class="vp-history"></div><div id="vp-statistics" class="vp-statistics" aria-live="polite"></div></section>
      </div><section class="vp-spiced-section" aria-label="Avaliação nas cinco dimensões SPICED"><div class="vp-section-label"><h2>O que compõe essa nota</h2><span>Execução comercial · 0 a 100</span></div><div id="vp-spiced" class="vp-spiced"></div></section><div class="vp-management-grid">
        <section class="vp-panel vp-ranking-panel"><div class="vp-panel-top"><div><div class="vp-eyebrow">DESEMPENHO DA EQUIPE</div><h2>Ranking de qualidade</h2></div><span class="vp-count">Vendedores</span></div><div class="vp-rank-head" aria-hidden="true"><span>Vendedor</span><span>Nota</span><span>Evolução</span><span>Ligações</span><span></span></div><div id="vp-ranking" class="vp-ranking"></div><div class="vp-ranking-footer"><i data-lucide="mouse-pointer-2" aria-hidden="true"></i><span>Selecione um vendedor para explorar seu desempenho.</span></div></section>
        <section id="vp-spotlight" class="vp-panel vp-spotlight" aria-label="Destaques do período"></section>
      </div>
      <section class="vp-focus" aria-label="Prioridade para o gestor"><span class="vp-focus-icon"><i data-lucide="sparkles" aria-hidden="true"></i></span><div><div class="vp-focus-heading"><strong>Onde a gestão pode fazer diferença</strong><span>Leitura ilustrativa</span></div><p id="vp-focus-text"></p></div></section><footer class="vp-footer"><span><strong>TECFAG</strong> CHAT <span> / </span> Inteligência comercial</span><span>Prévia visual · pontuações e falas demonstrativas</span></footer>`,
  "vp-hero-template": `<div class="vp-hero">
        <section class="vp-panel vp-score-panel" aria-label="Placar SPICED"><div class="vp-panel-top"><div><span class="vp-eyebrow">SCORE SPICED</span><h2 id="vp-score-owner">Equipe comercial</h2></div><span class="vp-info" data-tooltip="Média das cinco dimensões SPICED, com pesos iguais nesta prévia. Régua demonstrativa, a calibrar."><i data-lucide="info" aria-hidden="true"></i></span></div><div id="vp-gauge" class="vp-gauge"></div><div class="vp-score-scale"><span><b class="vp-status-dot vp-status-low"></b>&lt; 65 · atenção</span><span><b class="vp-status-dot vp-status-mid"></b>65–79,9</span><span><b class="vp-status-dot vp-status-high"></b>≥ 80</span></div><div class="vp-score-bottom"><span>Qualidade do diagnóstico</span><span>Escala de 0 a 100</span></div></section>
        <section class="vp-panel vp-history-panel"><div class="vp-panel-top"><div><h2 id="vp-history-title">Evolução da equipe</h2><p id="vp-history-caption">Média por intervalo · outubro de 2026</p></div><span id="vp-history-change" class="vp-delta"></span></div><div class="vp-chart-legend"><span><b class="vp-series-dot"></b><span id="vp-series-name">Equipe</span></span><span id="vp-team-legend" hidden><b class="vp-series-dash"></b>Média da equipe</span><span class="vp-chart-unit">Nota / 100</span></div><div id="vp-history" class="vp-history"></div><div id="vp-statistics" class="vp-statistics" aria-live="polite"></div></section>
      </div>`,
  "vp-spiced-template": `<section class="vp-spiced-section" aria-label="Avaliação nas cinco dimensões SPICED"><div class="vp-section-label"><h2>O que compõe essa nota</h2><span>Execução comercial · 0 a 100</span></div><div id="vp-spiced" class="vp-spiced"></div></section>`,
  "vp-footer-template": `<footer class="vp-footer"><span><strong>TECFAG</strong> CHAT <span> / </span> Inteligência comercial</span><span>Prévia visual · pontuações e falas demonstrativas</span></footer>`,
};

export function VoiceScoreModule({ activeScreen, onScreenChange }: VoiceScoreModuleProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const navigateRef = useRef<((targetScreen: VoiceScoreScreen) => void) | null>(null);
  const onScreenChangeRef = useRef(onScreenChange);
  onScreenChangeRef.current = onScreenChange;

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const $ = (s: string) => root.querySelector(s) as HTMLElement | null;
    const $$ = (s: string) => Array.from(root.querySelectorAll(s)) as HTMLElement[];
    const main = $("#vp-content")!;
    const template = (id: string) => TEMPLATES[id] || "";
    const icons = () => createVoiceScoreIcons(root);

    /* ==========================================================================
       1. MINUTAGE ENGINE (TecfagMinutage)
       ========================================================================== */
    const DAY = 86400000;
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const callDay = (call: any) =>
      call.date || "2026-" + String(call.month).padStart(2, "0") + "-" + String(call.day).padStart(2, "0");

    function summarizeMinutage(callsList: any[], seller: string, day: string) {
      const selected = new Date(day + "T00:00:00Z");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(selected.getTime()) || iso(selected) !== day) {
        throw new RangeError("Data inválida");
      }
      const monday = new Date(selected.getTime() - ((selected.getUTCDay() + 6) % 7) * DAY);
      const start = iso(monday);
      const end = iso(new Date(monday.getTime() + 6 * DAY));
      const own = callsList.filter((c) => c.seller === seller);
      const total = (list: any[]) =>
        list.reduce((sum, c) => sum + (Number.isFinite(c.duration) && c.duration > 0 ? c.duration : 0), 0);
      const daily = own.filter((c) => callDay(c) === day);
      const weekly = own.filter((c) => callDay(c) >= start && callDay(c) <= end);
      return {
        day,
        start,
        end,
        daily: { seconds: total(daily), count: daily.length, target: 3600 },
        weekly: { seconds: total(weekly), count: weekly.length, target: 18000 },
      };
    }

    function formatDuration(seconds: number) {
      seconds = Math.max(0, Math.floor(seconds));
      const hours = Math.floor(seconds / 3600);
      const minutes = Math.floor((seconds % 3600) / 60);
      const remaining = seconds % 60;
      return [hours ? hours + "h" : "", minutes ? minutes + "min" : "", remaining ? remaining + "s" : ""]
        .filter(Boolean)
        .join(" ") || "0min";
    }

    const TecfagMinutage = { summarize: summarizeMinutage, duration: formatDuration, callDay };

    /* ==========================================================================
       2. PLAYER ENGINE (TecfagPlayer)
       ========================================================================== */
    const formatAudioTime = (seconds: number) =>
      Number.isFinite(seconds)
        ? Math.floor(seconds / 60).toString().padStart(2, "0") +
          ":" +
          Math.floor(seconds % 60).toString().padStart(2, "0")
        : "--:--";

    class TecfagPlayer {
      audio: HTMLAudioElement;
      host: HTMLElement;
      name: string;
      scrubbing: boolean;
      $: (sel: string) => any;

      constructor(audio: HTMLAudioElement, host: HTMLElement, { name = "", rate = 1, volume = 1 } = {}) {
        this.audio = audio;
        this.host = host;
        this.name = name;
        this.scrubbing = false;
        const ic = (n: string) => '<i data-lucide="' + n + '" aria-hidden="true"></i>';
        host.innerHTML =
          '<div class="vp-audio-console"><div class="vp-audio-file"><span class="vp-audio-cover">' +
          ic("audio-lines") +
          '</span><div><strong>Gravação completa</strong><span data-audio-file-name>Selecione um áudio para começar</span></div><input id="vx-audio-file" class="vx-sr vx-audio-file" type="file" accept="audio/*,.mp3,.wav,.m4a,.ogg,.webm,.aac,.flac"><label for="vx-audio-file" class="vx-secondary-button">' +
          ic("folder-open") +
          'Selecionar gravação</label></div><div class="vp-audio-transport"><div class="vp-audio-buttons"><button type="button" class="vp-audio-skip" data-audio-back aria-label="Voltar 10 segundos" disabled>' +
          ic("rotate-ccw") +
          '<span>10</span></button><button type="button" class="vp-audio-play" data-audio-play aria-label="Reproduzir áudio" disabled>' +
          ic("play") +
          '</button><button type="button" class="vp-audio-skip" data-audio-next aria-label="Avançar 10 segundos" disabled>' +
          ic("rotate-cw") +
          '<span>10</span></button></div><div class="vp-audio-progress"><div class="vp-audio-times"><span data-audio-current>00:00</span><span data-audio-duration>--:--</span></div><input type="range" class="vp-audio-seek" data-audio-seek aria-label="Posição da reprodução" min="0" max="1" value="0" step="0.1" disabled></div><div class="vp-audio-settings"><label><span class="vx-sr">Velocidade da reprodução</span><select data-audio-rate aria-label="Velocidade da reprodução" disabled><option value="0.75">0,75×</option><option value="1" selected>1×</option><option value="1.25">1,25×</option><option value="1.5">1,5×</option><option value="2">2×</option></select></label><div class="vp-audio-volume"><button type="button" data-audio-mute aria-label="Silenciar áudio" disabled>' +
          ic("volume-2") +
          '</button><input type="range" data-audio-volume aria-label="Volume" min="0" max="1" step="0.05" value="1" disabled></div></div></div></div>';
        this.$ = (selector: string) => host.querySelector(selector);
        this.setName(name);
        audio.playbackRate = rate;
        audio.volume = volume;
        this.$("[data-audio-play]").addEventListener("click", async () => {
          if (audio.paused) {
            try {
              await audio.play();
            } catch {
              this.message("Não foi possível iniciar o áudio. Selecione uma gravação compatível.");
            }
          } else audio.pause();
        });
        this.$("[data-audio-back]").addEventListener("click", () => {
          audio.currentTime = Math.max(0, audio.currentTime - 10);
          this.sync();
        });
        this.$("[data-audio-next]").addEventListener("click", () => {
          audio.currentTime = Math.min(audio.duration, audio.currentTime + 10);
          this.sync();
        });
        this.$("[data-audio-seek]").addEventListener("input", (e: any) => {
          if (Number.isFinite(audio.duration)) {
            audio.currentTime = Number(e.target.value);
            this.sync();
          }
        });
        this.$("[data-audio-rate]").addEventListener("change", (e: any) => {
          audio.playbackRate = Number(e.target.value);
        });
        this.$("[data-audio-volume]").addEventListener("input", (e: any) => {
          audio.volume = Number(e.target.value);
          audio.muted = false;
        });
        this.$("[data-audio-mute]").addEventListener("click", () => {
          audio.muted = !audio.muted;
        });
        [
          "loadedmetadata",
          "durationchange",
          "timeupdate",
          "play",
          "pause",
          "ended",
          "volumechange",
          "ratechange",
          "emptied",
          "error",
        ].forEach((event) => audio.addEventListener(event, () => this.sync()));
        audio.addEventListener("waiting", () => (this.host.dataset.buffering = "true"));
        audio.addEventListener("canplay", () => delete this.host.dataset.buffering);
        this.sync();
      }

      setName(name: string) {
        this.name = name;
        this.$("[data-audio-file-name]").textContent = name || "Selecione um áudio para começar";
      }

      message(text: string) {
        const note = $("#vx-audio-note");
        if (note) note.textContent = text;
      }

      sync() {
        const audio = this.audio;
        const ready = Number.isFinite(audio.duration) && audio.duration > 0 && !audio.error;
        const position = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
        this.host.dataset.ready = String(ready);
        this.host.dataset.playing = String(!audio.paused && ready);
        this.host
          .querySelectorAll("button,input[type=range],select")
          .forEach((el: any) => (el.disabled = !ready));
        const play = this.$("[data-audio-play]");
        const label = audio.paused ? "Reproduzir áudio" : "Pausar áudio";
        if (play.getAttribute("aria-label") !== label) {
          play.setAttribute("aria-label", label);
          play.innerHTML = '<i data-lucide="' + (audio.paused ? "play" : "pause") + '" aria-hidden="true"></i>';
          icons();
        }
        this.$("[data-audio-current]").textContent = formatAudioTime(position);
        this.$("[data-audio-duration]").textContent = ready ? formatAudioTime(audio.duration) : "--:--";
        const seek = this.$("[data-audio-seek]");
        seek.max = ready ? audio.duration : 1;
        seek.value = position;
        seek.style.setProperty("--seek-progress", ready ? (position / audio.duration) * 100 + "%" : "0%");
        seek.setAttribute(
          "aria-valuetext",
          formatAudioTime(position) + " de " + (ready ? formatAudioTime(audio.duration) : "áudio ainda não selecionado")
        );
        this.$("[data-audio-rate]").value = String(audio.playbackRate);
        this.$("[data-audio-volume]").value = audio.muted ? 0 : audio.volume;
        const mute = this.$("[data-audio-mute]");
        const muted = audio.muted || audio.volume === 0;
        const muteLabel = muted ? "Ativar áudio" : "Silenciar áudio";
        if (mute.getAttribute("aria-label") !== muteLabel) {
          mute.setAttribute("aria-label", muteLabel);
          mute.innerHTML = '<i data-lucide="' + (muted ? "volume-x" : "volume-2") + '" aria-hidden="true"></i>';
          icons();
        }
      }
    }

    /* ==========================================================================
       3. MOTION ENGINE (TecfagMotion)
       ========================================================================== */
    const EASE = "cubic-bezier(.2,.75,.25,1)";
    const ease = (t: number) => 1 - Math.pow(1 - t, 3);
    const numberPattern = /^([+−-]?)(\d+(?:[.,]\d+)?)(.*)$/s;

    class TecfagMotion {
      root: HTMLElement;
      main: HTMLElement;
      preference: MediaQueryList;
      revision = 0;
      ready = false;
      jobs = new Set<any>();
      frame: number | null = null;
      observer: IntersectionObserver | null = null;
      accordions = new Map<HTMLDetailsElement, { animation: Animation; open: boolean }>();

      constructor(rootEl: HTMLElement, mainEl: HTMLElement) {
        this.root = rootEl;
        this.main = mainEl;
        this.preference = matchMedia("(prefers-reduced-motion: reduce)");
        rootEl.addEventListener("click", (e) => {
          const target = e.target as HTMLElement;
          const summary = target.closest("summary");
          if (!summary || !rootEl.contains(summary)) return;
          const details = summary.parentElement as HTMLDetailsElement | null;
          if (!details || !details.matches(".vx-evaluation,.vx-formula")) return;
          if (this.preference.matches) return;
          e.preventDefault();
          this.accordion(details);
        });
      }

      snapshot() {
        const numbers = new Map<string, number>();
        this.numericElements().forEach(({ el, key }) => {
          const node = this.numericNode(el);
          if (node && node.textContent) {
            const match = node.textContent.trim().match(numberPattern);
            if (match) {
              numbers.set(key, Number((match[1] === "−" ? "-" : match[1]) + match[2].replace(",", ".")));
            }
          }
        });
        const paths = new Map<string, string | null>();
        this.root
          .querySelectorAll("#vp-history svg path")
          .forEach((p) => paths.set(this.pathKey(p), p.getAttribute("d")));
        const markers = Array.from(this.root.querySelectorAll("#vp-history svg circle")).map((el) => ({
          x: Number(el.getAttribute("cx")),
          y: Number(el.getAttribute("cy")),
        }));
        const labels = Array.from(this.root.querySelectorAll("#vp-history svg .vp-value-label")).map((el) => ({
          x: Number(el.getAttribute("x")),
          y: Number(el.getAttribute("y")),
        }));
        const pill = this.root.querySelector(".vp-segment button[aria-pressed=true]") as HTMLElement | null;
        return {
          numbers,
          paths,
          markers,
          labels,
          pill: pill ? { x: pill.offsetLeft, width: pill.offsetWidth } : null,
        };
      }

      numericNode(el: Element) {
        return Array.from(el.childNodes).find(
          (n) => n.nodeType === Node.TEXT_NODE && numberPattern.test((n.textContent || "").trim())
        );
      }

      numericElements() {
        const list: Array<{ el: Element; key: string }> = [];
        const add = (selector: string, key: string | ((el: Element, i: number) => string)) =>
          this.root
            .querySelectorAll(selector)
            .forEach((el, i) => list.push({ el, key: typeof key === "function" ? key(el, i) : key }));
        add(".vp-gauge-number>strong,.vx-call-score>strong", "score");
        add(".vp-stat-value", (_el, i) => "stat-" + i);
        add(".vp-dimension-value", (_el, i) => "dimension-" + i);
        add(".vp-rank-score", (el) => "rank-" + (el.closest("[data-person]") as HTMLElement)?.dataset.person);
        add(".vp-podium-score", (el) => "podium-" + (el.closest("[data-person]") as HTMLElement)?.dataset.person);
        add(".vp-growth-value", "growth");
        add(".vx-evaluation-score", (_el, i) => "evaluation-" + i);
        return list;
      }

      pathKey(path: Element) {
        return path.getAttribute("fill") === "none" ? "line-" + path.getAttribute("stroke") : "area";
      }

      async change(
        update: () => void,
        { kind = "period", direction = "forward", resetScroll = false }: { kind?: string; direction?: string; resetScroll?: boolean } = {}
      ) {
        const revision = ++this.revision;
        const previous = this.snapshot();
        this.finishJobs();
        this.observer?.disconnect();
        this.revealPending();
        for (const [details, record] of this.accordions) {
          record.animation.cancel();
          details.open = record.open;
          details.style.height = "";
          details.style.overflow = "";
        }
        this.accordions.clear();
        this.main.getAnimations().forEach((a) => a.cancel());
        if (this.ready && kind === "route" && !this.preference.matches) {
          this.main.setAttribute("aria-busy", "true");
          const out = this.main.animate(
            [
              { opacity: 1, transform: "translateX(0)" },
              { opacity: 0, transform: "translateX(" + (direction === "back" ? 12 : -12) + "px)" },
            ],
            { duration: 115, easing: EASE, fill: "forwards" }
          );
          try {
            await out.finished;
          } catch {}
          if (revision !== this.revision) return;
          out.cancel();
        }
        if (revision !== this.revision) return;
        update();
        if (resetScroll) {
          const scrollHost = this.root.closest(".voice-score-scroll-host") as HTMLElement | null;
          if (scrollHost) scrollHost.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
        }
        this.main.removeAttribute("aria-busy");
        const initial = !this.ready;
        this.ready = true;
        this.decorate(previous, { kind: initial ? "initial" : kind, direction });
      }

      decorate(previous: any, { kind, direction }: { kind?: string; direction?: string } = {}) {
        this.segment(previous.pill, kind === "period");
        if (this.preference.matches) return;
        if (kind === "route") {
          this.main.animate(
            [
              { opacity: 0.15, transform: "translateX(" + (direction === "back" ? -12 : 12) + "px)" },
              { opacity: 1, transform: "translateX(0)" },
            ],
            { duration: 260, easing: EASE }
          );
        }
        this.enter(kind || "period");
        this.numbers(previous.numbers);
        this.charts(previous, kind || "period");
      }

      segment(previous: any, animate: boolean) {
        this.root.querySelectorAll(".vp-segment").forEach((segment: any) => {
          const active = segment.querySelector("[aria-pressed=true]") as HTMLElement | null;
          if (!active) return;
          const target = { x: active.offsetLeft, width: active.offsetWidth };
          const write = (p: { x: number; width: number }) => {
            segment.style.setProperty("--segment-x", p.x + "px");
            segment.style.setProperty("--segment-width", p.width + "px");
          };
          write(animate && previous && !this.preference.matches ? previous : target);
          if (animate && previous) {
            requestAnimationFrame(() => {
              if (segment.isConnected) write(target);
            });
          }
        });
      }

      enter(kind: string) {
        const targets = Array.from(
          this.main.querySelectorAll(
            ":scope>.vp-heading,:scope>.vp-toolbar,:scope>.vx-back-row,:scope>.vx-person-heading,:scope>.vx-call-heading,.vp-panel,.vp-dimension,.vp-focus,.vx-section-heading,.vx-evaluation,.vx-formula,.vx-evidence-disclaimer"
          )
        );
        const enterEl = (el: Element, delay = 0) => {
          el.classList.remove("motion-pending");
          el.animate(
            [
              { opacity: 0, transform: "translateY(" + (kind === "period" ? 5 : 10) + "px)" },
              { opacity: 1, transform: "translateY(0)" },
            ],
            { duration: kind === "period" ? 260 : 380, delay, easing: EASE, fill: "backwards" }
          );
          if (el.classList.contains("vp-ranking-panel")) {
            this.rows(el.querySelectorAll(".vp-rank-row"));
          }
        };
        if (!("IntersectionObserver" in window)) {
          targets.forEach((el, i) => enterEl(el, Math.min(i * 25, 125)));
          return;
        }
        this.observer = new IntersectionObserver(
          (entries) => {
            let index = 0;
            for (const entry of entries) {
              if (!entry.isIntersecting) continue;
              this.observer?.unobserve(entry.target);
              enterEl(entry.target, Math.min(index++ * 28, 140));
            }
          },
          { threshold: 0.06, rootMargin: "0px 0px 12px 0px" }
        );
        targets.forEach((el) => {
          el.classList.add("motion-pending");
          this.observer?.observe(el);
        });
      }

      revealPending() {
        this.root.querySelectorAll(".motion-pending").forEach((el) => el.classList.remove("motion-pending"));
      }

      rows(rowsList: NodeListOf<Element> | Element[]) {
        if (this.preference.matches) return;
        Array.from(rowsList).forEach((row, i) =>
          row.animate(
            [
              { opacity: 0, transform: "translateY(5px)" },
              { opacity: 1, transform: "translateY(0)" },
            ],
            { duration: 280, delay: Math.min(i * 35, 210), easing: EASE, fill: "backwards" }
          )
        );
      }

      numbers(previous: Map<string, number>) {
        this.numericElements().forEach(({ el, key }) => {
          const node = this.numericNode(el);
          if (!node || !node.textContent) return;
          const raw = node.textContent;
          const match = raw.trim().match(numberPattern);
          if (!match) return;
          const final = Number((match[1] === "−" ? "-" : match[1]) + match[2].replace(",", "."));
          const from = previous.has(key) ? previous.get(key)! : 0;
          el.setAttribute("aria-label", raw.trim());
          el.setAttribute("aria-live", "off");
          const decimals = match[2].includes(",") || match[2].includes(".") ? 1 : 0;
          const positivePrefix = match[1] === "+";
          const suffix = match[3];
          this.tween(
            500,
            (t) => {
              if (!node.isConnected) return;
              const value = from + (final - from) * t;
              node.textContent =
                (positivePrefix && value >= 0 ? "+" : "") +
                value.toLocaleString("pt-BR", {
                  minimumFractionDigits: decimals,
                  maximumFractionDigits: decimals,
                }) +
                suffix;
            },
            () => {
              if (node.isConnected) node.textContent = raw;
            }
          );
        });
      }

      charts(previous: any, kind: string) {
        this.root
          .querySelectorAll(".vp-bar>span")
          .forEach((bar, i) =>
            bar.animate([{ transform: "scaleX(.15)" }, { transform: "scaleX(1)" }], {
              duration: 520,
              delay: i * 22,
              easing: EASE,
            })
          );
        this.root.querySelectorAll("#vp-history svg path").forEach((path: any) => {
          const target = path.getAttribute("d");
          const old = previous.paths.get(this.pathKey(path));
          if (kind === "period" && old && target) {
            const from = (old.match(/-?\d*\.?\d+/g) || []).map(Number);
            const to = (target.match(/-?\d*\.?\d+/g) || []).map(Number);
            if (from.length === to.length) {
              this.tween(
                520,
                (t) => {
                  if (!path.isConnected) return;
                  let idx = 0;
                  path.setAttribute(
                    "d",
                    target.replace(/-?\d*\.?\d+/g, () => {
                      const n = idx++;
                      return (from[n] + (to[n] - from[n]) * t).toFixed(2);
                    })
                  );
                },
                () => {
                  if (path.isConnected) path.setAttribute("d", target);
                }
              );
            }
          } else if (path.getAttribute("fill") === "none" && !path.hasAttribute("stroke-dasharray")) {
            const length = path.getTotalLength();
            path.animate(
              [
                { strokeDasharray: length + " " + length, strokeDashoffset: length },
                { strokeDasharray: length + " " + length, strokeDashoffset: 0 },
              ],
              { duration: 650, easing: EASE }
            );
          } else if (path.getAttribute("fill") !== "none") {
            path.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 600, easing: EASE });
          }
        });
        this.root.querySelectorAll("#vp-history svg circle").forEach((el, i) => {
          const old = previous.markers[i];
          const x = Number(el.getAttribute("cx"));
          const y = Number(el.getAttribute("cy"));
          if (kind === "period" && old) {
            this.tween(
              520,
              (t) => {
                if (!el.isConnected) return;
                el.setAttribute("cx", String(old.x + (x - old.x) * t));
                el.setAttribute("cy", String(old.y + (y - old.y) * t));
              },
              () => {
                if (el.isConnected) {
                  el.setAttribute("cx", String(x));
                  el.setAttribute("cy", String(y));
                }
              }
            );
          }
        });
        this.root.querySelectorAll("#vp-history svg .vp-value-label").forEach((el, i) => {
          const old = previous.labels[i];
          const y = Number(el.getAttribute("y"));
          if (kind === "period" && old) {
            this.tween(
              520,
              (t) => {
                if (el.isConnected) el.setAttribute("y", String(old.y + (y - old.y) * t));
              },
              () => {
                if (el.isConnected) el.setAttribute("y", String(y));
              }
            );
          }
        });
        this.root.querySelectorAll("#vp-history svg circle,#vp-history svg .vp-value-label").forEach((el) => {
          if (el.getAttribute("fill") === "transparent") return;
          el.animate([{ opacity: 0 }, { opacity: 1 }], {
            duration: 360,
            delay: kind === "period" ? 100 : 250,
            easing: EASE,
            fill: "backwards",
          });
        });
        const gaugeSvg = this.root.querySelector("#vp-gauge svg") as SVGSVGElement | null;
        const valueEl = this.root.querySelector(".vp-gauge-number>strong");
        if (gaugeSvg && valueEl && valueEl.textContent) {
          const target = Number(valueEl.textContent.replace(",", "."));
          const from = previous.numbers.get("score") ?? 0;
          const width = gaugeSvg.viewBox.baseVal.width;
          const r = Math.min(119, (width - 40) / 2);
          const markers = gaugeSvg.querySelectorAll("circle");
          const segments = gaugeSvg.querySelectorAll("path");
          this.tween(
            580,
            (t) => {
              if (!gaugeSvg.isConnected) return;
              const value = from + (target - from) * t;
              const x = width / 2 - r * Math.cos((Math.PI * value) / 100);
              const y = 150 - r * Math.sin((Math.PI * value) / 100);
              markers.forEach((c) => {
                c.setAttribute("cx", String(x));
                c.setAttribute("cy", String(y));
              });
              segments.forEach((p, i) =>
                p.setAttribute("opacity", String(0.2 + 0.75 * Math.max(0, Math.min(1, (value - i * 5) / 5))))
              );
            },
            () => {
              if (!gaugeSvg.isConnected) return;
              const x = width / 2 - r * Math.cos((Math.PI * target) / 100);
              const y = 150 - r * Math.sin((Math.PI * target) / 100);
              markers.forEach((c) => {
                c.setAttribute("cx", String(x));
                c.setAttribute("cy", String(y));
              });
              segments.forEach((p, i) => p.setAttribute("opacity", i * 5 <= target ? ".95" : ".2"));
            }
          );
        }
      }

      tween(duration: number, update: (t: number) => void, finish?: () => void) {
        if (this.preference.matches) {
          update(1);
          finish?.();
          return;
        }
        this.jobs.add({ start: performance.now(), duration, update, finish });
        if (this.frame === null) this.frame = requestAnimationFrame((time) => this.tick(time));
      }

      tick(time: number) {
        this.frame = null;
        for (const job of this.jobs) {
          const t = Math.min(1, Math.max(0, (time - job.start) / job.duration));
          job.update(ease(t));
          if (t === 1) {
            job.finish?.();
            this.jobs.delete(job);
          }
        }
        if (this.jobs.size) this.frame = requestAnimationFrame((next) => this.tick(next));
      }

      finishJobs() {
        if (this.frame !== null) cancelAnimationFrame(this.frame);
        this.frame = null;
        for (const job of this.jobs) {
          job.update(1);
          job.finish?.();
        }
        this.jobs.clear();
      }

      resize(update: () => void) {
        this.finishJobs();
        update();
        this.segment(null, false);
      }

      accordion(details: HTMLDetailsElement) {
        const previous = this.accordions.get(details);
        const open = previous ? !previous.open : !details.open;
        const current = details.getBoundingClientRect().height;
        if (previous) previous.animation.cancel();
        details.open = true;
        details.style.height = "";
        const css = getComputedStyle(details);
        const summary = details.querySelector("summary")!;
        const closedHeight =
          summary.getBoundingClientRect().height +
          parseFloat(css.paddingTop) +
          parseFloat(css.paddingBottom) +
          parseFloat(css.borderTopWidth) +
          parseFloat(css.borderBottomWidth);
        const target = open ? details.getBoundingClientRect().height : closedHeight;
        details.style.overflow = "hidden";
        const animation = details.animate([{ height: current + "px" }, { height: target + "px" }], {
          duration: 260,
          easing: EASE,
          fill: "both",
        });
        const record = { animation, open };
        this.accordions.set(details, record);
        if (open) {
          const content = details.querySelector(".vx-evaluation-content") || details.querySelector("p");
          content?.animate(
            [
              { opacity: 0, transform: "translateY(-4px)" },
              { opacity: 1, transform: "translateY(0)" },
            ],
            { duration: 260, easing: EASE }
          );
        }
        animation.finished
          .then(() => {
            if (this.accordions.get(details) !== record) return;
            details.open = open;
            animation.cancel();
            details.style.height = "";
            details.style.overflow = "";
            this.accordions.delete(details);
          })
          .catch(() => {});
      }

      highlight(element: HTMLElement | null) {
        if (!element || this.preference.matches) return;
        element.animate(
          [
            { boxShadow: "inset 3px 0 0 var(--vp-accent), inset 0 0 0 1px var(--vp-accent)" },
            { boxShadow: "inset 3px 0 0 var(--vp-accent), inset 0 0 0 1px transparent" },
          ],
          { duration: 600, easing: EASE }
        );
      }

      destroy() {
        this.finishJobs();
        this.observer?.disconnect();
      }
    }

    const motion = new TecfagMotion(root, main);

    /* ==========================================================================
       4. DATA & CONFIGURATION
       ========================================================================== */
    const people = [
      { id: "jhordan", name: "Jhordan", initials: "J", photo: "/assets/people/jhordan.png", focalX: 50, focalY: 24, mockIndex: 2, dims: [93, 91, 85, 72, 89], growth: 0.65 },
      { id: "denise", name: "Denise", initials: "D", photo: "/assets/people/denise.png", focalX: 55, focalY: 25, mockIndex: 0, dims: [88, 84, 68, 58, 76], growth: 0.9 },
      { id: "melissa-gomes", name: "Melissa Gomes", initials: "MG", photo: "/assets/people/melissa-gomes.png", focalX: 49, focalY: 24, mockIndex: 4, dims: [88, 81, 77, 69, 78], growth: 1.45 },
    ];

    const dimensions = [
      ["S", "Situação"],
      ["P", "Dor"],
      ["I", "Impacto"],
      ["CE", "Evento crítico"],
      ["D", "Decisão"],
    ];

    const SPICED_INFO: Record<string, any> = {
      S: {
        letter: "S",
        name: "Situação",
        title: "Situation (Situação & Contexto)",
        tag: "Diagnóstico Operacional",
        meaning: "Mapeamento detalhado do contexto atual do cliente: processos operacionais, volume de produção, ferramentas utilizadas e papéis de cada pessoa envolvida.",
        why: "Por que avaliar: Sem mapear o ponto de partida e o fluxo atual, qualquer recomendação de maquinário será genérica e sem aderência à capacidade real do cliente.",
        tecfag: "Foco Tecfag: Entender o maquinário existente, capacidade produtiva diária, insumos utilizados e quem opera a linha.",
        goodCriteria: "Mapeia processo, ferramentas e participantes, confirmando o entendimento antes de avançar.",
        role: "Base para dimensionar a solução correta",
      },
      P: {
        letter: "P",
        name: "Dor",
        title: "Pain (Dores & Dificuldades Críticas)",
        tag: "Causa-Raiz do Problema",
        meaning: "Investigação profunda das causas e frequência dos problemas que travam a operação do cliente (gargalos, quebras, desperdício ou lentidão).",
        why: "Por que avaliar: Clientes só investem para eliminar dores reais. Se o vendedor não descobrir a causa-raiz da dor, não haverá senso de urgência para a compra.",
        tecfag: "Foco Tecfag: Identificar retrabalho, perda de matéria-prima por selagem irregular, pesagens incorretas ou gargalos manuais.",
        goodCriteria: "Pede exemplos concretos, investiga a causa original e verifica a frequência do problema.",
        role: "Gera a necessidade e urgência da compra",
      },
      I: {
        letter: "I",
        name: "Impacto",
        title: "Impact (Impacto Financeiro e Operacional)",
        tag: "Quantificação & ROI",
        meaning: "Dimensionamento matemático e financeiro das consequências da dor: horas perdidas da equipe, desperdício de insumos, custo de retrabalho e risco de imagem.",
        why: "Por que avaliar: O valor da solução é medido pelo custo de não resolver o problema. Sem impacto quantificado, a proposta parecerá cara ao cliente.",
        tecfag: "Foco Tecfag: Quantificar horas de parada, custo mensal de perda de embalagens e faturamento não realizado por limitação de capacidade.",
        goodCriteria: "Calcula pessoas e horas envolvidas, custo monetário da perda e consequência na meta da empresa.",
        role: "Justifica o investimento e prova o retorno",
      },
      CE: {
        letter: "CE",
        name: "Evento Crítico",
        title: "Critical Event (Prazo & Marco Determinante)",
        tag: "Compromisso de Prazo",
        meaning: "Data limite ou acontecimento decisivo no negócio do cliente que exige a solução funcionando (início de safra, nova linha, sazonalidade ou auditoria).",
        why: "Por que avaliar: Um evento crítico estabelece uma linha do tempo rígida de implantação. Sem data fatal com consequências reais, o fechamento é postergado indefinidamente.",
        tecfag: "Foco Tecfag: Lançamento de produto, datas comerciais (Black Friday, Páscoa), inspeção técnica ou fim de contrato de locação.",
        goodCriteria: "Conecta o prazo de entrega/instalação ao evento do cliente e valida o que acontece em caso de atraso.",
        role: "Define o cronograma e fecha a data de compra",
      },
      D: {
        letter: "D",
        name: "Decisão",
        title: "Decision (Processo & Critérios de Decisão)",
        tag: "Governança & Próximos Passos",
        meaning: "Mapeamento de todos os decisores (financeiro, operacional, diretoria), critérios de homologação técnica e etapas burocráticas para contratação.",
        why: "Por que avaliar: Evita surpresas no final da negociação. Saber quem aprova e os critérios exigidos permite conduzir a venda com previsibilidade e sem intermediários desavisados.",
        tecfag: "Foco Tecfag: Alinhar validação técnica da engenharia/produção, aprovação orçamentária da diretoria e condições de garantia.",
        goodCriteria: "Mapeia participantes, critérios e aprovação, combinando próximos passos objetivos com a diretoria.",
        role: "Garante o fechamento sem surpresas no processo",
      },
    };

    const days = [2, 4, 6, 8, 11, 13, 16, 18];
    const clients = [
      "Horizonte Tecnologia",
      "Alfa Distribuidora",
      "Nova Via Serviços",
      "Prisma Comércio",
      "Atlas Soluções",
      "Grupo Aurora",
      "Ponto Norte",
      "Delta Equipamentos",
    ];
    const calls: any[] = [];

    people.forEach((p) =>
      [7, 8, 9, 10].forEach((month, mi) =>
        days.forEach((day, i) => {
          const pi = p.mockIndex;
          const variation = [-7, 3, -2, 5, -4, 6, -1, 0][i];
          const dims = p.dims.map((v, j) =>
            Math.max(0, Math.min(100, v + [-9, -6, -3, 0][mi] * p.growth + variation + (((i + j + pi) % 3) - 1)))
          );
          calls.push({
            id: p.id + "-" + month + "-" + day,
            seller: p.id,
            month,
            day,
            client: clients[(i + pi * 2) % 8],
            duration: 540 + i * 47 + pi * 29,
            dims,
            score: dims.reduce((a, b) => a + b, 0) / 5,
          });
        })
      )
    );

    const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
    const score = (a: any[]) => mean(a.map((c) => c.score));
    const dimsOf = (a: any[]) => dimensions.map((_, i) => mean(a.map((c) => c.dims[i])));
    const fmt = (n: number) => n.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    const signed = (n: number) => (n >= 0 ? "+" : "−") + fmt(Math.abs(n));
    const esc = (value: any) =>
      String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] || c));
    const time = (n: number) =>
      Math.floor(n / 60).toString().padStart(2, "0") + ":" + Math.floor(n % 60).toString().padStart(2, "0");
    const date = (c: any) => String(c.day).padStart(2, "0") + "/" + String(c.month).padStart(2, "0") + "/2026";
    const level = (n: number) => (n >= 80 ? "high" : n < 65 ? "low" : "mid");
    const status = (n: number) => (n >= 80 ? "Bem executado" : n < 65 ? "Precisa aprofundar" : "Parcialmente explorado");
    const chip = (n: number) => '<span class="vp-score-chip" data-level="' + level(n) + '">' + fmt(n) + "</span>";
    const icon = (name: string, className = "") =>
      '<i data-lucide="' + name + '" class="' + className + '" aria-hidden="true"></i>';
    const avatar = (p: any) =>
      '<span class="vp-avatar vx-photo-avatar"><img src="' +
      esc(p.photo) +
      '" alt="Foto de ' +
      esc(p.name) +
      '" style="--avatar-x:' +
      p.focalX +
      "%;--avatar-y:" +
      p.focalY +
      '%" decoding="async" draggable="false"></span>';

    let savedRange = "current";
    try {
      savedRange = localStorage.getItem("tecfag.voice.range") === "macro" ? "macro" : "current";
    } catch {}

    let lastSellerId = "jhordan";
    let lastCallId = "jhordan-10-18";

    const state: {
      screen: VoiceScoreScreen;
      seller: string;
      range: string;
      call: string | null;
      seekLine: string | null;
      page: number;
      query: string;
      scope: string;
      onlyAttention: boolean;
    } = {
      screen: activeScreen || "team",
      seller: activeScreen === "team" ? "all" : lastSellerId,
      range: savedRange,
      call: activeScreen === "call" ? lastCallId : null,
      seekLine: null,
      page: 1,
      query: "",
      scope: "all",
      onlyAttention: false,
    };

    const recordings = new Map<string, { url: string; name: string; time: number; rate: number; volume: number }>();
    let minutageDay = calls.map(TecfagMinutage.callDay).sort().at(-1)!;

    const set = (id = state.seller) =>
      calls.filter((c) => (id === "all" || c.seller === id) && (state.range === "macro" || c.month === 10));
    const monthSet = (month: number, id = state.seller) =>
      calls.filter((c) => c.month === month && (id === "all" || c.seller === id));
    const evolution = (id = state.seller) => score(monthSet(10, id)) - score(monthSet(state.range === "macro" ? 7 : 9, id));
    const rank = () =>
      people
        .map((p) => ({
          ...p,
          score: score(set(p.id)),
          delta: evolution(p.id),
          count: set(p.id).length,
        }))
        .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

    function go(routeHash: string) {
      const [path, query = ""] = routeHash.replace(/^#/, "").split("?");
      const parts = path.split("/").filter(Boolean);
      const previousSeller = state.seller;
      const previousScreen = state.screen;
      state.seekLine = new URLSearchParams(query).get("trecho");

      if (parts[0] === "vendedor" && people.some((p) => p.id === parts[1])) {
        state.screen = "seller";
        state.seller = parts[1];
        lastSellerId = parts[1];
        state.call = null;
      } else if (parts[0] === "ligacao" && calls.some((c) => c.id === parts[1])) {
        state.screen = "call";
        state.call = parts[1];
        lastCallId = parts[1];
        state.seller = calls.find((c) => c.id === state.call)!.seller;
        lastSellerId = state.seller;
      } else {
        state.screen = "team";
        state.seller = "all";
        state.call = null;
      }

      if (state.seller !== previousSeller) {
        state.page = 1;
        state.query = "";
        state.scope = "all";
        state.onlyAttention = false;
      }

      onScreenChangeRef.current?.(state.screen);
      const depth: Record<VoiceScoreScreen, number> = { team: 0, seller: 1, call: 2 };
      render({
        kind: "route",
        direction: depth[state.screen] < depth[previousScreen] ? "back" : "forward",
        resetScroll: true,
      });
    }

    navigateRef.current = (targetScreen: VoiceScoreScreen) => {
      if (state.screen === targetScreen) return;
      if (targetScreen === "team") {
        go("#/equipe");
      } else if (targetScreen === "seller") {
        const targetSeller = state.seller !== "all" ? state.seller : lastSellerId || rank()[0]?.id || "jhordan";
        go("#/vendedor/" + targetSeller);
      } else if (targetScreen === "call") {
        const targetSeller = state.seller !== "all" ? state.seller : lastSellerId || rank()[0]?.id || "jhordan";
        const sellerLatestCall = calls
          .filter((c) => c.seller === targetSeller)
          .sort((a, b) => b.month - a.month || b.day - a.day)[0];
        const targetCall = state.call || (sellerLatestCall ? sellerLatestCall.id : lastCallId);
        go("#/ligacao/" + targetCall);
      }
    };

    /* ==========================================================================
       5. CUSTOM TOOLTIP & RICH SPICED POP-UP ENGINE
       ========================================================================== */
    const tooltipEl = document.createElement("div");
    tooltipEl.id = "tecfag-tooltip";
    tooltipEl.className = "tecfag-tooltip";
    tooltipEl.setAttribute("role", "tooltip");
    tooltipEl.setAttribute("aria-hidden", "true");
    tooltipEl.innerHTML = '<div class="tecfag-tooltip-arrow"></div><div class="tecfag-tooltip-content"></div>';
    root.appendChild(tooltipEl);
    const tooltipArrow = tooltipEl.querySelector(".tecfag-tooltip-arrow") as HTMLElement;
    const tooltipContent = tooltipEl.querySelector(".tecfag-tooltip-content") as HTMLElement;
    let activeTooltipTarget: HTMLElement | null = null;

    function positionTooltip() {
      if (!activeTooltipTarget) return;
      const r = activeTooltipTarget.getBoundingClientRect();
      const tr = tooltipEl.getBoundingClientRect();
      const gap = 9;
      let top = r.top - tr.height - gap;
      let placeBelow = false;
      if (top < 10) {
        top = r.bottom + gap;
        placeBelow = true;
      }
      let left = r.left + r.width / 2 - tr.width / 2;
      left = Math.max(10, Math.min(window.innerWidth - tr.width - 10, left));
      tooltipEl.style.top = `${top}px`;
      tooltipEl.style.left = `${left}px`;
      const arrowOffset = r.left + r.width / 2 - left - 4;
      tooltipArrow.style.left = `${Math.max(10, Math.min(tr.width - 18, arrowOffset))}px`;
      if (placeBelow) {
        tooltipArrow.style.top = "-5px";
        tooltipArrow.style.borderTop = "1px solid var(--vp-line)";
        tooltipArrow.style.borderLeft = "1px solid var(--vp-line)";
        tooltipArrow.style.borderBottom = "none";
        tooltipArrow.style.borderRight = "none";
      } else {
        tooltipArrow.style.top = "calc(100% - 5px)";
        tooltipArrow.style.borderBottom = "1px solid var(--vp-line)";
        tooltipArrow.style.borderRight = "1px solid var(--vp-line)";
        tooltipArrow.style.borderTop = "none";
        tooltipArrow.style.borderLeft = "none";
      }
    }

    function showTooltip(target: HTMLElement) {
      const text = target.getAttribute("data-tooltip");
      if (!text) return;
      activeTooltipTarget = target;
      tooltipEl.classList.remove("has-card");
      tooltipContent.innerHTML = esc(text);
      positionTooltip();
      tooltipEl.classList.add("visible");
      tooltipEl.setAttribute("aria-hidden", "false");
    }

    function showSpiced(target: HTMLElement) {
      const key = target.getAttribute("data-spiced-key") || "";
      const scoreVal = target.getAttribute("data-spiced-val");
      const info = SPICED_INFO[key];
      if (!info) return;
      activeTooltipTarget = target;
      tooltipEl.classList.add("has-card");
      tooltipContent.innerHTML = `
        <div class="tecfag-spiced-card">
          <div class="tecfag-spiced-card-top">
            <div class="tecfag-spiced-badge">
              <span class="tecfag-spiced-letter">${info.letter}</span>
              <div>
                <span class="tecfag-spiced-tag">${info.tag}</span>
                <strong class="tecfag-spiced-title">${info.title}</strong>
              </div>
            </div>
            ${
              scoreVal
                ? `<span class="tecfag-spiced-score-chip vp-score-chip" data-level="${level(
                    parseFloat(scoreVal.replace(",", "."))
                  )}">${scoreVal} / 100</span>`
                : ""
            }
          </div>
          <div class="tecfag-spiced-section-block">
            <p class="tecfag-spiced-desc"><strong style="color:var(--vp-text)">O que significa:</strong> ${info.meaning}</p>
          </div>
          <div class="tecfag-spiced-section-block">
            <p class="tecfag-spiced-desc"><strong style="color:var(--vp-accent)">${
              info.why.split(":")[0]
            }:</strong>${info.why.split(":").slice(1).join(":")}</p>
          </div>
          <div class="tecfag-spiced-section-block">
            <p class="tecfag-spiced-desc"><strong style="color:var(--vp-green)">${
              info.tecfag.split(":")[0]
            }:</strong>${info.tecfag.split(":").slice(1).join(":")}</p>
          </div>
          <div class="tecfag-spiced-footer">
            <span>Metodologia SPICED</span>
            <span>${info.role}</span>
          </div>
        </div>
      `;
      positionTooltip();
      tooltipEl.classList.add("visible");
      tooltipEl.setAttribute("aria-hidden", "false");
    }

    function hideTooltip() {
      activeTooltipTarget = null;
      tooltipEl.classList.remove("visible");
      tooltipEl.setAttribute("aria-hidden", "true");
    }

    const onMouseOver = (e: MouseEvent) => {
      const targetEl = e.target as HTMLElement | null;
      if (!targetEl || !root.contains(targetEl)) return;
      const spiced = targetEl.closest("[data-spiced-key]") as HTMLElement | null;
      if (spiced) {
        showSpiced(spiced);
        return;
      }
      const tip = targetEl.closest("[data-tooltip]") as HTMLElement | null;
      if (tip) {
        showTooltip(tip);
        return;
      }
    };

    const onMouseOut = (e: MouseEvent) => {
      if (activeTooltipTarget && !activeTooltipTarget.contains(e.relatedTarget as Node)) {
        hideTooltip();
      }
    };

    const onFocusIn = (e: FocusEvent) => {
      const targetEl = e.target as HTMLElement | null;
      if (!targetEl || !root.contains(targetEl)) return;
      const match = targetEl.closest("[data-tooltip], [data-spiced-key]") as HTMLElement | null;
      if (match) {
        if (match.dataset.spicedKey) showSpiced(match);
        else showTooltip(match);
      }
    };

    const onScrollOrResize = () => {
      if (activeTooltipTarget) positionTooltip();
    };

    root.addEventListener("mouseover", onMouseOver);
    root.addEventListener("mouseout", onMouseOut);
    root.addEventListener("focusin", onFocusIn);
    root.addEventListener("focusout", hideTooltip);
    window.addEventListener("scroll", onScrollOrResize, { passive: true, capture: true });
    window.addEventListener("resize", onScrollOrResize, { passive: true });

    /* ==========================================================================
       6. CUSTOM CONTROLS (SELECT & DATEPICKER)
       ========================================================================== */
    function renderCustomSelect({ id, value, options, tooltip = "", ariaLabel = "" }: any) {
      const current = options.find((o: any) => o.value === value) || options[0];
      const iconOrAvatar = current.photo
        ? `<span class="vp-avatar vx-photo-avatar tecfag-opt-avatar"><img src="${esc(current.photo)}" alt="" style="--avatar-x:${
            current.focalX || 50
          }%;--avatar-y:${current.focalY || 25}%"></span>`
        : current.icon
        ? `<i data-lucide="${current.icon}" class="tecfag-select-icon" aria-hidden="true"></i>`
        : "";

      return `
        <div class="tecfag-select" id="${id}-wrapper" data-tooltip="${tooltip}">
          <button type="button" class="tecfag-select-trigger" id="${id}-trigger" aria-haspopup="listbox" aria-expanded="false" aria-label="${
            ariaLabel || current.label
          }">
            <span class="tecfag-select-icon">${iconOrAvatar}</span>
            <span class="tecfag-select-value">${esc(current.label)}</span>
            <i data-lucide="chevron-down" class="tecfag-select-arrow" aria-hidden="true"></i>
          </button>
          <div class="tecfag-select-menu" role="listbox" aria-labelledby="${id}-trigger">
            ${options
              .map(
                (opt: any) => `
              <div class="tecfag-select-opt ${opt.value === value ? "selected" : ""}" data-value="${
                  opt.value
                }" role="option" aria-selected="${opt.value === value}">
                ${
                  opt.photo
                    ? `<span class="vp-avatar vx-photo-avatar tecfag-opt-avatar"><img src="${esc(
                        opt.photo
                      )}" alt="" style="--avatar-x:${opt.focalX || 50}%;--avatar-y:${opt.focalY || 25}%"></span>`
                    : opt.icon
                    ? `<i data-lucide="${opt.icon}" class="tecfag-select-icon" aria-hidden="true"></i>`
                    : ""
                }
                <span>${esc(opt.label)}</span>
                <i data-lucide="check" class="tecfag-opt-check" aria-hidden="true"></i>
              </div>
            `
              )
              .join("")}
          </div>
          <input type="hidden" id="${id}" value="${value}">
        </div>
      `;
    }

    function closeAllPopovers() {
      root.querySelectorAll(".tecfag-select.open").forEach((el) => {
        el.classList.remove("open");
        el.querySelector(".tecfag-select-trigger")?.setAttribute("aria-expanded", "false");
      });
      root.querySelectorAll(".tecfag-datepicker.open").forEach((el) => {
        el.classList.remove("open");
        el.querySelector(".tecfag-datepicker-trigger")?.setAttribute("aria-expanded", "false");
      });
    }

    const onKeyDownClose = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeAllPopovers();
    };
    document.addEventListener("click", closeAllPopovers);
    document.addEventListener("keydown", onKeyDownClose);

    function initCustomSelect(id: string, onChange?: (val: string) => void) {
      const wrapper = $("#" + id + "-wrapper");
      if (!wrapper) return;
      const trigger = wrapper.querySelector(".tecfag-select-trigger")!;
      const menu = wrapper.querySelector(".tecfag-select-menu")!;
      const input = wrapper.querySelector('input[type="hidden"]') as HTMLInputElement;

      trigger.addEventListener("click", (e) => {
        e.stopPropagation();
        const isOpen = wrapper.classList.contains("open");
        closeAllPopovers();
        if (!isOpen) {
          wrapper.classList.add("open");
          trigger.setAttribute("aria-expanded", "true");
        }
      });

      menu.querySelectorAll(".tecfag-select-opt").forEach((opt) => {
        opt.addEventListener("click", (e) => {
          e.stopPropagation();
          const val = opt.getAttribute("data-value") || "";
          menu.querySelectorAll(".tecfag-select-opt").forEach((o) => o.classList.toggle("selected", o === opt));
          input.value = val;
          wrapper.classList.remove("open");
          trigger.setAttribute("aria-expanded", "false");
          if (onChange) onChange(val);
          icons();
        });
      });
    }

    function renderCustomDatePicker({ id, value, tooltip = "" }: any) {
      const [y, m, d] = value.split("-").map(Number);
      const formatted = `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}/${y}`;
      const monthNames = [
        "Janeiro",
        "Fevereiro",
        "Março",
        "Abril",
        "Maio",
        "Junho",
        "Julho",
        "Agosto",
        "Setembro",
        "Outubro",
        "Novembro",
        "Dezembro",
      ];
      const firstDay = new Date(y, m - 1, 1).getDay();
      const totalDays = new Date(y, m, 0).getDate();
      let daysHtml = "";
      for (let i = 0; i < firstDay; i++) {
        daysHtml += '<span class="tecfag-cal-day empty"></span>';
      }
      for (let dayNum = 1; dayNum <= totalDays; dayNum++) {
        const hasCalls = days.includes(dayNum) && m === 10;
        const isActive = dayNum === d && m === 10;
        daysHtml += `<button type="button" class="tecfag-cal-day ${isActive ? "active" : ""} ${
          hasCalls ? "has-calls" : ""
        }" data-day="${dayNum}">${dayNum}</button>`;
      }
      return `
        <div class="tecfag-datepicker" id="${id}-wrapper" data-tooltip="${tooltip}">
          <button type="button" class="tecfag-datepicker-trigger" id="${id}-trigger" aria-haspopup="dialog" aria-expanded="false" aria-label="Dia de referência: ${formatted}">
            <i data-lucide="calendar" aria-hidden="true"></i>
            <span class="tecfag-datepicker-val">${formatted}</span>
            <i data-lucide="chevron-down" class="tecfag-select-arrow" aria-hidden="true"></i>
          </button>
          <div class="tecfag-datepicker-popover" role="dialog" aria-label="Seletor de data de referência">
            <div class="tecfag-cal-header">
              <span class="tecfag-cal-title">${monthNames[m - 1]} ${y}</span>
              <div class="tecfag-cal-nav">
                <button type="button" class="tecfag-cal-btn" data-nav="-1" aria-label="Mês anterior" disabled><i data-lucide="chevron-left" aria-hidden="true"></i></button>
                <button type="button" class="tecfag-cal-btn" data-nav="1" aria-label="Próximo mês" disabled><i data-lucide="chevron-right" aria-hidden="true"></i></button>
              </div>
            </div>
            <div class="tecfag-cal-weekdays">
              <span>D</span><span>S</span><span>T</span><span>Q</span><span>Q</span><span>S</span><span>S</span>
            </div>
            <div class="tecfag-cal-days">
              ${daysHtml}
            </div>
          </div>
          <input type="hidden" id="${id}" value="${value}">
        </div>
      `;
    }

    function initCustomDatePicker(id: string, onChange?: (val: string) => void) {
      const wrapper = $("#" + id + "-wrapper");
      if (!wrapper) return;
      const trigger = wrapper.querySelector(".tecfag-datepicker-trigger")!;
      const input = wrapper.querySelector('input[type="hidden"]') as HTMLInputElement;

      trigger.addEventListener("click", (e) => {
        e.stopPropagation();
        const isOpen = wrapper.classList.contains("open");
        closeAllPopovers();
        if (!isOpen) {
          wrapper.classList.add("open");
          trigger.setAttribute("aria-expanded", "true");
        }
      });

      wrapper.querySelectorAll(".tecfag-cal-day:not(.empty)").forEach((btn) => {
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          const dayNum = btn.getAttribute("data-day") || "18";
          const newDate = `2026-10-${String(dayNum).padStart(2, "0")}`;
          input.value = newDate;
          wrapper.querySelector(".tecfag-datepicker-val")!.textContent = `${String(dayNum).padStart(2, "0")}/10/2026`;
          wrapper.querySelectorAll(".tecfag-cal-day").forEach((b) => b.classList.remove("active"));
          btn.classList.add("active");
          wrapper.classList.remove("open");
          trigger.setAttribute("aria-expanded", "false");
          if (onChange) onChange(newDate);
          icons();
        });
      });
    }

    /* ==========================================================================
       7. CHARTS, SCREENS & RENDERING
       ========================================================================== */
    function renderHeaderControls() {
      const container = $("#vp-appbar-controls");
      if (!container) return;

      const sellerOptions = [
        { value: "all", label: "Visão da equipe", icon: "users" },
        ...people.map((p) => ({
          value: p.id,
          label: p.name,
          photo: p.photo,
          focalX: p.focalX,
          focalY: p.focalY,
        })),
      ];

      const sellerSelectHtml = renderCustomSelect({
        id: "vp-seller",
        value: state.seller,
        options: sellerOptions,
        tooltip: "Alternar entre a visão geral da equipe e o desempenho individual",
        ariaLabel: "Selecionar vendedor ou equipe",
      });

      const dateLabel = state.range === "macro" ? "Jul–out, 2026" : "01–19 out, 2026";

      container.innerHTML = `
        ${sellerSelectHtml}
        <span class="vp-date" data-tooltip="Período das ligações avaliadas">
          <i data-lucide="calendar-days" aria-hidden="true"></i>
          <span id="vp-date-label">${dateLabel}</span>
        </span>
        <div class="vp-segment" aria-label="Período de análise" data-tooltip="Alternar entre o período atual (outubro) e visão macro (trimestral)">
          <button type="button" data-range="current" aria-pressed="${state.range === "current"}">Atual</button>
          <button type="button" data-range="macro" aria-pressed="${state.range === "macro"}">Visão macro</button>
        </div>
      `;

      initCustomSelect("vp-seller", (val) => {
        if (val === "all") go("#/equipe");
        else go("#/vendedor/" + val);
      });

      icons();
    }

    function gauge() {
      const host = $("#vp-gauge");
      if (!host) return;
      const width = host.getBoundingClientRect().width;
      if (width < 10) return;
      const value = score(set());
      const height = 184;
      const cx = width / 2;
      const cy = 150;
      const r = Math.min(119, (width - 40) / 2);
      const point = (v: number) => [cx - r * Math.cos((Math.PI * v) / 100), cy - r * Math.sin((Math.PI * v) / 100)];
      const col = (v: number) => (v < 65 ? "var(--vp-accent)" : v < 80 ? "var(--vp-amber)" : "var(--vp-green)");
      let svg =
        '<svg xmlns="http://www.w3.org/2000/svg" width="' +
        width +
        '" height="' +
        height +
        '" viewBox="0 0 ' +
        width +
        " " +
        height +
        '" role="img" aria-label="Score SPICED: ' +
        fmt(value) +
        ' de 100"><title>Score SPICED</title><desc>Atenção abaixo de 65, em desenvolvimento entre 65 e 79,9, consistente a partir de 80. Régua ilustrativa.</desc>';
      for (let i = 0; i < 20; i++) {
        const a = point(i * 5 + 0.6);
        const b = point((i + 1) * 5 - 0.6);
        svg +=
          '<path d="M' +
          a[0] +
          "," +
          a[1] +
          " A" +
          r +
          "," +
          r +
          " 0 0 1 " +
          b[0] +
          "," +
          b[1] +
          '" fill="none" stroke="' +
          col(i * 5 + 2.5) +
          '" stroke-width="9" opacity="' +
          (i * 5 <= value ? ".95" : ".2") +
          '"/>';
      }
      const marker = point(value);
      svg +=
        '<circle cx="' +
        marker[0] +
        '" cy="' +
        marker[1] +
        '" r="11" fill="var(--vp-panel)"/><circle cx="' +
        marker[0] +
        '" cy="' +
        marker[1] +
        '" r="8" fill="' +
        col(value) +
        '"/><text x="' +
        (cx - r) +
        '" y="172" text-anchor="middle" fill="var(--vp-sub)" style="font:11px Inter,system-ui">0</text><text x="' +
        (cx + r) +
        '" y="172" text-anchor="middle" fill="var(--vp-sub)" style="font:11px Inter,system-ui">100</text></svg>';
      host.innerHTML =
        svg +
        '<div class="vp-gauge-number"><strong>' +
        fmt(value) +
        '</strong><span style="color:' +
        col(value) +
        '">' +
        (value >= 80 ? "Consistente" : value < 65 ? "Requer atenção" : "Em desenvolvimento") +
        "</span></div>";
    }

    function history() {
      const host = $("#vp-history");
      if (!host) return;
      const width = host.getBoundingClientRect().width;
      if (width < 10) return;
      const h = 190;
      const L = 36;
      const R = 22;
      const T = 25;
      const B = 30;
      const W = Math.max(1, width - L - R);
      const H = h - T - B;
      const macro = state.range === "macro";
      const groups = macro ? [7, 8, 9, 10] : [0, 1, 2, 3];
      const labels = macro ? ["Jul", "Ago", "Set", "Out"] : ["01–04", "05–09", "10–14", "15–19"];
      const names = macro
        ? ["Julho", "Agosto", "Setembro", "Outubro"]
        : ["01 a 04 de outubro", "05 a 09 de outubro", "10 a 14 de outubro", "15 a 19 de outubro"];
      const belongs = (c: any, g: number) => (macro ? c.month === g : Math.floor(days.indexOf(c.day) / 2) === g);
      const buckets = groups.map((g) => set().filter((c) => belongs(c, g)));
      const values = buckets.map(score);
      const personal = state.seller !== "all";
      const owner = personal ? people.find((p) => p.id === state.seller)!.name : "Equipe";
      const baseline = score(monthSet(macro ? 7 : 9, "all"));
      const references = personal ? groups.map((g) => score(set("all").filter((c) => belongs(c, g)))) : groups.map(() => baseline);
      const referenceName = personal ? "Média da equipe" : macro ? "Referência · julho" : "Referência · setembro";
      const X = (i: number) => L + (i * W) / 3;
      const Y = (v: number) => T + ((100 - v) * H) / 100;
      const path = (a: number[]) => a.map((v, i) => (i ? "L" : "M") + X(i).toFixed(2) + "," + Y(v).toFixed(2)).join(" ");
      let svg =
        '<svg xmlns="http://www.w3.org/2000/svg" width="' +
        width +
        '" height="' +
        h +
        '" viewBox="0 0 ' +
        width +
        " " +
        h +
        '" role="img" aria-label="Evolução da nota SPICED, com comparação e quantidade de ligações por período"><title>Evolução da qualidade das ligações</title><desc>' +
        names
          .map(
            (l, i) =>
              l +
              ": " +
              fmt(values[i]) +
              " pontos; " +
              buckets[i].length +
              " ligações; " +
              referenceName +
              ": " +
              fmt(references[i]) +
              " pontos"
          )
          .join("; ") +
        '</desc><defs><linearGradient id="vp-history-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="var(--vp-accent)" stop-opacity=".18"/><stop offset="100%" stop-color="var(--vp-accent)" stop-opacity="0"/></linearGradient></defs>';
      [0, 25, 50, 75, 100].forEach(
        (v) =>
          (svg +=
            '<line x1="' +
            L +
            '" x2="' +
            (width - R) +
            '" y1="' +
            Y(v) +
            '" y2="' +
            Y(v) +
            '" stroke="var(--vp-line)" opacity="' +
            (v === 0 ? 1 : 0.55) +
            '"/><text x="' +
            (L - 10) +
            '" y="' +
            (Y(v) + 4) +
            '" text-anchor="end">' +
            v +
            "</text>")
      );
      svg += '<path d="' + path(values) + " L" + X(3) + "," + (T + H) + " L" + X(0) + "," + (T + H) + ' Z" fill="url(#vp-history-fill)"/>';
      svg +=
        '<path d="' +
        path(references) +
        '" fill="none" stroke="var(--vp-sub)" stroke-width="1.5" stroke-dasharray="4 5" opacity=".65"/>';
      svg +=
        '<path d="' +
        path(values) +
        '" fill="none" stroke="var(--vp-accent)" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/>';
      values.forEach(
        (v, i) =>
          (svg +=
            '<circle cx="' +
            X(i) +
            '" cy="' +
            Y(v) +
            '" r="4" fill="var(--vp-panel)" stroke="var(--vp-accent)" stroke-width="2"/><text class="vp-value-label" x="' +
            X(i) +
            '" y="' +
            Math.max(13, Y(v) - 13) +
            '" text-anchor="' +
            (i === 0 ? "start" : i === 3 ? "end" : "middle") +
            '">' +
            fmt(v) +
            '</text><text x="' +
            X(i) +
            '" y="' +
            (h - 6) +
            '" text-anchor="' +
            (i === 0 ? "start" : i === 3 ? "end" : "middle") +
            '">' +
            labels[i] +
            "</text>")
      );
      svg +=
        '<line class="vp-chart-guide" x1="0" x2="0" y1="' +
        T +
        '" y2="' +
        (T + H) +
        '" stroke="var(--vp-sub)" stroke-dasharray="2 5" opacity="0"/></svg>';
      host.innerHTML =
        '<div class="vp-chart-plot">' +
        svg +
        values
          .map(
            (v, i) =>
              '<button type="button" class="vp-chart-hit" data-point="' +
              i +
              '" style="left:' +
              X(i) +
              "px;top:" +
              Y(v) +
              'px" aria-label="Detalhar ' +
              names[i] +
              ": " +
              fmt(v) +
              " pontos, " +
              buckets[i].length +
              ' ligações" aria-pressed="false"></button>'
          )
          .join("") +
        '<div class="vp-chart-tooltip" role="tooltip" hidden></div></div><div class="vp-chart-context"><span>' +
        icon("mouse-pointer-2") +
        "Passe sobre os pontos para explorar</span><span>" +
        set().length +
        " ligações no período</span></div>";
      const legend = $("#vp-team-legend");
      if (legend) {
        legend.hidden = false;
        legend.innerHTML = '<b class="vp-series-dash"></b>' + referenceName;
      }
      const changeEl = $("#vp-history-change");
      if (changeEl) changeEl.textContent = signed(values[3] - values[0]) + " pts";

      const plot = host.querySelector(".vp-chart-plot") as HTMLElement;
      const chartTooltip = host.querySelector(".vp-chart-tooltip") as HTMLElement;
      const guide = host.querySelector(".vp-chart-guide") as SVGElement;
      let pinned: number | null = null;
      const show = (i: number) => {
        const difference = values[i] - references[i];
        chartTooltip.innerHTML =
          "<strong>" +
          names[i] +
          ' · 2026</strong><div><span><b class="vp-series-dot"></b>' +
          esc(owner) +
          "</span><b>" +
          fmt(values[i]) +
          ' <small>/ 100</small></b></div><div><span><b class="vp-series-dash"></b>' +
          referenceName.replace("Referência · ", "") +
          "</span><b>" +
          fmt(references[i]) +
          "</b></div><footer>" +
          buckets[i].length +
          " ligações analisadas <span>" +
          signed(difference) +
          " pts</span></footer>";
        chartTooltip.hidden = false;
        chartTooltip.style.left =
          Math.max(4, Math.min(width - chartTooltip.offsetWidth - 4, X(i) - chartTooltip.offsetWidth / 2)) + "px";
        chartTooltip.style.top = Math.max(5, Y(values[i]) - chartTooltip.offsetHeight - 15) + "px";
        guide.setAttribute("x1", String(X(i)));
        guide.setAttribute("x2", String(X(i)));
        guide.setAttribute("opacity", ".7");
        host.querySelectorAll(".vp-chart-hit").forEach((b, j) => b.setAttribute("aria-pressed", String(pinned === j)));
      };
      const hide = () => {
        if (pinned !== null) {
          show(pinned);
          return;
        }
        chartTooltip.hidden = true;
        guide.setAttribute("opacity", "0");
        host.querySelectorAll(".vp-chart-hit").forEach((b) => b.setAttribute("aria-pressed", "false"));
      };
      plot.addEventListener("pointermove", (e) => {
        if (e.pointerType === "touch") return;
        const x = e.clientX - plot.getBoundingClientRect().left;
        if (x < L - 10 || x > width - R + 10) return;
        show(Math.max(0, Math.min(3, Math.round(((x - L) / W) * 3))));
      });
      plot.addEventListener("pointerleave", hide);
      host.querySelectorAll(".vp-chart-hit").forEach((button) => {
        const i = Number((button as HTMLElement).dataset.point);
        button.addEventListener("focus", () => show(i));
        button.addEventListener("blur", hide);
        button.addEventListener("click", () => {
          pinned = pinned === i ? null : i;
          if (pinned === null) hide();
          else show(i);
        });
        button.addEventListener("keydown", (e: any) => {
          if (e.key === "Escape") {
            pinned = null;
            hide();
            button.setAttribute("aria-pressed", "false");
          }
        });
      });
      icons();
    }

    function spotlight(ranking: any[]) {
      const el = $("#vp-spotlight");
      if (!el) return;
      const best = ranking.slice().sort((a, b) => b.delta - a.delta)[0];
      const ordered = ranking.length >= 3 ? [ranking[1], ranking[0], ranking[2]] : ranking;

      el.innerHTML = `
        <div class="vp-panel-top">
          <div>
            <div class="vp-eyebrow">DESTAQUES DO PERÍODO</div>
            <h2>Quem está à frente</h2>
          </div>
          ${icon("award")}
        </div>
        <div class="vp-podium">
          ${ordered
            .map((p) => {
              const place = ranking.indexOf(p) + 1;
              return `
              <button type="button" class="vp-podium-person" data-person="${p.id}" data-place="${place}" aria-label="Ver ${esc(
                p.name
              )}, posição ${place}" data-tooltip="Abrir diagnóstico individual de ${esc(p.name)}">
                <span class="vp-podium-place">${place === 1 ? icon("trophy") : ""}${place}º</span>
                ${avatar(p)}
                <strong>${esc(p.name)}</strong>
                <span class="vp-podium-score">${fmt(p.score)}</span>
              </button>
            `;
            })
            .join("")}
        </div>
        <div class="vp-growth" data-tooltip="Maior evolução de pontuação média em relação ao período anterior">
          ${avatar(best)}
          <div>
            <div class="vp-growth-label">Maior evolução</div>
            <strong>${esc(best.name)}</strong>
            <p>${state.range === "macro" ? "Julho " + icon("arrow-right") + " outubro" : "Outubro vs. setembro"}</p>
          </div>
          <span class="vp-growth-value">${signed(best.delta)}</span>
        </div>
        <p class="vp-spotlight-note">Evolução em pontos · dados demonstrativos.</p>
      `;
    }

    const questionSets = [
      {
        high: "Como o atendimento funciona hoje, quais ferramentas vocês usam e quem participa de cada etapa?",
        mid: "Como vocês organizam o atendimento hoje?",
        low: "Vocês já usam algum sistema?",
        answer: "Hoje usamos três ferramentas. O comercial registra o pedido, o suporte confere e depois enviamos uma planilha para a gestão.",
        followHigh: "Então o pedido passa por três etapas e a informação precisa ser conferida entre as ferramentas. Entendi corretamente?",
        followMid: "Entendi como funciona hoje. Vamos olhar agora para as dificuldades desse processo.",
        followLow: "Certo, depois podemos ver esses detalhes.",
      },
      {
        high: "Em qual etapa aparecem mais erros? Pode me contar um caso recente e o que provocou o problema?",
        mid: "Qual é a maior dificuldade nesse processo?",
        low: "Vocês têm algum problema com isso?",
        answer: "O retrabalho acontece quando a informação muda e a outra equipe não recebe a atualização. Na semana passada precisamos corrigir vários pedidos.",
        followHigh: "Pelo exemplo, a causa parece ser a atualização não chegar à outra equipe. Isso se repete toda semana?",
        followMid: "Então o retrabalho é uma dificuldade importante para vocês. Vou considerar isso na proposta.",
        followLow: "Entendi. Nossa solução tem recursos para isso.",
      },
      {
        high: "Quantas pessoas refazem esse trabalho, quantas horas gastam por semana e o que deixam de fazer por causa disso?",
        mid: "Isso toma muito tempo da equipe?",
        low: "Esse problema atrapalha bastante?",
        answer: "Duas pessoas gastam cerca de quatro horas por semana com as correções. Nesse tempo, deixam de atender novos pedidos.",
        followHigh: "São oito horas da equipe por semana, além do atraso nos novos pedidos. É esse resultado que precisamos melhorar?",
        followMid: "Entendi que existe uma perda de tempo. Vamos avaliar uma solução para reduzir isso.",
        followLow: "Certo, então vou te mostrar as opções.",
      },
      {
        high: "Até quando a mudança precisa estar funcionando e o que acontece se vocês não estiverem prontos nessa data?",
        mid: "Quando vocês gostariam de resolver isso?",
        low: "Vocês têm alguma pressa?",
        answer: "Queremos ter isso funcionando antes da mudança de operação, no começo do próximo mês. Se atrasar, vamos iniciar a nova fase com o mesmo retrabalho.",
        followHigh: "Para iniciar o próximo mês sem esse retrabalho, precisamos considerar o prazo de implantação. Podemos organizar as etapas a partir dessa data?",
        followMid: "Vou considerar o começo do próximo mês como referência para a proposta.",
        followLow: "Entendi, podemos ver o prazo depois.",
      },
      {
        high: "Quem participa da avaliação, quais critérios vocês vão comparar e quais aprovações são necessárias para contratar?",
        mid: "Quem mais participa dessa decisão?",
        low: "Você pode aprovar a compra?",
        answer: "Eu avalio com o gestor de operações. Precisamos conferir integração, prazo e custo; depois a diretoria aprova a contratação.",
        followHigh: "Então a avaliação envolve você e operações, com esses três critérios, e a aprovação final é da diretoria. Podemos incluir operações na próxima conversa?",
        followMid: "Certo, vou preparar o material para você apresentar ao gestor.",
        followLow: "Tudo bem, eu mando a proposta e você conversa internamente.",
      },
    ];

    const descriptions = [
      {
        good: "Mapeou o processo, as ferramentas e os envolvidos e confirmou o entendimento com o cliente.",
        mid: "Identificou o contexto, mas não validou os envolvidos e as restrições com a mesma profundidade.",
        low: "A investigação ficou genérica. O vendedor adiou detalhes necessários para compreender a situação.",
        labels: ["Contexto e processo atual", "Validação do entendimento"],
      },
      {
        good: "Pediu um exemplo concreto, investigou a causa e verificou a recorrência do problema.",
        mid: "Identificou a dor, mas avançou antes de confirmar sua causa e frequência.",
        low: "O vendedor apresentou a solução antes de investigar a causa e a recorrência da dor.",
        labels: ["Investigação da causa", "Exemplos e recorrência"],
      },
      {
        good: "Dimensionou pessoas e horas e confirmou a consequência para a operação.",
        mid: "Reconheceu a perda de tempo, mas não aprofundou ou validou seu tamanho.",
        low: "A consequência do problema não foi dimensionada. A conversa avançou para opções de solução.",
        labels: ["Dimensionamento do impacto", "Validação das consequências"],
      },
      {
        good: "Investigou data e consequência do atraso e conectou o prazo ao planejamento da implantação.",
        mid: "Identificou um prazo desejado, mas não validou as consequências de não atendê-lo.",
        low: "A resposta sobre urgência não foi aprofundada. O prazo e sua consequência foram deixados para depois.",
        labels: ["Prazo e evento do cliente", "Consequência de perder a data"],
      },
      {
        good: "Mapeou pessoas, critérios e aprovação e propôs envolver a área participante no próximo passo.",
        mid: "Identificou outro participante, mas não confirmou critérios e etapas de aprovação.",
        low: "O vendedor delegou o encaminhamento da proposta sem mapear o processo de decisão.",
        labels: ["Participantes e critérios", "Processo e próximos passos"],
      },
    ];

    function conversation(call: any) {
      if (call.dialogue) return call.dialogue;
      const person = people.find((p) => p.id === call.seller)!;
      const turns: any[] = [];
      const add = (speaker: string, text: string, dimension: number | null = null, kind = "") => {
        const item: any = { id: "u" + turns.length, speaker, text, dimension, kind };
        turns.push(item);
        return item;
      };

      add("seller", "Olá, aqui é " + person.name + " da Tecfag. Obrigado por separar este horário. Podemos conversar sobre o processo de vocês?");
      add("client", "Podemos, sim. Quero entender se conseguimos organizar melhor essa operação.");
      add("seller", "Vou começar entendendo o cenário e o que vocês precisam melhorar. No final, combinamos um próximo passo.");

      call.evaluations = call.dims.map((value: number, i: number) => {
        const q = questionSets[i];
        const band = level(value);
        const ask = add("seller", q[band === "high" ? "high" : band === "low" ? "low" : "mid"], i, "question");
        const answer = add("client", q.answer, i, "answer");
        const follow = add("seller", q[band === "high" ? "followHigh" : band === "low" ? "followLow" : "followMid"], i, "follow");
        add("client", band === "high" ? "Isso mesmo. Esse é o ponto que precisamos considerar." : "Certo, podemos seguir.", i, "confirmation");
        const d = descriptions[i];
        const sub1 = Math.min(100, value + 4);
        const sub2 = 2 * value - sub1;
        return {
          dimension: i,
          value,
          band,
          ask,
          answer,
          follow,
          quote: band === "high" ? ask : follow,
          rationale: d[band === "high" ? "good" : band === "low" ? "low" : "mid"],
          subcriteria: [
            { label: d.labels[0], value: sub1 },
            { label: d.labels[1], value: sub2 },
          ],
          suggestion: q.high,
        };
      });

      add("seller", "Vou registrar os pontos da conversa e preparar o material para o próximo contato.");
      add("client", "Combinado. Pode me enviar o resumo para eu conferir.");
      add("seller", "Obrigado pelo tempo. Vou encaminhar o resumo e confirmar o próximo horário com você.");
      add("client", "Obrigado. Até a próxima.");

      turns.forEach((turn, i) => (turn.seconds = Math.round((i * (call.duration - 8)) / (turns.length - 1))));
      call.dialogue = turns;
      return turns;
    }

    function statistics() {
      const person = people.find((p) => p.id === state.seller);
      const list = set();
      const delta = evolution();
      const under = list.filter((c) => c.score < 65).length;

      const ownerEl = $("#vp-score-owner");
      if (ownerEl) ownerEl.textContent = person ? person.name : "Equipe comercial";
      const titleEl = $("#vp-history-title");
      if (titleEl) titleEl.textContent = person ? "Evolução de " + person.name.split(" ")[0] : "Evolução da equipe";
      const capEl = $("#vp-history-caption");
      if (capEl)
        capEl.textContent =
          state.range === "macro" ? "Média mensal · julho a outubro de 2026" : "Média por intervalo · outubro de 2026";
      const seriesEl = $("#vp-series-name");
      if (seriesEl) seriesEl.textContent = person ? person.name.split(" ")[0] : "Equipe";
      const legendEl = $("#vp-team-legend");
      if (legendEl) legendEl.hidden = !person;

      const statsEl = $("#vp-statistics");
      if (statsEl) {
        statsEl.innerHTML = `
          <div data-tooltip="Total de chamadas do vendedor ou equipe submetidas à análise automatizada">
            <span class="vp-stat-label">Ligações analisadas</span>
            <strong class="vp-stat-value">${list.length}</strong>
            <span class="vp-stat-context">${person ? "No período do painel" : people.length + " vendedores"}</span>
          </div>
          <div data-tooltip="Variação da média SPICED em relação ao intervalo anterior">
            <span class="vp-stat-label">Evolução</span>
            <strong class="vp-stat-value" style="color:var(--vp-green)">${signed(delta)} <small>pts</small></strong>
            <span class="vp-stat-context">${state.range === "macro" ? "Jul " + icon("arrow-right") + " out" : "vs. 01–19 set"}</span>
          </div>
          <div data-tooltip="Ligações que obtiveram pontuação geral abaixo de 65 pontos (faixa crítica)">
            <span class="vp-stat-label">Em atenção</span>
            <strong class="vp-stat-value">${under} <small>ligações</small></strong>
            <span class="vp-stat-context">Nota abaixo de 65</span>
          </div>
        `;
      }

      const dims = dimsOf(list);
      const weak = dims.indexOf(Math.min(...dims));

      const spicedEl = $("#vp-spiced");
      if (spicedEl) {
        spicedEl.innerHTML = dims
          .map(
            (v, i) => `
          <div class="vp-dimension" data-weak="${i === weak}" data-spiced-key="${dimensions[i][0]}" data-spiced-val="${fmt(
              v
            )}" tabindex="0" role="button" aria-label="Dimensão ${dimensions[i][1]}, nota ${fmt(v)} de 100.">
            <span class="vp-dimension-top"><b>${dimensions[i][0]}</b></span>
            <span class="vp-dimension-label">${dimensions[i][1]}</span>
            <strong class="vp-dimension-value">${fmt(v)}</strong>
            <div class="vp-bar" role="meter" aria-label="${dimensions[i][1]}" aria-valuenow="${v.toFixed(
              1
            )}" aria-valuemin="0" aria-valuemax="100">
              <span style="width:${v}%"></span>
            </div>
          </div>
        `
          )
          .join("");
      }
    }

    function teamScreen() {
      main.innerHTML = template("vp-overview-template");
      renderHeaderControls();

      const countEl = $(".vp-ranking-panel .vp-count");
      if (countEl) countEl.textContent = people.length + " vendedores";
      statistics();

      const ranking = rank();
      const rankEl = $("#vp-ranking");
      if (rankEl) {
        rankEl.innerHTML = ranking
          .map(
            (p, i) => `
          <button type="button" class="vp-rank-row" data-person="${p.id}" aria-label="Abrir perfil de ${p.name}" data-tooltip="Ver diagnóstico e gravações de ${p.name}">
            <span class="vp-rank-person">
              <span class="vp-rank-position">${String(i + 1).padStart(2, "0")}</span>
              ${avatar(p)}
              <span>
                <strong class="vp-rank-name">${p.name}</strong>
                <span class="vp-rank-role">Equipe comercial</span>
              </span>
            </span>
            <span class="vp-rank-score">${fmt(p.score)}</span>
            <span class="vp-rank-delta">${icon("trending-up")} <span class="vp-delta-text">${signed(p.delta)}</span></span>
            <span class="vp-rank-count">${p.count}</span>
            ${icon("chevron-right")}
          </button>
        `
          )
          .join("");
      }

      spotlight(ranking);
      const dims = dimsOf(set());
      const weak = dims.indexOf(Math.min(...dims));
      const focusEl = $("#vp-focus-text");
      if (focusEl) {
        focusEl.textContent =
          dimensions[weak][1] +
          " é a principal oportunidade de desenvolvimento da equipe. Abra um vendedor para consultar os trechos da conversa e investigar suas ligações.";
      }

      gauge();
      history();
    }

    function evidenceCards(kind: "good" | "attention") {
      const entries: any[] = [];
      set().forEach((c) => {
        conversation(c);
        c.evaluations.forEach((e: any) => {
          if (kind === "good" ? e.value >= 80 : e.value < 80) {
            entries.push({ call: c, evaluation: e });
          }
        });
      });

      entries.sort((a, b) => (kind === "good" ? b.evaluation.value - a.evaluation.value : a.evaluation.value - b.evaluation.value));
      const chosen: any[] = [];
      for (const item of entries) {
        if (!chosen.some((x) => x.evaluation.dimension === item.evaluation.dimension)) {
          chosen.push(item);
          if (chosen.length === 2) break;
        }
      }

      if (!chosen.length) {
        return '<p class="vx-small-note">Nenhum exemplo nesta faixa de avaliação no período selecionado.</p>';
      }

      return chosen
        .map(
          ({ call, evaluation: e }) => `
        <article class="vx-quote-card">
          <div class="vx-quote-top">
            <strong>${dimensions[e.dimension][1]}</strong>
            <span>${fmt(e.value)} / 100</span>
          </div>
          <blockquote>“${esc(e.quote.text)}”</blockquote>
          <p>${e.rationale}</p>
          <div class="vx-quote-bottom">
            <span>${call.client} · ${date(call)}</span>
            <button type="button" class="vp-text-button" data-evidence-call="${call.id}" data-line="${
            e.quote.id
          }" data-tooltip="Abrir esta conversa e destacar esta fala na gravação">
              ${icon("headphones")}Abrir trecho ${time(e.quote.seconds)}
            </button>
          </div>
        </article>
      `
        )
        .join("");
    }

    function minutagePanel() {
      const datepickerHtml = renderCustomDatePicker({
        id: "vx-minutage-day",
        value: minutageDay,
        tooltip: "Alterar a data de referência para o cálculo da meta de tempo em chamada",
      });

      return `
        <section class="vp-panel vx-minutage" aria-label="Meta individual de tempo em ligação">
          <div class="vp-panel-top">
            <div>
              <div class="vp-eyebrow">CONSTÂNCIA COMERCIAL</div>
              <h2>Tempo em ligação</h2>
              <p>Metas individuais · 1 hora por dia e 5 horas por semana</p>
            </div>
            <div class="vx-minutage-date-wrapper">
              <span class="vx-minutage-date-label">Dia de referência</span>
              ${datepickerHtml}
            </div>
          </div>
          <div id="vx-minutage-results" aria-live="polite" aria-atomic="true"></div>
          <p class="vx-minutage-note">Durações demonstrativas das ligações deste vendedor. Referência inicial: último dia com ligações na prévia. A semana vai de segunda a domingo.</p>
        </section>
      `;
    }

    function minutageResults() {
      const data: any = TecfagMinutage.summarize(calls, state.seller, minutageDay);
      const duration = TecfagMinutage.duration;
      const short = (day: string) => day.slice(8, 10) + "/" + day.slice(5, 7);
      const full = (day: string) => short(day) + "/" + day.slice(0, 4);

      const card = (key: string, title: string, period: string, goal: string, iconName: string) => {
        const item = data[key];
        const percent = (item.seconds / item.target) * 100;
        const complete = item.seconds >= item.target;
        const st = complete ? "Meta atingida" : item.count ? "Em progresso" : "Sem ligações registradas";
        return `
          <article class="vx-time-card" data-complete="${complete}" data-tooltip="${title}: ${duration(
          item.seconds
        )} de ${goal} acumuladas (${fmt(percent)}%)">
            <div class="vx-time-label">${icon(iconName)}${title}</div>
            <p class="vx-time-period">${period}</p>
            <div class="vx-time-total">
              <strong>${duration(item.seconds)}</strong>
              <span>de ${goal} em ligação</span>
            </div>
            <div class="vx-time-progress-label">
              <span>${st}</span>
              <strong>${fmt(percent)}% da meta</strong>
            </div>
            <div class="vx-time-meter" role="progressbar" aria-label="${title}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.min(
          100,
          percent
        ).toFixed(1)}" aria-valuetext="${duration(item.seconds)} de ${goal}; ${fmt(percent)}% da meta">
              <span style="width:${Math.min(100, percent)}%"></span>
            </div>
            <div class="vx-time-footer">
              <span>${item.count} ${item.count === 1 ? "ligação" : "ligações"}</span>
              <span>${
                complete
                  ? item.seconds === item.target
                    ? "Meta concluída"
                    : duration(item.seconds - item.target) + " acima da meta"
                  : "Faltam " + duration(item.target - item.seconds)
              }</span>
            </div>
          </article>
        `;
      };

      const resultsEl = $("#vx-minutage-results");
      if (resultsEl) {
        resultsEl.innerHTML = `<div class="vx-time-grid">${card("daily", "Meta diária", full(data.day), "1h", "clock-3")}${card(
          "weekly",
          "Meta semanal",
          short(data.start) + " a " + full(data.end),
          "5h",
          "calendar-range"
        )}</div>`;
      }

      const summary = (key: string, title: string, period: string, goal: string, iconName: string) => {
        const item = data[key];
        const percent = (item.seconds / item.target) * 100;
        const complete = item.seconds >= item.target;
        return `
          <article class="vx-time-summary-card" data-complete="${complete}" data-tooltip="${title}: ${duration(
          item.seconds
        )} / ${goal} (${fmt(percent)}%)">
            <div class="vx-time-summary-label">
              <span>${icon(iconName)}${title}</span>
              <strong>${fmt(percent)}%</strong>
            </div>
            <div class="vx-time-summary-total">
              <strong>${duration(item.seconds)}</strong>
              <span>/ ${goal}</span>
            </div>
            <div class="vx-time-meter" role="progressbar" aria-label="Resumo da ${title.toLowerCase()}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.min(
          100,
          percent
        ).toFixed(1)}" aria-valuetext="${duration(item.seconds)} de ${goal}; ${fmt(percent)}% da meta">
              <span style="width:${Math.min(100, percent)}%"></span>
            </div>
            <div class="vx-time-summary-period">
              <span>${period}</span>
              <span>${complete ? "Meta atingida" : "Faltam " + duration(item.target - item.seconds)}</span>
            </div>
          </article>
        `;
      };

      const summaryEl = $("#vx-minutage-summary");
      if (summaryEl) {
        summaryEl.innerHTML =
          summary("daily", "Meta diária", short(data.day), "1h", "clock-3") +
          summary("weekly", "Meta semanal", short(data.start) + "–" + short(data.end), "5h", "calendar-range");
      }

      icons();
    }

    function sellerCalls(animate = false) {
      const list = (state.scope === "period" ? set() : calls.filter((c) => c.seller === state.seller))
        .filter((c) => c.client.toLocaleLowerCase("pt-BR").includes(state.query.toLocaleLowerCase("pt-BR")))
        .filter((c) => !state.onlyAttention || c.score < 65)
        .sort((a, b) => b.month - a.month || b.day - a.day);

      const total = list.length;
      const pageCount = Math.max(1, Math.ceil(total / 8));
      state.page = Math.min(state.page, pageCount);

      const totalEl = $("#vx-total-calls");
      if (totalEl) totalEl.textContent = total + " ligações";

      const visible = list.slice((state.page - 1) * 8, state.page * 8);

      const containerEl = $("#vx-seller-calls");
      if (!containerEl) return;

      containerEl.innerHTML =
        (total
          ? `
        <div class="vx-table-scroll">
          <table class="vx-call-table">
            <thead>
              <tr>
                <th>Cliente</th>
                <th>Data</th>
                <th>Duração</th>
                <th>Nota geral</th>
                <th>Ponto de atenção</th>
                <th>Análise</th>
              </tr>
            </thead>
            <tbody>
              ${visible
                .map((c) => {
                  const weakest = c.dims.indexOf(Math.min(...c.dims));
                  return `
                  <tr>
                    <td>${c.client}<small>Diagnóstico comercial</small></td>
                    <td>${date(c)}</td>
                    <td>${time(c.duration)}</td>
                    <td>${chip(c.score)}</td>
                    <td><span class="vx-weak-pill" data-spiced-key="${dimensions[weakest][0]}" data-spiced-val="${fmt(
                    c.dims[weakest]
                  )}">${dimensions[weakest][1]}</span></td>
                    <td>
                      <button class="vp-text-button" type="button" data-call="${c.id}" data-tooltip="Ouvir gravação e ler transcrição desta chamada">
                        Abrir ligação ${icon("arrow-up-right")}
                      </button>
                    </td>
                  </tr>
                `;
                })
                .join("")}
            </tbody>
          </table>
        </div>
      `
          : '<div class="vx-empty">Nenhuma ligação encontrada com os filtros aplicados.</div>') +
        `
        <div class="vx-pagination">
          <span>${
            total ? (state.page - 1) * 8 + 1 + "–" + Math.min(state.page * 8, total) + " de " + total + " ligações" : "0 ligações"
          } · ${state.scope === "all" ? "todo o histórico" : "período do painel"}${
          state.onlyAttention ? " · apenas notas em atenção" : ""
        }</span>
          <div class="vx-page-controls">
            <button type="button" data-page="-1" aria-label="Página anterior" ${
              state.page === 1 ? "disabled" : ""
            } data-tooltip="Página anterior">${icon("chevron-left")}</button>
            <span>Página ${state.page} de ${pageCount}</span>
            <button type="button" data-page="1" aria-label="Próxima página" ${
              state.page >= pageCount ? "disabled" : ""
            } data-tooltip="Próxima página">${icon("chevron-right")}</button>
          </div>
        </div>
      `;

      icons();
      if (animate) motion.rows(containerEl.querySelectorAll("tbody tr"));
    }

    function sellerScreen() {
      const person = people.find((p) => p.id === state.seller) || people[0];
      state.seller = person.id;
      const position = rank().findIndex((p) => p.id === person.id) + 1;
      renderHeaderControls();

      const scopeOptions = [
        { value: "all", label: "Todo o histórico", icon: "history" },
        { value: "period", label: "Período do painel", icon: "calendar" },
      ];
      const scopeSelectHtml = renderCustomSelect({
        id: "vx-call-scope",
        value: state.scope,
        options: scopeOptions,
        tooltip: "Filtrar abrangência das ligações listadas",
        ariaLabel: "Abrangência do histórico",
      });

      main.innerHTML = `
        <div class="vx-back-row">
          <button class="vx-back" type="button" data-team-back data-tooltip="Retornar à visão consolidada da equipe">
            ${icon("arrow-left")}Voltar para a equipe
          </button>
          <span class="vx-breadcrumb">Equipe / ${person.name}</span>
        </div>
        <div class="vx-person-heading">
          ${avatar(person)}
          <div>
            <div class="vp-eyebrow">PERFIL DO VENDEDOR</div>
            <h1>${person.name}</h1>
            <p>Equipe comercial · ${position}º no ranking de qualidade</p>
          </div>
          <div id="vx-minutage-summary" class="vx-time-summary" role="group" aria-label="Resumo das metas de tempo em ligação"></div>
        </div>
        ${template("vp-hero-template")}
        ${template("vp-spiced-template")}
        ${minutagePanel()}
        <div class="vx-section-heading">
          <div>
            <h2>Comportamentos que explicam o desempenho</h2>
            <p>Trechos literais da transcrição demonstrativa, com acesso à ligação de origem.</p>
          </div>
        </div>
        <div class="vx-evidence-columns">
          <section class="vp-panel vx-evidence-panel" data-tone="good" aria-label="Melhores atitudes do vendedor">
            <div class="vp-panel-top">
              <div>
                <div class="vp-eyebrow">O QUE REPETIR</div>
                <h2>Melhores atitudes</h2>
                <p>Boas práticas observadas no período do painel</p>
              </div>
              ${icon("circle-check")}
            </div>
            ${evidenceCards("good")}
          </section>
          <section class="vp-panel vx-evidence-panel" data-tone="attention" aria-label="Atitudes que precisam de atenção">
            <div class="vp-panel-top">
              <div>
                <div class="vp-eyebrow">ONDE DESENVOLVER</div>
                <h2>Pontos de atenção</h2>
                <p>Falas e comportamentos a revisar com o vendedor</p>
              </div>
              ${icon("circle-alert")}
            </div>
            ${evidenceCards("attention")}
          </section>
        </div>
        <section class="vp-panel vp-calls-panel" aria-label="Todas as ligações do vendedor">
          <div class="vp-panel-top">
            <div>
              <div class="vp-eyebrow">HISTÓRICO INDIVIDUAL</div>
              <h2>Todas as ligações de ${person.name.split(" ")[0]}</h2>
              <p>Acesse cada conversa, a transcrição e sua avaliação.</p>
            </div>
            <span id="vx-total-calls" class="vp-count"></span>
          </div>
          <div class="vx-list-controls">
            <label class="vx-search" data-tooltip="Filtrar chamadas por nome do cliente ou empresa">
              ${icon("search")}
              <input id="vx-call-search" type="search" aria-label="Buscar cliente nas ligações" placeholder="Buscar cliente..." value="${esc(
                state.query
              )}">
            </label>
            ${scopeSelectHtml}
            <label class="tecfag-checkbox" data-tooltip="Exibir apenas ligações com pontuação abaixo de 65 (faixa de atenção)">
              <input type="checkbox" id="vx-filter-attention" ${state.onlyAttention ? "checked" : ""}>
              <span class="tecfag-checkbox-box">${icon("check")}</span>
              <span>Apenas em atenção</span>
            </label>
          </div>
          <div id="vx-seller-calls"></div>
        </section>
        ${template("vp-footer-template")}
      `;

      initCustomSelect("vx-call-scope", (val) => {
        state.scope = val;
        state.page = 1;
        sellerCalls(true);
      });

      initCustomDatePicker("vx-minutage-day", (newDate) => {
        minutageDay = newDate;
        minutageResults();
      });

      const chkAttention = $("#vx-filter-attention") as HTMLInputElement | null;
      if (chkAttention) {
        chkAttention.addEventListener("change", (e: any) => {
          state.onlyAttention = e.target.checked;
          state.page = 1;
          sellerCalls(true);
        });
      }

      statistics();
      sellerCalls();
      gauge();
      history();
      minutageResults();
    }

    function evaluationCard(e: any) {
      const quote = e.quote;
      const currentCall = calls.find((c) => c.id === state.call);
      const weakestIndex = currentCall ? currentCall.dims.indexOf(Math.min(...currentCall.dims)) : -1;
      const open = state.seekLine
        ? [e.ask.id, e.answer.id, e.follow.id].includes(state.seekLine)
        : e.dimension === weakestIndex;

      return `
        <details class="vx-evaluation" data-eval="${e.dimension}" ${open ? "open" : ""}>
          <summary>
            <span class="vx-evaluation-letter" data-spiced-key="${dimensions[e.dimension][0]}" data-spiced-val="${fmt(
        e.value
      )}">${dimensions[e.dimension][0]}</span>
            <span class="vx-evaluation-name">
              <strong>${dimensions[e.dimension][1]}</strong>
              <small>${status(e.value)}</small>
            </span>
            <strong class="vx-evaluation-score">${fmt(e.value)} <small>/ 100</small></strong>
          </summary>
          <div class="vx-evaluation-content">
            <div>
              <h3>Por que recebeu esta nota</h3>
              <p>${e.rationale}</p>
            </div>
            <div class="vx-subcriteria">
              ${e.subcriteria
                .map(
                  (s: any) => `
                <div class="vx-subcriterion">
                  <span>${s.label}</span>
                  <b>${fmt(s.value)} / 100</b>
                </div>
              `
                )
                .join("")}
            </div>
            <blockquote class="vx-evaluation-quote">
              <small>Vendedor · ${time(quote.seconds)}</small>“${esc(quote.text)}”<br>
              <button type="button" data-seek="${quote.id}" data-tooltip="Saltar para este trecho na transcrição e áudio">
                Localizar na transcrição ${icon("arrow-up-right")}
              </button>
            </blockquote>
            <blockquote class="vx-evaluation-quote">
              <small>Cliente · ${time(e.answer.seconds)}</small>“${esc(e.answer.text)}”<br>
              <button type="button" data-seek="${e.answer.id}" data-tooltip="Visualizar a resposta completa do cliente">
                Ver resposta no contexto
              </button>
            </blockquote>
            <div>
              <h3>${e.band === "high" ? "Boa prática a manter" : "Como poderia aprofundar"}</h3>
              <p>${
                e.band === "high"
                  ? "Manter a investigação contextualizada e confirmar o entendimento antes de avançar."
                  : "“" + esc(e.suggestion) + "”"
              }</p>
            </div>
          </div>
        </details>
      `;
    }

    function attachAudio() {
      const audio = $("#vx-audio") as HTMLAudioElement | null;
      const playerRoot = $("#vx-player-root");
      if (!audio || !playerRoot || !state.call) return;
      const callId = state.call;
      const recorded = recordings.get(callId);
      const player = new TecfagPlayer(audio, playerRoot, {
        name: recorded?.name || "",
        rate: recorded?.rate || 1,
        volume: recorded?.volume ?? 1,
      });

      const fileInput = $("#vx-audio-file") as HTMLInputElement | null;
      if (fileInput) {
        fileInput.addEventListener("change", (e: any) => {
          const file = e.target.files?.[0];
          if (!file) return;
          if (!file.type.startsWith("audio/") && !/\.(mp3|wav|m4a|ogg|webm|aac|flac)$/i.test(file.name)) {
            const noteEl = $("#vx-audio-note");
            if (noteEl) noteEl.textContent = "Selecione um arquivo de áudio compatível.";
            return;
          }
          const old = recordings.get(callId);
          if (old) URL.revokeObjectURL(old.url);
          const rec = {
            url: URL.createObjectURL(file),
            name: file.name,
            time: 0,
            rate: audio.playbackRate,
            volume: audio.volume,
          };
          recordings.set(callId, rec);
          player.setName(file.name);
          audio.src = rec.url;
          audio.load();
          const stEl = $("#vx-audio-status");
          if (stEl) stEl.textContent = "Arquivo local selecionado";
          const noteEl = $("#vx-audio-note");
          if (noteEl) {
            noteEl.textContent =
              "Áudio local: " +
              file.name +
              ". A transcrição e as notas continuam demonstrativas, sem sincronização validada.";
          }
        });
      }

      audio.addEventListener("error", () => {
        const noteEl = $("#vx-audio-note");
        if (noteEl) {
          noteEl.textContent = "Não foi possível reproduzir esse arquivo. Tente uma gravação em MP3, WAV ou M4A.";
        }
      });
      if (recorded?.time) {
        audio.addEventListener(
          "loadedmetadata",
          () => {
            audio.currentTime = Math.min(recorded.time, audio.duration || recorded.time);
          },
          { once: true }
        );
      }
      audio.addEventListener("timeupdate", () => {
        const rec = recordings.get(callId);
        if (rec) rec.time = audio.currentTime;
      });
      audio.addEventListener("ratechange", () => {
        const rec = recordings.get(callId);
        if (rec) rec.rate = audio.playbackRate;
      });
      audio.addEventListener("volumechange", () => {
        const rec = recordings.get(callId);
        if (rec) rec.volume = audio.volume;
      });
    }

    function seekTranscript(id: string, seekAudio = true) {
      const call = calls.find((c) => c.id === state.call);
      if (!call) return;
      const turn = conversation(call).find((t: any) => t.id === id);
      if (!turn) return;

      $$(".vx-utterance").forEach((el) => (el.dataset.highlight = String(el.id === "line-" + id)));
      const target = $("#line-" + id);
      if (target) {
        target.scrollIntoView({
          block: "nearest",
          behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
        });
        motion.highlight(target);
      }

      if (seekAudio && recordings.has(call.id)) {
        const audio = $("#vx-audio") as HTMLAudioElement | null;
        if (audio && Number.isFinite(audio.duration)) {
          audio.currentTime = Math.min(turn.seconds, Math.max(0, audio.duration - 0.1));
        }
      }
    }

    function callScreen() {
      const call = calls.find((c) => c.id === state.call) || calls[0];
      state.call = call.id;
      state.seller = call.seller;
      const person = people.find((p) => p.id === call.seller)!;
      const dialogue = conversation(call);
      const recording = recordings.get(call.id);
      renderHeaderControls();

      main.innerHTML = `
        <div class="vx-back-row">
          <button class="vx-back" type="button" data-seller-back data-tooltip="Retornar ao perfil de ${person.name}">
            ${icon("arrow-left")}Voltar para ${person.name.split(" ")[0]}
          </button>
          <span class="vx-breadcrumb">Equipe / ${person.name} / Ligação</span>
        </div>
        <div class="vx-call-heading">
          <div>
            <div class="vp-eyebrow">ANÁLISE DA LIGAÇÃO</div>
            <h1>${call.client}</h1>
            <p class="vx-call-owner">${avatar(person)}${person.name} · ${date(call)} · ${time(
        call.duration
      )} · Diagnóstico comercial</p>
          </div>
          <div class="vx-call-score">
            <strong>${fmt(call.score)}</strong>
            <div>
              <span>NOTA GERAL / 100</span>
              <b>${status(call.score)}</b>
            </div>
          </div>
        </div>
        <div class="vx-evidence-disclaimer">
          Prévia: as falas, transcrições e avaliações desta conversa são demonstrativas. Os trechos reais serão vinculados às gravações na integração.
        </div>
        <section class="vp-panel vx-audio-section" aria-label="Gravação completa da ligação">
          <div class="vp-panel-top">
            <div>
              <h2>Ouvir a ligação completa</h2>
              <p>Reprodução, pausa, avanço e controle de volume.</p>
            </div>
            <span id="vx-audio-status" class="vx-audio-status">${icon("headphones")}${
        recording ? "Arquivo local selecionado" : "Gravação ainda não vinculada"
      }</span>
          </div>
          <audio id="vx-audio" class="vx-media-engine" preload="metadata" aria-hidden="true" ${
            recording ? 'src="' + recording.url + '"' : ""
          }></audio>
          <div id="vx-player-root"></div>
          <p id="vx-audio-note" class="vx-small-note">
            ${
              recording
                ? "Áudio local: " +
                  esc(recording.name) +
                  ". A transcrição e as notas abaixo continuam demonstrativas, sem sincronização validada."
                : "Selecione um arquivo de áudio para experimentar o player. O arquivo fica apenas neste navegador e não é enviado a um servidor."
            }
          </p>
        </section>
        <div class="vx-call-body">
          <section class="vp-panel vx-transcript-panel" aria-label="Transcrição da ligação">
            <div class="vp-panel-top">
              <div>
                <h2>Transcrição da conversa</h2>
                <p>${dialogue.length} falas · vendedor e cliente identificados</p>
              </div>
              <span class="vp-count">Exemplo demonstrativo</span>
            </div>
            <div class="vx-transcript-scroll" id="vx-transcript">
              ${dialogue
                .map(
                  (turn: any) => `
                <article class="vx-utterance" id="line-${turn.id}" data-speaker="${turn.speaker}" data-highlight="${
                    state.seekLine === turn.id
                  }">
                  <button type="button" data-seek="${turn.id}" aria-label="Localizar fala em ${time(
                    turn.seconds
                  )}" data-tooltip="Ouvir e destacar fala às ${time(turn.seconds)}">${time(turn.seconds)}</button>
                  <div>
                    <strong>${esc(turn.speaker === "seller" ? person.name : "Cliente")}</strong>
                    <p>${esc(turn.text)}</p>
                  </div>
                </article>
              `
                )
                .join("")}
            </div>
            <div class="vx-transcript-footer">Clique no horário para localizar um trecho. Falas desta prévia são fictícias.</div>
          </section>
          <section class="vx-evaluations" aria-label="Notas e justificativas de cada dimensão">
            <div class="vx-section-heading">
              <div>
                <h2>Avaliação SPICED, ponto a ponto</h2>
                <p>Passe o mouse sobre as letras para ver os critérios da metodologia SPICED.</p>
              </div>
            </div>
            ${call.evaluations.map(evaluationCard).join("")}
            <details class="vx-formula">
              <summary>Como a nota geral é calculada</summary>
              <p>(${call.dims.map(fmt).join(" + ")}) ÷ 5 = <strong>${fmt(call.score)}</strong>.</p>
              <p>Cada dimensão tem peso de 20%. Dentro dela, os dois critérios têm pesos iguais. Essa é uma régua demonstrativa, sujeita à calibração.</p>
            </details>
          </section>
        </div>
        ${template("vp-footer-template")}
      `;

      attachAudio();
      if (state.seekLine) {
        const line = state.seekLine;
        requestAnimationFrame(() => {
          if (state.screen === "call" && state.call === call.id && $("#vx-transcript")) {
            seekTranscript(line, false);
          }
        });
      }
    }

    function render(options: { kind?: string; direction?: string; resetScroll?: boolean } = { kind: "period" }) {
      return motion.change(() => {
        const audio = $("#vx-audio") as HTMLAudioElement | null;
        if (audio) audio.pause();

        if (state.screen === "team") teamScreen();
        else if (state.screen === "seller") sellerScreen();
        else callScreen();

        const person = people.find((p) => p.id === state.seller);
        const bcEl = $("#vp-breadcrumb");
        if (bcEl) {
          bcEl.textContent = person
            ? " / " + person.name + (state.screen === "call" ? " / Análise da ligação" : "")
            : "";
        }
        icons();
      }, options);
    }

    /* ==========================================================================
       8. EVENT DELEGATION & OBSERVERS
       ========================================================================== */
    const onRootClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;

      const person = target.closest("[data-person]") as HTMLElement | null;
      if (person && person.dataset.person) {
        go("#/vendedor/" + person.dataset.person);
        return;
      }

      if (target.closest("[data-team-back]")) {
        go("#/equipe");
        return;
      }
      if (target.closest("[data-seller-back]")) {
        go("#/vendedor/" + state.seller);
        return;
      }

      const range = target.closest("[data-range]") as HTMLElement | null;
      if (range && range.dataset.range) {
        state.range = range.dataset.range;
        try {
          localStorage.setItem("tecfag.voice.range", state.range);
        } catch {}
        render();
        return;
      }

      const call = target.closest("[data-call]") as HTMLElement | null;
      if (call && call.dataset.call) {
        go("#/ligacao/" + call.dataset.call);
        return;
      }

      const evidence = target.closest("[data-evidence-call]") as HTMLElement | null;
      if (evidence && evidence.dataset.evidenceCall) {
        go("#/ligacao/" + evidence.dataset.evidenceCall + "?trecho=" + evidence.dataset.line);
        return;
      }

      const seek = target.closest("[data-seek]") as HTMLElement | null;
      if (seek && seek.dataset.seek) {
        seekTranscript(seek.dataset.seek);
        return;
      }

      const page = target.closest("[data-page]") as HTMLElement | null;
      if (page && page.dataset.page) {
        state.page += Number(page.dataset.page);
        sellerCalls(true);
      }
    };

    const onRootInput = (e: Event) => {
      const target = e.target as HTMLInputElement | null;
      if (target && target.id === "vx-call-search") {
        state.query = target.value;
        state.page = 1;
        sellerCalls(true);
      }
    };

    root.addEventListener("click", onRootClick);
    root.addEventListener("input", onRootInput);

    const fullscreenBtn = $("#preview-fullscreen");
    const onFullscreenClick = async () => {
      try {
        if (document.fullscreenElement) await document.exitFullscreen();
        else await root.requestFullscreen();
      } catch {
        if (fullscreenBtn) fullscreenBtn.textContent = "Use F11";
      }
    };
    fullscreenBtn?.addEventListener("click", onFullscreenClick);

    const onFullscreenChange = () => {
      const button = $("#preview-fullscreen");
      if (!button) return;
      const isFs = Boolean(document.fullscreenElement);
      button.innerHTML = isFs
        ? `${icon("minimize-2")} <span>Sair da tela cheia</span>`
        : `${icon("maximize-2")} <span>Tela cheia</span>`;
      button.setAttribute("aria-label", isFs ? "Sair da tela cheia" : "Abrir prévia em tela cheia");
      icons();
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);

    let previousWidth = 0;
    const resizeObs = new ResizeObserver((entries) => {
      const width = entries[0].contentRect.width;
      if (Math.abs(width - previousWidth) < 1) return;
      const initial = previousWidth === 0;
      previousWidth = width;
      if (!initial && state.screen !== "call") {
        motion.resize(() => {
          gauge();
          history();
        });
      }
    });
    resizeObs.observe(root);

    render({ kind: "initial" });

    return () => {
      resizeObs.disconnect();
      motion.destroy();
      root.removeEventListener("mouseover", onMouseOver);
      root.removeEventListener("mouseout", onMouseOut);
      root.removeEventListener("focusin", onFocusIn);
      root.removeEventListener("focusout", hideTooltip);
      root.removeEventListener("click", onRootClick);
      root.removeEventListener("input", onRootInput);
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
      document.removeEventListener("click", closeAllPopovers);
      document.removeEventListener("keydown", onKeyDownClose);
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      fullscreenBtn?.removeEventListener("click", onFullscreenClick);
      tooltipEl.remove();
      for (const rec of recordings.values()) {
        URL.revokeObjectURL(rec.url);
      }
    };
  }, []);

  useEffect(() => {
    navigateRef.current?.(activeScreen);
  }, [activeScreen]);

  return (
    <div className="voice-score-scroll-host flex-1 overflow-y-auto overflow-x-hidden">
      <div
        ref={rootRef}
        id="tecfag-performance"
        data-appearance="dark"
        aria-label="Tecfag Chat, módulo de qualidade das ligações"
      >
        <div className="vp-workspace">
          <header className="vp-appbar">
            <div className="vp-appbar-inner">
              <div className="vp-appbar-left">
                <div className="vp-appbar-breadcrumb">
                  <strong>Tecfag Chat</strong>
                  <span className="vp-appbar-slash">/</span>
                  <span>Ligações</span>
                  <span id="vp-breadcrumb" />
                </div>
                <div className="vp-appbar-heading">
                  <span className="vp-eyebrow">QUALIDADE DAS LIGAÇÕES</span>
                  <div className="vp-appbar-title-group">
                    <h1 className="vp-appbar-title">
                      Performance comercial<span>.</span>
                    </h1>
                    <span
                      className="vp-method"
                      data-tooltip="Metodologia SPICED: Situação, Dor, Impacto, Evento Crítico e Decisão"
                    >
                      <i data-lucide="scan-line" aria-hidden="true" />
                      SPICED
                    </span>
                  </div>
                  <p className="vp-appbar-subtitle">Uma visão clara de quem evolui e de onde atuar.</p>
                </div>
              </div>
              <div className="vp-appbar-right">
                <div className="vx-header-actions">
                  <span
                    className="vp-preview"
                    data-tooltip="Dados demonstrativos de ligações e métricas de diagnóstico"
                  >
                    <b />
                    Prévia · avaliações demonstrativas
                  </span>
                  <button
                    id="preview-fullscreen"
                    type="button"
                    className="vx-fullscreen"
                    aria-label="Abrir prévia em tela cheia"
                    data-tooltip="Alternar modo tela cheia"
                  >
                    <i data-lucide="maximize-2" aria-hidden="true" />
                    <span>Tela cheia</span>
                  </button>
                </div>
                <div id="vp-appbar-controls" className="vp-appbar-controls" />
              </div>
            </div>
          </header>
          <main className="vp-main" id="vp-content" />
        </div>
      </div>
    </div>
  );
}

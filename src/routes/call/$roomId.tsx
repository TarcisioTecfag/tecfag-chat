import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState, useCallback } from "react";
import { Clock, Link2Off, MicOff, CheckCircle2, Radio, Phone, Mic } from "lucide-react";

// ─── Configuração ICE ─────────────────────────────────────────────────────────

const ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  {
    urls: `turn:${import.meta.env.VITE_METERED_DOMAIN ?? "tecfagchat.metered.live"}:80`,
    username: "openrelayproject",
    credential: import.meta.env.VITE_METERED_SECRET ?? "",
  },
  {
    urls: `turns:${import.meta.env.VITE_METERED_DOMAIN ?? "tecfagchat.metered.live"}:443`,
    username: "openrelayproject",
    credential: import.meta.env.VITE_METERED_SECRET ?? "",
  },
];

const SIGNAL_URL = (roomId: string, after: number) =>
  `/api/calls?action=signal&roomId=${roomId}&after=${after}&role=client`;

const sendSignal = (roomId: string, type: string, data: unknown) =>
  fetch("/api/calls?action=signal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ roomId, role: "client", type, data }),
  }).catch(() => {});

// ─── Tipos ────────────────────────────────────────────────────────────────────

type CallStatus =
  | "checking"   // Verificando se a sala existe
  | "ready"      // Sala encontrada, aguardando microfone
  | "connecting" // Conectando ao agente (aguardando offer)
  | "active"     // Em chamada
  | "ended"      // Encerrada
  | "expired"    // Sala expirada / não encontrada
  | "error";     // Erro de microfone

// ─── Rota ─────────────────────────────────────────────────────────────────────

export const Route = createFileRoute("/call/$roomId")({
  component: CallPage,
});

function CallPage() {
  const { roomId } = Route.useParams();
  const [status, setStatus] = useState<CallStatus>("checking");
  const [errorMsg, setErrorMsg] = useState("");
  const [duration, setDuration] = useState(0);

  const pcRef        = useRef<RTCPeerConnection | null>(null);
  const streamRef    = useRef<MediaStream | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const timerRef     = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollRef      = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastTsRef    = useRef<number>(0);

  // ── Verificar sala ──────────────────────────────────────────────────────────
  useEffect(() => {
    fetch(`/api/calls?roomId=${roomId}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error || data.status === "ended") setStatus("expired");
        else setStatus("ready");
      })
      .catch(() => setStatus("expired"));
  }, [roomId]);

  // ── Limpeza ─────────────────────────────────────────────────────────────────
  const cleanup = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (pollRef.current)  clearInterval(pollRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    pcRef.current?.close();
    pcRef.current   = null;
    streamRef.current = null;
    pollRef.current = null;
    lastTsRef.current = 0;
  }, []);

  useEffect(() => () => cleanup(), [cleanup]);

  // ── Entrar na chamada ───────────────────────────────────────────────────────
  const handleAnswer = useCallback(async () => {
    setStatus("connecting");
    lastTsRef.current = Date.now();

    // 1. Solicitar microfone
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      streamRef.current = stream;
    } catch {
      setStatus("error");
      setErrorMsg("Permita o acesso ao microfone para entrar na chamada.");
      return;
    }

    // 2. Criar RTCPeerConnection
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    pcRef.current = pc;
    stream.getTracks().forEach((t) => pc.addTrack(t, stream));

    // Ao receber áudio remoto (do agente), tocar
    pc.ontrack = (e) => {
      if (remoteAudioRef.current) remoteAudioRef.current.srcObject = e.streams[0];
      setStatus("active");
      timerRef.current = setInterval(() => setDuration((d) => d + 1), 1000);
    };

    // ICE candidates → enviar via polling API
    pc.onicecandidate = (e) => {
      if (e.candidate) sendSignal(roomId, "webrtc:ice", e.candidate);
    };

    // 3. Sinalizar que o cliente entrou (trigger para o agente criar o offer)
    await sendSignal(roomId, "client:joined", null);

    // 4. Polling — verifica sinais do agente a cada 600ms
    pollRef.current = setInterval(async () => {
      try {
        const r = await fetch(SIGNAL_URL(roomId, lastTsRef.current));
        if (!r.ok) return;
        const { signals, status: roomStatus } = await r.json();

        if (roomStatus === "ended") { cleanup(); setStatus("ended"); return; }

        for (const sig of signals as Array<{ type: string; data: any; timestamp: number }>) {
          lastTsRef.current = Math.max(lastTsRef.current, sig.timestamp);

          if (sig.type === "webrtc:offer") {
            // Recebeu offer do agente → criar answer
            await pc.setRemoteDescription(new RTCSessionDescription(sig.data));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            await sendSignal(roomId, "webrtc:answer", answer);
          }

          if (sig.type === "webrtc:ice") {
            try { await pc.addIceCandidate(new RTCIceCandidate(sig.data)); } catch {}
          }

          if (sig.type === "call:ended") {
            cleanup();
            setStatus("ended");
            return;
          }
        }
      } catch {}
    }, 600);
  }, [roomId, cleanup]);

  // ── Formatar duração ────────────────────────────────────────────────────────
  const fmt = (s: number) =>
    `${Math.floor(s / 60).toString().padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div style={S.page}>
      <audio ref={remoteAudioRef} autoPlay playsInline style={{ display: "none" }} />

      <div style={S.card}>
        {/* Logo */}
        <div style={S.logo}>
          <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
            <circle cx="20" cy="20" r="20" fill="url(#g)" />
            <path d="M14 26a1 1 0 0 0 1.4 0l1.6-1.6a7 7 0 1 0-1.4-1.4L14 24.6a1 1 0 0 0 0 1.4z" fill="#fff" />
            <defs>
              <linearGradient id="g" x1="0" y1="0" x2="40" y2="40" gradientUnits="userSpaceOnUse">
                <stop stopColor="#6366f1" />
                <stop offset="1" stopColor="#8b5cf6" />
              </linearGradient>
            </defs>
          </svg>
          <span style={S.logoText}>Valem Chat</span>
        </div>

        {status === "checking"  && <SV icon={<Clock style={{ width: 52, height: 52, color: "#94a3b8" }} />} title="Verificando..." sub="Aguarde um momento." />}
        {status === "expired"   && <SV icon={<Link2Off style={{ width: 52, height: 52, color: "#f87171" }} />} title="Link inválido ou expirado" sub={errorMsg || "Este link de chamada não existe ou já expirou.\nPeça ao agente para enviar um novo link."} />}
        {status === "error"     && <SV icon={<MicOff style={{ width: 52, height: 52, color: "#f87171" }} />} title="Microfone bloqueado" sub={errorMsg || "Permita o acesso ao microfone nas configurações do navegador e tente novamente."} />}
        {status === "ended"     && <SV icon={<CheckCircle2 style={{ width: 52, height: 52, color: "#34d399" }} />} title="Chamada encerrada" sub={`Duração: ${fmt(duration)}\nObrigado por falar conosco!`} />}
        {status === "connecting"&& <SV icon={<Radio style={{ width: 52, height: 52, color: "#818cf8" }} />} title="Conectando..." sub="Estabelecendo conexão com o agente..." spinner />}

        {status === "ready" && (
          <>
            <div style={S.avatar}>
              <Phone style={{ width: 36, height: 36, color: "#818cf8" }} />
            </div>
            <h2 style={S.title}>Você está sendo chamado</h2>
            <p style={S.subtitle}>
              Um agente iniciou uma ligação com você.<br />
              Clique abaixo para atender.
            </p>
            <button onClick={handleAnswer} style={S.answerBtn}>
              <Mic style={{ width: 18, height: 18, display: "inline-block", verticalAlign: "middle", marginRight: 8 }} />
              Atender agora
            </button>
            <p style={S.hint}>Funciona diretamente no navegador — sem instalar nada.</p>
          </>
        )}

        {status === "active" && (
          <>
            <div style={{ ...S.avatar, background: "rgba(99,102,241,0.15)" }}>
              <Phone style={{ width: 36, height: 36, color: "#818cf8" }} />
            </div>
            <h2 style={S.title}>Em chamada</h2>
            <div style={S.timer}>{fmt(duration)}</div>
            <div style={S.recordingBadge}>● Chamada ativa</div>
            <p style={S.hint}>Aguarde o agente encerrar a chamada.</p>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Status View ──────────────────────────────────────────────────────────────

function SV({ icon, title, sub, spinner }: { icon: React.ReactNode; title: string; sub: string; spinner?: boolean }) {
  return (
    <>
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}>
        {icon}
      </div>
      <h2 style={S.title}>{title}</h2>
      {spinner && <div style={S.spinner} />}
      <p style={{ ...S.subtitle, whiteSpace: "pre-line" }}>{sub}</p>
    </>
  );
}

// ─── Estilos inline (mobile-first) ───────────────────────────────────────────

const S: Record<string, React.CSSProperties> = {
  page: { minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(135deg, #0f0f23 0%, #1a1a3e 50%, #0f0f23 100%)", padding: "24px 16px", fontFamily: "'Inter', 'Segoe UI', sans-serif" },
  card: { background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", backdropFilter: "blur(20px)", borderRadius: 24, padding: "40px 32px", maxWidth: 380, width: "100%", textAlign: "center", boxShadow: "0 25px 50px rgba(0,0,0,0.5)" },
  logo: { display: "flex", alignItems: "center", justifyContent: "center", gap: 10, marginBottom: 32 },
  logoText: { color: "#e2e8f0", fontSize: 18, fontWeight: 600, letterSpacing: "-0.3px" },
  avatar: { width: 80, height: 80, borderRadius: "50%", background: "rgba(99,102,241,0.2)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 36, margin: "0 auto 20px" },
  title: { color: "#f1f5f9", fontSize: 22, fontWeight: 700, margin: "0 0 12px", lineHeight: 1.3 },
  subtitle: { color: "#94a3b8", fontSize: 14, lineHeight: 1.6, margin: "0 0 28px" },
  answerBtn: { display: "block", width: "100%", padding: "16px 24px", background: "linear-gradient(135deg, #6366f1, #8b5cf6)", color: "#fff", border: "none", borderRadius: 14, fontSize: 16, fontWeight: 600, cursor: "pointer", marginBottom: 16, transition: "opacity 0.2s, transform 0.1s", boxShadow: "0 8px 24px rgba(99,102,241,0.4)" },
  hint: { color: "#64748b", fontSize: 12, margin: 0, lineHeight: 1.5 },
  timer: { fontSize: 48, fontWeight: 700, color: "#6366f1", fontVariantNumeric: "tabular-nums", letterSpacing: "-1px", margin: "16px 0 8px", fontFamily: "monospace" },
  recordingBadge: { display: "inline-block", background: "rgba(239,68,68,0.15)", color: "#f87171", fontSize: 12, fontWeight: 600, padding: "4px 12px", borderRadius: 20, marginBottom: 20, animation: "pulse 2s infinite" },
  spinner: { width: 36, height: 36, border: "3px solid rgba(99,102,241,0.2)", borderTop: "3px solid #6366f1", borderRadius: "50%", animation: "spin 1s linear infinite", margin: "16px auto" },
};

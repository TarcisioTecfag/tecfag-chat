import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState, useCallback } from "react";
import { io, type Socket } from "socket.io-client";

// ─── Configuração ICE (STUN Google + TURN Metered) ───────────────────────────

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

// ─── Tipos ────────────────────────────────────────────────────────────────────

type CallStatus =
  | "checking"   // Verificando se a sala existe
  | "ready"      // Sala encontrada, aguardando microfone
  | "connecting" // Conectando ao agente
  | "active"     // Em chamada
  | "ended"      // Encerrada pelo agente
  | "dropped"    // Conexão perdida
  | "expired"    // Sala expirada / não encontrada
  | "error";     // Erro de microfone

// ─── Rota ────────────────────────────────────────────────────────────────────

export const Route = createFileRoute("/call/$roomId")({
  component: CallPage,
});

function CallPage() {
  const { roomId } = Route.useParams();
  const [status, setStatus] = useState<CallStatus>("checking");
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [duration, setDuration] = useState(0);

  const socketRef = useRef<Socket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Verificar sala ────────────────────────────────────────────────────────
  useEffect(() => {
    fetch(`/api/calls?roomId=${roomId}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error || data.status === "ended") {
          setStatus("expired");
        } else {
          setStatus("ready");
        }
      })
      .catch(() => setStatus("expired"));
  }, [roomId]);

  // ── Limpeza ao desmontar ──────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      cleanup();
    };
  }, []);

  const cleanup = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    pcRef.current?.close();
    socketRef.current?.disconnect();
  }, []);

  // ── Entrar na chamada ─────────────────────────────────────────────────────
  const handleAnswer = useCallback(async () => {
    setStatus("connecting");

    // 1. Solicitar microfone
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      localStreamRef.current = stream;
    } catch {
      setStatus("error");
      setErrorMsg("Permita o acesso ao microfone para entrar na chamada.");
      return;
    }

    // 2. Conectar ao Socket.io
    const socket = io("/", { path: "/socket.io/", transports: ["websocket", "polling"] });
    socketRef.current = socket;

    socket.on("connect", () => {
      socket.emit("client:join", roomId);
    });

    socket.on("room:joined", () => {
      setStatus("connecting");
    });

    // 3. Criar RTCPeerConnection
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    pcRef.current = pc;

    // Adicionar faixas de áudio local
    stream.getTracks().forEach((track) => pc.addTrack(track, stream));

    // Ao receber áudio remoto (do agente), tocar
    pc.ontrack = (event) => {
      if (remoteAudioRef.current) {
        remoteAudioRef.current.srcObject = event.streams[0];
      }
      setStatus("active");
      // Iniciar timer
      timerRef.current = setInterval(() => setDuration((d) => d + 1), 1000);
    };

    // Enviar ICE candidates para o agente via Socket.io
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit("webrtc:ice", { roomId, candidate: event.candidate });
      }
    };

    // 4. Receber offer do agente e responder com answer
    socket.on("webrtc:offer", async ({ offer }: { offer: RTCSessionDescriptionInit }) => {
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit("webrtc:answer", { roomId, answer });
    });

    // Receber ICE candidates do agente
    socket.on("webrtc:ice", async ({ candidate }: { candidate: RTCIceCandidateInit }) => {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch {}
    });

    // Chamada encerrada pelo agente
    socket.on("call:ended", () => {
      cleanup();
      setStatus("ended");
    });

    socket.on("call:dropped", () => {
      cleanup();
      setStatus("dropped");
    });

    socket.on("error", ({ message }: { message: string }) => {
      setStatus("expired");
      setErrorMsg(message);
    });
  }, [roomId, cleanup]);

  // ── Formatar duração ──────────────────────────────────────────────────────
  const formatDuration = (s: number) => {
    const m = Math.floor(s / 60).toString().padStart(2, "0");
    const sec = (s % 60).toString().padStart(2, "0");
    return `${m}:${sec}`;
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={styles.page}>
      <audio ref={remoteAudioRef} autoPlay playsInline style={{ display: "none" }} />

      <div style={styles.card}>
        {/* Logo */}
        <div style={styles.logo}>
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
          <span style={styles.logoText}>Valem Chat</span>
        </div>

        {/* Estados */}
        {status === "checking" && (
          <StatusView icon="⏳" title="Verificando..." subtitle="Aguarde um momento." />
        )}

        {status === "ready" && (
          <>
            <div style={styles.avatar}>📞</div>
            <h2 style={styles.title}>Você está sendo chamado</h2>
            <p style={styles.subtitle}>
              Um agente iniciou uma ligação com você.<br />
              Clique abaixo para atender.
            </p>
            <button onClick={handleAnswer} style={styles.answerBtn}>
              🎤 Atender agora
            </button>
            <p style={styles.hint}>Funciona diretamente no navegador — sem instalar nada.</p>
          </>
        )}

        {status === "connecting" && (
          <StatusView
            icon="📡"
            title="Conectando..."
            subtitle="Estabelecendo conexão segura com o agente."
            spinner
          />
        )}

        {status === "active" && (
          <>
            <div style={{ ...styles.avatar, background: "rgba(99,102,241,0.15)", fontSize: 48 }}>📞</div>
            <h2 style={styles.title}>Em chamada</h2>
            <div style={styles.timer}>{formatDuration(duration)}</div>
            <div style={styles.recordingBadge}>● Chamada ativa</div>
            <p style={styles.hint}>Aguarde o agente encerrar a chamada.</p>
          </>
        )}

        {status === "ended" && (
          <StatusView
            icon="✅"
            title="Chamada encerrada"
            subtitle={`Duração: ${formatDuration(duration)}\nObrigado por falar conosco!`}
          />
        )}

        {status === "dropped" && (
          <StatusView
            icon="⚠️"
            title="Conexão perdida"
            subtitle="A chamada foi interrompida. Você pode tentar entrar novamente."
          />
        )}

        {status === "expired" && (
          <StatusView
            icon="🔗"
            title="Link inválido ou expirado"
            subtitle={errorMsg || "Este link de chamada não existe ou já expirou.\nPeça ao agente para enviar um novo link."}
          />
        )}

        {status === "error" && (
          <StatusView
            icon="🎤"
            title="Microfone bloqueado"
            subtitle={errorMsg || "Permita o acesso ao microfone nas configurações do seu navegador e tente novamente."}
          />
        )}
      </div>
    </div>
  );
}

// ─── Componente auxiliar de status ───────────────────────────────────────────

function StatusView({ icon, title, subtitle, spinner }: { icon: string; title: string; subtitle: string; spinner?: boolean }) {
  return (
    <>
      <div style={{ fontSize: 56, marginBottom: 16 }}>{icon}</div>
      <h2 style={styles.title}>{title}</h2>
      {spinner && <div style={styles.spinner} />}
      <p style={{ ...styles.subtitle, whiteSpace: "pre-line" }}>{subtitle}</p>
    </>
  );
}

// ─── Estilos inline (mobile-first) ───────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "linear-gradient(135deg, #0f0f23 0%, #1a1a3e 50%, #0f0f23 100%)",
    padding: "24px 16px",
    fontFamily: "'Inter', 'Segoe UI', sans-serif",
  },
  card: {
    background: "rgba(255,255,255,0.05)",
    border: "1px solid rgba(255,255,255,0.1)",
    backdropFilter: "blur(20px)",
    borderRadius: 24,
    padding: "40px 32px",
    maxWidth: 380,
    width: "100%",
    textAlign: "center",
    boxShadow: "0 25px 50px rgba(0,0,0,0.5)",
  },
  logo: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    marginBottom: 32,
  },
  logoText: {
    color: "#e2e8f0",
    fontSize: 18,
    fontWeight: 600,
    letterSpacing: "-0.3px",
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: "50%",
    background: "rgba(99,102,241,0.2)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 36,
    margin: "0 auto 20px",
  },
  title: {
    color: "#f1f5f9",
    fontSize: 22,
    fontWeight: 700,
    margin: "0 0 12px",
    lineHeight: 1.3,
  },
  subtitle: {
    color: "#94a3b8",
    fontSize: 14,
    lineHeight: 1.6,
    margin: "0 0 28px",
  },
  answerBtn: {
    display: "block",
    width: "100%",
    padding: "16px 24px",
    background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
    color: "#fff",
    border: "none",
    borderRadius: 14,
    fontSize: 16,
    fontWeight: 600,
    cursor: "pointer",
    marginBottom: 16,
    transition: "opacity 0.2s, transform 0.1s",
    boxShadow: "0 8px 24px rgba(99,102,241,0.4)",
  },
  hint: {
    color: "#64748b",
    fontSize: 12,
    margin: 0,
    lineHeight: 1.5,
  },
  timer: {
    fontSize: 48,
    fontWeight: 700,
    color: "#6366f1",
    fontVariantNumeric: "tabular-nums",
    letterSpacing: "-1px",
    margin: "16px 0 8px",
    fontFamily: "monospace",
  },
  recordingBadge: {
    display: "inline-block",
    background: "rgba(239,68,68,0.15)",
    color: "#f87171",
    fontSize: 12,
    fontWeight: 600,
    padding: "4px 12px",
    borderRadius: 20,
    marginBottom: 20,
    animation: "pulse 2s infinite",
  },
  spinner: {
    width: 36,
    height: 36,
    border: "3px solid rgba(99,102,241,0.2)",
    borderTop: "3px solid #6366f1",
    borderRadius: "50%",
    animation: "spin 1s linear infinite",
    margin: "16px auto",
  },
};

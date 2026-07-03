/**
 * call-signaling.ts
 * Gerencia as salas WebRTC e faz relay de mensagens de signaling
 * (SDP offer/answer e ICE candidates) via Socket.io
 *
 * Import dinâmico de socket.io para evitar bundling no preset Cloudflare.
 */

// ─── Tipos ───────────────────────────────────────────────────────────────────

interface Room {
  roomId: string;
  agentSocketId: string | null;
  clientSocketId: string | null;
  status: "waiting" | "active" | "ended";
  createdAt: number;
  timeoutHandle: ReturnType<typeof setTimeout> | null;
}

// ─── Estado Global das Salas ─────────────────────────────────────────────────

const rooms = new Map<string, Room>();
const ROOM_TTL = 10 * 60 * 1000; // 10 minutos

// ─── Inicialização do Socket.io (import dinâmico/lazy) ───────────────────────

let ioInstance: any = null;

export async function initCallSignaling(httpServer: any): Promise<void> {
  if (ioInstance) return; // já inicializado

  // Import dinâmico — não será avaliado no parse do Cloudflare Worker
  const { Server: SocketServer } = await import("socket.io");

  ioInstance = new SocketServer(httpServer, {
    cors: { origin: "*", methods: ["GET", "POST"] },
    transports: ["websocket", "polling"],
    path: "/socket.io/",
  });

  ioInstance.on("connection", (socket: any) => {
    console.log(`[Socket.io] Conectado: ${socket.id}`);

    socket.on("agent:join", (roomId: string) => {
      const room = rooms.get(roomId);
      if (!room || room.status === "ended") {
        socket.emit("error", { message: "Sala não encontrada ou expirada." });
        return;
      }
      room.agentSocketId = socket.id;
      socket.join(roomId);
      socket.emit("room:joined", { role: "agent", status: room.status });
      console.log(`[Socket.io] Agente entrou na sala: ${roomId}`);
    });

    socket.on("client:join", (roomId: string) => {
      const room = rooms.get(roomId);
      if (!room || room.status === "ended") {
        socket.emit("error", { message: "Link inválido ou expirado." });
        return;
      }
      room.clientSocketId = socket.id;
      room.status = "active";
      socket.join(roomId);

      // Cancelar timeout de expiração
      if (room.timeoutHandle) {
        clearTimeout(room.timeoutHandle);
        room.timeoutHandle = null;
      }

      // Avisar o agente que o cliente está pronto
      socket.to(roomId).emit("client:ready");
      socket.emit("room:joined", { role: "client", status: "active" });
      console.log(`[Socket.io] Cliente entrou na sala: ${roomId}`);
    });

    // ─── WebRTC Relay ───────────────────────────────────────────────────────

    socket.on("webrtc:offer", ({ roomId, offer }: { roomId: string; offer: RTCSessionDescriptionInit }) => {
      socket.to(roomId).emit("webrtc:offer", { offer });
    });

    socket.on("webrtc:answer", ({ roomId, answer }: { roomId: string; answer: RTCSessionDescriptionInit }) => {
      socket.to(roomId).emit("webrtc:answer", { answer });
    });

    socket.on("webrtc:ice", ({ roomId, candidate }: { roomId: string; candidate: RTCIceCandidateInit }) => {
      socket.to(roomId).emit("webrtc:ice", { candidate });
    });

    // ─── Encerramento ───────────────────────────────────────────────────────

    socket.on("call:end", (roomId: string) => {
      endRoom(roomId);
    });

    socket.on("disconnect", () => {
      for (const [roomId, room] of rooms.entries()) {
        if (room.agentSocketId === socket.id || room.clientSocketId === socket.id) {
          if (room.status === "active") {
            ioInstance?.to(roomId).emit("call:dropped", {
              disconnectedRole: room.agentSocketId === socket.id ? "agent" : "client",
            });
          }
          endRoom(roomId);
          break;
        }
      }
    });
  });

  console.log("[Socket.io] Signaling server inicializado.");
}

// ─── Funções utilitárias de sala ──────────────────────────────────────────────

export function createRoom(roomId: string): Room {
  const room: Room = {
    roomId,
    agentSocketId: null,
    clientSocketId: null,
    status: "waiting",
    createdAt: Date.now(),
    timeoutHandle: setTimeout(() => {
      const r = rooms.get(roomId);
      if (r && r.status === "waiting") {
        console.log(`[Calls] Sala ${roomId} expirou sem cliente`);
        endRoom(roomId);
      }
    }, ROOM_TTL),
  };
  rooms.set(roomId, room);
  console.log(`[Calls] Sala criada: ${roomId}`);
  return room;
}

export function getRoomStatus(roomId: string): Room | null {
  return rooms.get(roomId) ?? null;
}

function endRoom(roomId: string) {
  const room = rooms.get(roomId);
  if (!room) return;

  if (room.timeoutHandle) clearTimeout(room.timeoutHandle);
  room.status = "ended";

  if (ioInstance) {
    ioInstance.to(roomId).emit("call:ended");
  }

  rooms.delete(roomId);
  console.log(`[Calls] Sala encerrada: ${roomId}`);
}

/**
 * call-signaling.ts
 * Gerencia as salas WebRTC e faz relay de mensagens de signaling
 * (SDP offer/answer e ICE candidates) via Socket.io
 */

import type { Server as HttpServer } from "http";
import { Server as SocketServer, type Socket } from "socket.io";

// ─── Tipos ───────────────────────────────────────────────────────────────────

interface Room {
  roomId: string;
  agentSocketId: string | null;
  clientSocketId: string | null;
  status: "waiting" | "active" | "ended";
  createdAt: number;
  timeoutHandle: ReturnType<typeof setTimeout> | null;
}

// ─── Estado global das salas ─────────────────────────────────────────────────

const rooms = new Map<string, Room>();

// Sala expira em 10 minutos sem conexão completa
const ROOM_TTL_MS = 10 * 60 * 1000;

// ─── Singleton do servidor Socket.io ─────────────────────────────────────────

let io: SocketServer | null = null;

export function getIO(): SocketServer | null {
  return io;
}

// ─── Inicialização ────────────────────────────────────────────────────────────

export function initCallSignaling(httpServer: HttpServer): SocketServer {
  if (io) return io;

  io = new SocketServer(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
    },
    transports: ["websocket", "polling"],
    path: "/socket.io/",
  });

  io.on("connection", (socket: Socket) => {
    console.log(`[Calls] Socket conectado: ${socket.id}`);

    // ── Agente entra na sala (quem inicia a chamada) ──────────────────────────
    socket.on("agent:join", (roomId: string) => {
      const room = rooms.get(roomId);
      if (!room) {
        socket.emit("error", { message: "Sala não encontrada ou expirada." });
        return;
      }
      if (room.status === "ended") {
        socket.emit("error", { message: "Esta chamada já foi encerrada." });
        return;
      }

      room.agentSocketId = socket.id;
      socket.join(roomId);
      socket.emit("room:joined", { role: "agent", status: room.status });
      console.log(`[Calls] Agente ${socket.id} entrou na sala ${roomId}`);
    });

    // ── Cliente entra na sala (pelo link do WhatsApp) ─────────────────────────
    socket.on("client:join", (roomId: string) => {
      const room = rooms.get(roomId);
      if (!room) {
        socket.emit("error", { message: "Link inválido ou expirado." });
        return;
      }
      if (room.status === "ended") {
        socket.emit("error", { message: "Esta chamada já foi encerrada." });
        return;
      }

      room.clientSocketId = socket.id;
      room.status = "active";
      socket.join(roomId);

      // Cancela o timeout de expiração — cliente entrou
      if (room.timeoutHandle) {
        clearTimeout(room.timeoutHandle);
        room.timeoutHandle = null;
      }

      // Notifica o agente que o cliente entrou (para iniciar o offer WebRTC)
      socket.to(roomId).emit("client:ready");
      socket.emit("room:joined", { role: "client", status: "active" });
      console.log(`[Calls] Cliente ${socket.id} entrou na sala ${roomId}`);
    });

    // ── Relay de SDP Offer (Agente → Cliente) ────────────────────────────────
    socket.on("webrtc:offer", ({ roomId, offer }: { roomId: string; offer: RTCSessionDescriptionInit }) => {
      socket.to(roomId).emit("webrtc:offer", { offer });
    });

    // ── Relay de SDP Answer (Cliente → Agente) ───────────────────────────────
    socket.on("webrtc:answer", ({ roomId, answer }: { roomId: string; answer: RTCSessionDescriptionInit }) => {
      socket.to(roomId).emit("webrtc:answer", { answer });
    });

    // ── Relay de ICE Candidates (ambos os lados) ─────────────────────────────
    socket.on("webrtc:ice", ({ roomId, candidate }: { roomId: string; candidate: RTCIceCandidateInit }) => {
      socket.to(roomId).emit("webrtc:ice", { candidate });
    });

    // ── Encerrar chamada ─────────────────────────────────────────────────────
    socket.on("call:end", (roomId: string) => {
      endRoom(roomId, io!);
    });

    // ── Desconexão ────────────────────────────────────────────────────────────
    socket.on("disconnect", () => {
      console.log(`[Calls] Socket desconectado: ${socket.id}`);
      // Procura em qual sala este socket estava
      for (const [roomId, room] of rooms.entries()) {
        if (room.agentSocketId === socket.id || room.clientSocketId === socket.id) {
          if (room.status === "active") {
            // Avisa o outro lado que a chamada caiu
            io?.to(roomId).emit("call:dropped", { disconnectedRole: room.agentSocketId === socket.id ? "agent" : "client" });
          }
          endRoom(roomId, io!);
          break;
        }
      }
    });
  });

  return io;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Cria uma nova sala WebRTC e agenda expiração */
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
        console.log(`[Calls] Sala ${roomId} expirou sem cliente entrar.`);
        endRoom(roomId, io!);
      }
    }, ROOM_TTL_MS),
  };

  rooms.set(roomId, room);
  console.log(`[Calls] Sala criada: ${roomId}`);
  return room;
}

/** Verifica se uma sala existe e está ativa */
export function getRoomStatus(roomId: string): Room | null {
  return rooms.get(roomId) ?? null;
}

/** Encerra uma sala e notifica todos os participantes */
function endRoom(roomId: string, ioServer: SocketServer): void {
  const room = rooms.get(roomId);
  if (!room) return;

  if (room.timeoutHandle) clearTimeout(room.timeoutHandle);
  room.status = "ended";
  ioServer.to(roomId).emit("call:ended");
  rooms.delete(roomId);
  console.log(`[Calls] Sala ${roomId} encerrada.`);
}

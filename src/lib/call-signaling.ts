/**
 * call-signaling.ts
 * Gerencia salas WebRTC e mensagens de signaling via polling (sem Socket.io).
 *
 * Por que polling? O preset de build (Cloudflare/srvx) não expõe um http.Server
 * raw para o Socket.io se acoplar. Polling via fetch é 100% compatível com qualquer
 * preset e introduz apenas ~500ms de latência no setup inicial do WebRTC.
 * Após a conexão P2P, todo áudio flui diretamente entre cliente e agente.
 */

// ─── Tipos ───────────────────────────────────────────────────────────────────

export interface SignalMessage {
  type: string;
  data: unknown;
  from: "agent" | "client";
  timestamp: number;
}

export interface Room {
  roomId: string;
  status: "waiting" | "active" | "ended";
  createdAt: number;
  signals: SignalMessage[];
  timeoutHandle: ReturnType<typeof setTimeout> | null;
}

// ─── Estado Global das Salas (módulo singleton no processo Node.js) ───────────

const rooms = new Map<string, Room>();
const ROOM_TTL_MS = 10 * 60 * 1000; // 10 minutos

// ─── API Pública ──────────────────────────────────────────────────────────────

/** Cria uma nova sala de chamada com TTL automático. */
export function createRoom(roomId: string): Room {
  const room: Room = {
    roomId,
    status: "waiting",
    createdAt: Date.now(),
    signals: [],
    timeoutHandle: setTimeout(() => {
      const r = rooms.get(roomId);
      if (r && r.status !== "active") {
        console.log(`[Calls] Sala ${roomId} expirou sem conexão.`);
        rooms.delete(roomId);
      }
    }, ROOM_TTL_MS),
  };
  rooms.set(roomId, room);
  console.log(`[Calls] Sala criada: ${roomId}`);
  return room;
}

/** Retorna o estado atual de uma sala, ou null se não existir. */
export function getRoomStatus(roomId: string): Room | null {
  return rooms.get(roomId) ?? null;
}

/**
 * Adiciona uma mensagem de signaling à fila da sala.
 * Quando o cliente envia "client:joined", a sala passa para "active".
 */
export function addSignal(
  roomId: string,
  from: "agent" | "client",
  type: string,
  data: unknown
): boolean {
  const room = rooms.get(roomId);
  if (!room || room.status === "ended") return false;

  if (type === "client:joined") {
    room.status = "active";
    // Cancelar timeout de expiração — cliente chegou
    if (room.timeoutHandle) {
      clearTimeout(room.timeoutHandle);
      room.timeoutHandle = null;
    }
    console.log(`[Calls] Cliente entrou na sala: ${roomId}`);
  }

  room.signals.push({ type, data, from, timestamp: Date.now() });

  // Manter no máximo 100 mensagens por sala (evitar vazamento de memória)
  if (room.signals.length > 100) room.signals = room.signals.slice(-100);

  return true;
}

/**
 * Retorna as mensagens de signaling NOVAS (após `after`) destinadas a `forRole`.
 * Cada lado só recebe sinais do lado oposto.
 */
export function getSignals(
  roomId: string,
  after: number,
  forRole: "agent" | "client"
): SignalMessage[] {
  const room = rooms.get(roomId);
  if (!room) return [];
  return room.signals.filter((s) => s.timestamp > after && s.from !== forRole);
}

/** Encerra uma sala e emite sinal de encerramento para ambos os lados. */
export function endRoom(roomId: string): void {
  const room = rooms.get(roomId);
  if (!room) return;

  if (room.timeoutHandle) clearTimeout(room.timeoutHandle);
  room.status = "ended";

  // Inserir sinal de encerramento para ambos os lados receberem via polling
  const ts = Date.now();
  room.signals.push({ type: "call:ended", data: null, from: "agent", timestamp: ts });
  room.signals.push({ type: "call:ended", data: null, from: "client", timestamp: ts + 1 });

  // Remover da memória após 30s (tempo para os polls finais consumirem o sinal)
  setTimeout(() => rooms.delete(roomId), 30_000);

  console.log(`[Calls] Sala encerrada: ${roomId}`);
}

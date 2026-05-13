import { parentPort } from "node:worker_threads";
import { BOARD_HEIGHT, BOARD_WIDTH, type MatchSerializedState } from "@tetris/core";

interface AuditMessage {
  op: "audit";
  roomCode: string;
  tick: number;
  state: MatchSerializedState;
}

interface AuditResult {
  op: "audit_result";
  roomCode: string;
  tick: number;
  hashByPlayerId: Record<string, number>;
}

function hashBoard(board: number[]): number {
  let hash = 2166136261;
  const max = BOARD_WIDTH * BOARD_HEIGHT;
  for (let i = 0; i < max; i += 1) {
    hash ^= board[i] ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

if (!parentPort) {
  process.exit(0);
}

parentPort.on("message", (message: AuditMessage) => {
  if (message.op !== "audit") return;
  const hashByPlayerId: Record<string, number> = {};
  for (const [playerId, player] of Object.entries(message.state.players)) {
    hashByPlayerId[playerId] = hashBoard(player.board);
  }
  const payload: AuditResult = {
    op: "audit_result",
    roomCode: message.roomCode,
    tick: message.tick,
    hashByPlayerId
  };
  parentPort?.postMessage(payload);
});

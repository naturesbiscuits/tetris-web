import Phaser from "phaser";
import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  CHAOTIC_BOARD_HEIGHT,
  CHAOTIC_BOARD_WIDTH,
  CHAOTIC_VISIBLE_HEIGHT,
  VISIBLE_HEIGHT,
  getCells,
  type PieceType
} from "@tetris/core";
import type { FrameSnapshot } from "../state/controllers";

const COLORS: Record<number, number> = {
  0: 0x151724,
  1: 0x22d3ee,
  2: 0xfacc15,
  3: 0xa78bfa,
  4: 0x4ade80,
  5: 0xf97316,
  6: 0x60a5fa,
  7: 0xfb7185,
  8: 0x6b7280
};

const CHAOTIC_PLAYER_COLORS = [0xf472b6, 0x34d399, 0x60a5fa, 0xfbbf24, 0xc084fc, 0xfb923c, 0x2dd4bf, 0xf87171];

function chaoticPlayerColor(playerId: string, index: number): number {
  let h = 0;
  for (let i = 0; i < playerId.length; i += 1) {
    h = (h * 31 + playerId.charCodeAt(i)) >>> 0;
  }
  return CHAOTIC_PLAYER_COLORS[(h + index) % CHAOTIC_PLAYER_COLORS.length]!;
}

interface BoardGridSpec {
  width: number;
  height: number;
  visibleHeight: number;
}

const STANDARD_GRID: BoardGridSpec = {
  width: BOARD_WIDTH,
  height: BOARD_HEIGHT,
  visibleHeight: VISIBLE_HEIGHT
};

const CHAOTIC_GRID: BoardGridSpec = {
  width: CHAOTIC_BOARD_WIDTH,
  height: CHAOTIC_BOARD_HEIGHT,
  visibleHeight: CHAOTIC_VISIBLE_HEIGHT
};

function drawBoard(
  graphics: Phaser.GameObjects.Graphics,
  board: Uint8Array,
  xOffset: number,
  yOffset: number,
  cellSize: number,
  grid: BoardGridSpec = STANDARD_GRID
): void {
  const hiddenRows = grid.height - grid.visibleHeight;
  for (let y = hiddenRows; y < grid.height; y += 1) {
    for (let x = 0; x < grid.width; x += 1) {
      const value = board[y * grid.width + x];
      graphics.fillStyle(COLORS[value] ?? 0xffffff, value === 0 ? 0.24 : 1);
      graphics.fillRect(xOffset + x * cellSize, yOffset + (y - hiddenRows) * cellSize, cellSize - 1, cellSize - 1);
    }
  }
}

function drawPiece(
  graphics: Phaser.GameObjects.Graphics,
  piece: { type: PieceType; x: number; y: number; rotation: number },
  xOffset: number,
  yOffset: number,
  cellSize: number,
  alpha = 1,
  fillColorOverride?: number,
  grid: BoardGridSpec = STANDARD_GRID
): void {
  const hiddenRows = grid.height - grid.visibleHeight;
  const pieceState = {
    type: piece.type,
    x: piece.x,
    y: piece.y,
    rotation: piece.rotation
  };
  const cells = getCells(pieceState);
  const valueByType: Record<PieceType, number> = { I: 1, O: 2, T: 3, S: 4, Z: 5, J: 6, L: 7 };
  const fillColor = fillColorOverride ?? COLORS[valueByType[piece.type]];
  graphics.fillStyle(fillColor, alpha);
  for (const [x, y] of cells) {
    if (y < hiddenRows || y >= grid.height) continue;
    graphics.fillRect(xOffset + x * cellSize, yOffset + (y - hiddenRows) * cellSize, cellSize - 1, cellSize - 1);
  }
}

type SnapshotGetter = () => FrameSnapshot;

export function createPhaserGame(container: HTMLDivElement, getSnapshot: SnapshotGetter): Phaser.Game {
  class MainScene extends Phaser.Scene {
    private graphics!: Phaser.GameObjects.Graphics;
    private youLabel!: Phaser.GameObjects.Text;
    private oppLabel!: Phaser.GameObjects.Text;
    private statusLabel!: Phaser.GameObjects.Text;

    constructor() {
      super("main");
    }

    create(): void {
      this.graphics = this.add.graphics();
      this.youLabel = this.add.text(28, 14, "YOU", { color: "#f8fafc", fontFamily: "Verdana", fontSize: "18px" });
      this.oppLabel = this.add.text(272, 14, "OPPONENT", { color: "#f8fafc", fontFamily: "Verdana", fontSize: "18px" });
      this.statusLabel = this.add.text(28, 662, "", { color: "#f8fafc", fontFamily: "Verdana", fontSize: "16px" });
    }

    update(): void {
      const snapshot = getSnapshot();
      const cellSize = 18;
      this.graphics.clear();

      this.graphics.fillStyle(0x0f1220, 1);
      this.graphics.fillRect(0, 0, 960, 700);

      if (snapshot.mode === "chaotic" && snapshot.chaotic) {
        const maxBoardW = 920;
        const maxBoardH = 600;
        const chaoticCell = Math.max(
          10,
          Math.min(Math.floor(maxBoardW / CHAOTIC_GRID.width), Math.floor(maxBoardH / CHAOTIC_GRID.visibleHeight))
        );
        const cw = CHAOTIC_GRID.width * chaoticCell;
        const cx = (960 - cw) / 2;
        const cy = 36;
        drawBoard(this.graphics, snapshot.chaotic.board, cx, cy, chaoticCell, CHAOTIC_GRID);
        snapshot.chaotic.players.forEach((p, idx) => {
          if (!p.isLocal || !p.active) return;
          const hue = chaoticPlayerColor(p.playerId, idx);
          drawPiece(this.graphics, p.active, cx, cy, chaoticCell, 1, hue, CHAOTIC_GRID);
          drawPiece(this.graphics, { ...p.active, y: p.ghostY }, cx, cy, chaoticCell, 0.22, hue, CHAOTIC_GRID);
        });
        this.youLabel.setText("CHAOTIC CO-OP — SHARED GRID");
        this.oppLabel.setText(`${snapshot.chaotic.players.length} players`);
        this.statusLabel.setText(
          `${snapshot.statusLabel} | TEAM LINES ${snapshot.chaotic.lines} | TEAM SCORE ${snapshot.chaotic.score}`
        );
        return;
      }

      drawBoard(this.graphics, snapshot.you.board, 24, 42, cellSize);
      drawPiece(this.graphics, snapshot.you.active, 24, 42, cellSize, 1);
      drawPiece(this.graphics, { ...snapshot.you.active, y: snapshot.you.ghostY }, 24, 42, cellSize, 0.28);

      this.youLabel.setText(`${snapshot.youLabel} - ${snapshot.you.displayName}`);

      if (snapshot.opponent) {
        drawBoard(this.graphics, snapshot.opponent.board, 264, 42, cellSize);
        drawPiece(this.graphics, snapshot.opponent.active, 264, 42, cellSize, 1);
        drawPiece(this.graphics, { ...snapshot.opponent.active, y: snapshot.opponent.ghostY }, 264, 42, cellSize, 0.28);
        this.oppLabel.setText(`${snapshot.opponentLabel} - ${snapshot.opponent.displayName}`);
      } else {
        this.graphics.fillStyle(0x1e293b, 0.9);
        this.graphics.fillRect(264, 42, BOARD_WIDTH * cellSize, VISIBLE_HEIGHT * cellSize);
        if (snapshot.mode === "multiplayer" && snapshot.opponentState) {
          this.oppLabel.setText(`${snapshot.opponentLabel} - ${snapshot.opponentState.displayName}`);
          this.statusLabel.setText(
            `${snapshot.statusLabel} | SCORE ${snapshot.you.score} | OPP SCORE ${snapshot.opponentState.score} | OPP COMBO ${Math.max(0, snapshot.opponentState.combo)} | OPP GARBAGE ${snapshot.opponentState.lastGarbage}`
          );
          return;
        }
        this.oppLabel.setText("SOLO MODE");
      }

      this.statusLabel.setText(
        `${snapshot.statusLabel} | SCORE ${snapshot.you.score} | LINES ${snapshot.you.lines} | GARBAGE ${snapshot.you.pendingGarbage}`
      );
    }
  }

  return new Phaser.Game({
    type: Phaser.AUTO,
    width: 960,
    height: 700,
    parent: container,
    backgroundColor: "#0f1220",
    scene: MainScene,
    fps: {
      target: 60,
      forceSetTimeOut: true
    }
  });
}

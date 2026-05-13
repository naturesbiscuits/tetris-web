import Phaser from "phaser";
import { BOARD_HEIGHT, BOARD_WIDTH, VISIBLE_HEIGHT, getCells, type PieceType } from "@tetris/core";
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

type SnapshotGetter = () => FrameSnapshot;

function drawBoard(
  graphics: Phaser.GameObjects.Graphics,
  board: Uint8Array,
  xOffset: number,
  yOffset: number,
  cellSize: number
): void {
  const hiddenRows = BOARD_HEIGHT - VISIBLE_HEIGHT;
  for (let y = hiddenRows; y < BOARD_HEIGHT; y += 1) {
    for (let x = 0; x < BOARD_WIDTH; x += 1) {
      const value = board[y * BOARD_WIDTH + x];
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
  alpha = 1
): void {
  const hiddenRows = BOARD_HEIGHT - VISIBLE_HEIGHT;
  const pieceState = {
    type: piece.type,
    x: piece.x,
    y: piece.y,
    rotation: piece.rotation
  };
  const cells = getCells(pieceState);
  const valueByType: Record<PieceType, number> = { I: 1, O: 2, T: 3, S: 4, Z: 5, J: 6, L: 7 };
  const fillColor = COLORS[valueByType[piece.type]];
  graphics.fillStyle(fillColor, alpha);
  for (const [x, y] of cells) {
    if (y < hiddenRows || y >= BOARD_HEIGHT) continue;
    graphics.fillRect(xOffset + x * cellSize, yOffset + (y - hiddenRows) * cellSize, cellSize - 1, cellSize - 1);
  }
}

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
      this.statusLabel = this.add.text(28, 420, "", { color: "#f8fafc", fontFamily: "Verdana", fontSize: "16px" });
    }

    update(): void {
      const snapshot = getSnapshot();
      const cellSize = 18;
      this.graphics.clear();

      this.graphics.fillStyle(0x0f1220, 1);
      this.graphics.fillRect(0, 0, 520, 460);

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
    width: 520,
    height: 460,
    parent: container,
    backgroundColor: "#0f1220",
    scene: MainScene,
    fps: {
      target: 60,
      forceSetTimeOut: true
    }
  });
}

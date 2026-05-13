import { useEffect, useRef, useState } from "react";
import Phaser from "phaser";
import type { FrameSnapshot, GameController } from "../state/controllers";
import { createPhaserGame } from "../game/phaserRenderer";

interface GameViewportProps {
  controller: GameController;
}

export function GameViewport({ controller }: GameViewportProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const gameRef = useRef<Phaser.Game | null>(null);
  const [frame, setFrame] = useState<FrameSnapshot>(() => controller.getFrame());

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) return;
      controller.onKeyDown(event.code);
      if (event.code.startsWith("Arrow") || event.code === "Space") {
        event.preventDefault();
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      controller.onKeyUp(event.code);
      if (event.code.startsWith("Arrow") || event.code === "Space") {
        event.preventDefault();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [controller]);

  useEffect(() => {
    if (!containerRef.current) return;
    gameRef.current = createPhaserGame(containerRef.current, () => controller.getFrame());
    let raf = 0;
    const updateFrame = () => {
      setFrame(controller.getFrame());
      raf = window.requestAnimationFrame(updateFrame);
    };
    raf = window.requestAnimationFrame(updateFrame);
    return () => {
      window.cancelAnimationFrame(raf);
      gameRef.current?.destroy(true);
      gameRef.current = null;
    };
  }, [controller]);

  return (
    <section className="game-shell">
      <div ref={containerRef} className="game-canvas" />
      <div className="game-hud">
        <span>{frame.mode === "solo" ? "PLAYER 1" : "YOU"}</span>
        <span>{frame.mode === "solo" ? "LOCAL SIMULATION @ 60 TPS" : `TICK ${frame.tick}`}</span>
        <span>{frame.statusLabel}</span>
      </div>
    </section>
  );
}

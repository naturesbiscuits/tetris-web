import { useEffect, useMemo, useRef, useState } from "react";
import type { ClientProfile, RoomSnapshot } from "@tetris/core";
import { GameViewport } from "./components/GameViewport";
import { createSocket } from "./network/socket";
import { MultiplayerController, SoloController, type GameController } from "./state/controllers";

type Mode = "menu" | "lobby" | "game";

export default function App(): JSX.Element {
  const socket = useMemo(() => createSocket(), []);
  const [mode, setMode] = useState<Mode>("menu");
  const [profile, setProfile] = useState<ClientProfile | null>(null);
  const [nicknameDraft, setNicknameDraft] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [room, setRoom] = useState<RoomSnapshot | null>(null);
  const [error, setError] = useState("");
  const [controllerVersion, setControllerVersion] = useState(0);
  const controllerRef = useRef<GameController | null>(null);

  const setController = (next: GameController | null) => {
    controllerRef.current?.stop();
    controllerRef.current = next;
    setControllerVersion((v) => v + 1);
  };

  useEffect(() => {
    const storedSessionId = localStorage.getItem("tetris.sessionId") ?? undefined;
    const storedNick = localStorage.getItem("tetris.nickname") ?? undefined;
    const nickname = storedNick || "";
    setNicknameDraft(nickname);

    socket.on("connect", () => {
      socket.emit("register_profile", {
        sessionId: storedSessionId,
        nickname: storedNick
      });
    });

    socket.on("profile_ready", (nextProfile) => {
      setProfile(nextProfile);
      setNicknameDraft(nextProfile.nickname);
      localStorage.setItem("tetris.sessionId", nextProfile.sessionId);
      localStorage.setItem("tetris.nickname", nextProfile.nickname);
    });

    socket.on("room_created", (snapshot) => {
      setRoom(snapshot);
      setMode("lobby");
    });

    socket.on("room_joined", (snapshot) => {
      setRoom(snapshot);
      setMode("lobby");
    });

    socket.on("player_joined", (snapshot) => {
      setRoom(snapshot);
    });

    socket.on("player_disconnected", (snapshot) => {
      setRoom(snapshot);
    });

    socket.on("start_match", (payload) => {
      if (!socket.id) return;
      const controller = new MultiplayerController({
        players: payload.players,
        localPlayerId: socket.id,
        socket
      });
      controller.start();
      setController(controller);
      setMode("game");
    });

    socket.on("multiplayer_event", (event) => {
      const controller = controllerRef.current;
      if (controller instanceof MultiplayerController) {
        controller.handleMultiplayerEvent(event);
      }
    });

    socket.on("winner_declared", ({ winnerId }) => {
      const controller = controllerRef.current;
      if (controller instanceof MultiplayerController) {
        controller.setWinner(winnerId);
      }
    });

    socket.on("game_over", ({ winnerId }) => {
      const controller = controllerRef.current;
      if (controller instanceof MultiplayerController) {
        controller.setWinner(winnerId);
      }
    });

    socket.on("error_message", ({ message }) => {
      setError(message);
      window.setTimeout(() => setError(""), 2200);
    });

    return () => {
      setController(null);
      socket.disconnect();
    };
  }, [socket]);

  const saveNickname = () => {
    if (!nicknameDraft.trim()) return;
    socket.emit("register_profile", {
      sessionId: profile?.sessionId,
      nickname: nicknameDraft.trim()
    });
  };

  const startSolo = () => {
    const controller = new SoloController(profile?.nickname || "Guest");
    controller.start();
    setController(controller);
    setMode("game");
  };

  const hostGame = () => {
    socket.emit("create_room");
  };

  const joinGame = () => {
    socket.emit("join_room", { roomCode: joinCode.trim().toUpperCase() });
  };

  const leaveGame = () => {
    setController(null);
    socket.emit("leave_room");
    setRoom(null);
    setMode("menu");
  };

  const copyRoomCode = async () => {
    if (!room) return;
    await navigator.clipboard.writeText(room.roomCode);
  };

  const controller = controllerRef.current;

  return (
    <main className="app-root">
      <header className="topbar">
        <h1>Distributed Multiplayer Tetris</h1>
        <span className="status-pill">{socket.connected ? "ONLINE" : "OFFLINE"}</span>
      </header>

      {mode !== "game" && (
        <section className="panel">
          <label>
            Nickname
            <div className="inline">
              <input value={nicknameDraft} onChange={(e) => setNicknameDraft(e.target.value)} maxLength={20} />
              <button onClick={saveNickname}>Save</button>
            </div>
          </label>

          <div className="actions">
            <button className="primary" onClick={startSolo}>
              Solo Mode
            </button>
            <button className="primary" onClick={hostGame}>
              Host Game
            </button>
          </div>

          <div className="inline">
            <input
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              placeholder="ROOM CODE"
              maxLength={6}
            />
            <button onClick={joinGame}>Join Game</button>
          </div>

          {room && (
            <div className="room-box">
              <div className="inline">
                <strong>Room Code: {room.roomCode}</strong>
                <button onClick={copyRoomCode}>Copy Code</button>
              </div>
              <p>Status: {room.status === "waiting" ? "Waiting for player..." : room.status}</p>
              <p>Connected Players: {room.players.length}/2</p>
              <ul>
                {room.players.map((player) => (
                  <li key={player.id}>
                    {player.nickname} {player.isHost ? "(HOST)" : "(PLAYER)"}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {error && <p className="error">{error}</p>}
        </section>
      )}

      {mode === "game" && controller && (
        <section className="panel">
          <GameViewport key={controllerVersion} controller={controller} />
          <div className="actions">
            <button onClick={leaveGame}>Exit</button>
          </div>
        </section>
      )}
    </main>
  );
}

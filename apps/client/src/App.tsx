import { useEffect, useRef, useState } from "react";
import type { ClientProfile, RoomSnapshot } from "@tetris/core";
import { GameViewport } from "./components/GameViewport";
import {
  SupabaseRoomSession,
  createRoom,
  ensureProfile,
  getRoom,
  joinRoom,
  leaveRoom,
  reportGameOver
} from "./network/multiplayer";
import { MultiplayerController, SoloController, type GameController } from "./state/controllers";

type Mode = "menu" | "lobby" | "game";

function canStartMatch(room: RoomSnapshot | null): room is RoomSnapshot {
  return !!room && room.status === "running" && room.players.length === 2;
}

export default function App(): JSX.Element {
  const [mode, setMode] = useState<Mode>("menu");
  const [profile, setProfile] = useState<ClientProfile | null>(null);
  const [nicknameDraft, setNicknameDraft] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [room, setRoom] = useState<RoomSnapshot | null>(null);
  const [error, setError] = useState("");
  const [transportState, setTransportState] = useState("CONNECTING");
  const [controllerVersion, setControllerVersion] = useState(0);
  const controllerRef = useRef<GameController | null>(null);
  const roomSessionRef = useRef<SupabaseRoomSession | null>(null);

  const setController = (next: GameController | null) => {
    controllerRef.current?.stop();
    controllerRef.current = next;
    setControllerVersion((v) => v + 1);
  };

  const showError = (message: string) => {
    setError(message);
    window.setTimeout(() => setError(""), 2600);
  };

  useEffect(() => {
    let cancelled = false;
    const storedSessionId = localStorage.getItem("tetris.sessionId") ?? undefined;
    const storedNick = localStorage.getItem("tetris.nickname") ?? undefined;
    setNicknameDraft(storedNick ?? "");

    void ensureProfile(storedSessionId, storedNick)
      .then((nextProfile) => {
        if (cancelled) return;
        setProfile(nextProfile);
        setNicknameDraft(nextProfile.nickname);
        setTransportState("ONLINE");
        localStorage.setItem("tetris.sessionId", nextProfile.sessionId);
        localStorage.setItem("tetris.nickname", nextProfile.nickname);
      })
      .catch((err) => {
        if (cancelled) return;
        setTransportState("ERROR");
        showError(err instanceof Error ? err.message : "Failed to initialize Supabase profile");
      });

    return () => {
      cancelled = true;
      setController(null);
      void roomSessionRef.current?.disconnect();
      roomSessionRef.current = null;
    };
  }, []);

  const maybeStartMatch = async (snapshot: RoomSnapshot) => {
    if (!profile || !canStartMatch(snapshot) || controllerRef.current instanceof MultiplayerController) {
      return;
    }
    const controller = new MultiplayerController({
      players: snapshot.players,
      localPlayerId: profile.sessionId,
      sendEvent: async (payload) => {
        await roomSessionRef.current?.sendEvent(payload);
      },
      onGameOver: async () => {
        const winnerId = await reportGameOver(profile, snapshot.roomCode);
        await roomSessionRef.current?.declareWinner(winnerId);
      }
    });
    controller.start();
    setController(controller);
    setMode("game");
  };

  const connectToRoom = async (snapshot: RoomSnapshot) => {
    if (!profile) return;
    await roomSessionRef.current?.disconnect();
    const session = new SupabaseRoomSession(profile, snapshot, {
      onRoomSync: (nextRoom) => {
        setRoom(nextRoom);
        void maybeStartMatch(nextRoom);
      },
      onMultiplayerEvent: (event) => {
        const controller = controllerRef.current;
        if (controller instanceof MultiplayerController) {
          controller.handleMultiplayerEvent(event);
        }
      },
      onWinner: (winnerId) => {
        const controller = controllerRef.current;
        if (controller instanceof MultiplayerController) {
          controller.setWinner(winnerId);
        }
      },
      onError: (message) => showError(message)
    });
    await session.connect();
    roomSessionRef.current = session;
  };

  const saveNickname = async () => {
    if (!nicknameDraft.trim()) return;
    try {
      const nextProfile = await ensureProfile(profile?.sessionId, nicknameDraft.trim());
      setProfile(nextProfile);
      setNicknameDraft(nextProfile.nickname);
      localStorage.setItem("tetris.nickname", nextProfile.nickname);
    } catch (err) {
      showError(err instanceof Error ? err.message : "Unable to save nickname");
    }
  };

  const startSolo = () => {
    const controller = new SoloController(profile?.nickname || "Guest");
    controller.start();
    setController(controller);
    setMode("game");
  };

  const hostGame = async () => {
    if (!profile) return;
    try {
      const snapshot = await createRoom(profile);
      setRoom(snapshot);
      await connectToRoom(snapshot);
      setMode("lobby");
    } catch (err) {
      showError(err instanceof Error ? err.message : "Unable to create room");
    }
  };

  const joinGame = async () => {
    if (!profile) return;
    try {
      const snapshot = await joinRoom(profile, joinCode.trim().toUpperCase());
      setRoom(snapshot);
      await connectToRoom(snapshot);
      setMode("lobby");
      const refreshed = await getRoom(profile, snapshot.roomCode);
      if (refreshed) {
        setRoom(refreshed);
        await maybeStartMatch(refreshed);
      }
    } catch (err) {
      showError(err instanceof Error ? err.message : "Unable to join room");
    }
  };

  const exitCurrentSession = async () => {
    setController(null);
    if (profile && room) {
      try {
        await leaveRoom(profile, room.roomCode);
      } catch {
        // Keep exit resilient even if the room cleanup request fails.
      }
    }
    await roomSessionRef.current?.disconnect();
    roomSessionRef.current = null;
    setRoom(null);
    setMode("menu");
  };

  const copyRoomCode = async () => {
    if (room) {
      await navigator.clipboard.writeText(room.roomCode);
    }
  };

  const controller = controllerRef.current;

  return (
    <main className="app-root">
      <header className="topbar">
        <h1>Distributed Multiplayer Tetris</h1>
        <span className="status-pill" title={transportState === "ERROR" ? "Room Edge Function or env misconfigured" : undefined}>
          {transportState === "CONNECTING" ? "ROOM API…" : transportState}
        </span>
      </header>

      {mode !== "game" && (
        <section className="panel">
          <label>
            Nickname
            <div className="inline">
              <input value={nicknameDraft} onChange={(e) => setNicknameDraft(e.target.value)} maxLength={20} />
              <button onClick={() => void saveNickname()}>Save</button>
            </div>
          </label>

          <div className="actions">
            <button className="primary" onClick={startSolo}>
              Solo Mode
            </button>
            <button className="primary" onClick={() => void hostGame()}>
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
            <button onClick={() => void joinGame()}>Join Game</button>
          </div>

          {room && (
            <div className="room-box">
              <div className="inline">
                <strong>Room Code: {room.roomCode}</strong>
                <button onClick={() => void copyRoomCode()}>Copy Code</button>
              </div>
              <p>Status: {room.status === "waiting" ? "Waiting for player..." : room.status}</p>
              <p>Connected Players: {room.players.filter((player) => player.connected).length}/2</p>
              <ul>
                {room.players.map((player) => (
                  <li key={player.id}>
                    {player.nickname} {player.isHost ? "(HOST)" : "(PLAYER)"} {player.connected ? "- ONLINE" : "- OFFLINE"}
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
            <button onClick={() => void exitCurrentSession()}>Exit</button>
          </div>
        </section>
      )}
    </main>
  );
}

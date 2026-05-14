import { useCallback, useEffect, useRef, useState } from "react";
import type { ClientProfile, RoomSnapshot } from "@tetris/core";
import { ConnectivityProbe } from "./components/ConnectivityProbe";
import { GameViewport } from "./components/GameViewport";
import {
  SupabaseRoomSession,
  createRoom,
  ensureProfile,
  getRoom,
  joinRoom,
  leaveRoom,
  reportGameOver,
  startChaoticMatch,
  startVersusMatch
} from "./network/multiplayer";
import { ChaoticCoopController, MultiplayerController, SoloController, type GameController } from "./state/controllers";

type Mode = "menu" | "lobby" | "game";

function canStartVersusMatch(room: RoomSnapshot | null): room is RoomSnapshot {
  return !!room && room.roomKind === "versus" && room.status === "running" && room.players.length === 2;
}

function canStartChaoticMatch(room: RoomSnapshot | null): room is RoomSnapshot {
  return !!room && room.roomKind === "chaotic" && room.status === "running" && room.players.length >= 1;
}

function isChaoticWaitingHost(room: RoomSnapshot, sessionId: string | undefined): boolean {
  if (!sessionId) return false;
  if (room.roomKind !== "chaotic" || room.status !== "waiting") return false;
  const sid = sessionId.trim().toLowerCase();
  const hid = (room.hostId ?? "").trim().toLowerCase();
  if (hid === sid) return true;
  return room.players.some((p) => p.id.trim().toLowerCase() === sid && p.isHost);
}

function isVersusWaitingHost(room: RoomSnapshot, sessionId: string | undefined): boolean {
  if (!sessionId) return false;
  if (room.roomKind !== "versus" || room.status !== "waiting") return false;
  const sid = sessionId.trim().toLowerCase();
  const hid = (room.hostId ?? "").trim().toLowerCase();
  if (hid === sid) return true;
  return room.players.some((p) => p.id.trim().toLowerCase() === sid && p.isHost);
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
  const lobbyStateRef = useRef<{ mode: Mode; profile: ClientProfile | null; room: RoomSnapshot | null }>({
    mode: "menu",
    profile: null,
    room: null
  });
  const beginChaoticMatchRef = useRef<() => Promise<void>>(async () => {});

  const setController = (next: GameController | null) => {
    controllerRef.current?.stop();
    controllerRef.current = next;
    setControllerVersion((v) => v + 1);
  };

  const showError = useCallback((message: string) => {
    setError(message);
    window.setTimeout(() => setError(""), 2600);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const storedSessionId = sessionStorage.getItem("tetris.sessionId") ?? undefined;
    const storedNick = sessionStorage.getItem("tetris.nickname") ?? undefined;
    setNicknameDraft(storedNick ?? "");

    void ensureProfile(storedSessionId, storedNick)
      .then((nextProfile) => {
        if (cancelled) return;
        setProfile(nextProfile);
        setNicknameDraft(nextProfile.nickname);
        setTransportState("ONLINE");
        sessionStorage.setItem("tetris.sessionId", nextProfile.sessionId);
        sessionStorage.setItem("tetris.nickname", nextProfile.nickname);
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

  const maybeStartChaoticMatch = async (snapshot: RoomSnapshot) => {
    if (!profile || !canStartChaoticMatch(snapshot) || controllerRef.current instanceof ChaoticCoopController) {
      return;
    }
    const controller = new ChaoticCoopController({
      players: snapshot.players,
      localPlayerId: profile.sessionId,
      hostSessionId: snapshot.hostId,
      sendEvent: async (payload) => {
        await roomSessionRef.current?.sendEvent(payload);
      },
      onGameOver: async () => {
        await reportGameOver(profile, snapshot.roomCode);
        await roomSessionRef.current?.declareWinner(null);
      }
    });
    controller.start();
    setController(controller);
    setMode("game");
  };

  const maybeStartMatch = async (snapshot: RoomSnapshot) => {
    if (!profile || !canStartVersusMatch(snapshot) || controllerRef.current instanceof MultiplayerController) {
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
        void maybeStartChaoticMatch(nextRoom);
      },
      onMultiplayerEvent: (event) => {
        const controller = controllerRef.current;
        if (controller instanceof ChaoticCoopController) {
          if (event.type === "chaotic_input") {
            controller.handleRemoteChaoticInput(event);
          }
          if (event.type === "chaotic_board_sync") {
            controller.applyChaoticBoardSync(event);
          }
          if (event.type === "chaotic_pieces_sync") {
            controller.applyChaoticPiecesSync(event);
          }
          if (event.type === "chaotic_sync") {
            controller.applyChaoticSync(event);
          }
          return;
        }
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
      sessionStorage.setItem("tetris.nickname", nextProfile.nickname);
    } catch (err) {
      showError(err instanceof Error ? err.message : "Unable to save nickname");
    }
  };

  const newGuestSession = async () => {
    sessionStorage.removeItem("tetris.sessionId");
    sessionStorage.removeItem("tetris.nickname");
    setNicknameDraft("");
    setProfile(null);
    setTransportState("CONNECTING");
    try {
      const nextProfile = await ensureProfile(undefined, undefined);
      setProfile(nextProfile);
      setNicknameDraft(nextProfile.nickname);
      sessionStorage.setItem("tetris.sessionId", nextProfile.sessionId);
      sessionStorage.setItem("tetris.nickname", nextProfile.nickname);
      setTransportState("ONLINE");
    } catch (err) {
      setTransportState("ERROR");
      showError(err instanceof Error ? err.message : "Unable to create guest session");
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
      const snapshot = await createRoom(profile, "versus");
      setRoom(snapshot);
      await connectToRoom(snapshot);
      setMode("lobby");
    } catch (err) {
      showError(err instanceof Error ? err.message : "Unable to create room");
    }
  };

  const hostChaoticCoop = async () => {
    if (!profile) return;
    try {
      const snapshot = await createRoom(profile, "chaotic");
      setRoom(snapshot);
      await connectToRoom(snapshot);
      setMode("lobby");
    } catch (err) {
      showError(err instanceof Error ? err.message : "Unable to create chaotic room");
    }
  };

  const beginChaoticMatch = async () => {
    if (!profile || !room || room.roomKind !== "chaotic" || !isChaoticWaitingHost(room, profile.sessionId)) return;
    try {
      const next = await startChaoticMatch(profile, room.roomCode);
      setRoom(next);
      await maybeStartChaoticMatch(next);
    } catch (err) {
      showError(err instanceof Error ? err.message : "Unable to start chaotic match");
    }
  };

  const beginVersusMatch = async () => {
    if (!profile || !room || room.roomKind !== "versus" || !isVersusWaitingHost(room, profile.sessionId)) return;
    if (room.players.length < 2) {
      showError("Need two players in the room before you can start.");
      return;
    }
    try {
      const next = await startVersusMatch(profile, room.roomCode);
      setRoom(next);
      await maybeStartMatch(next);
    } catch (err) {
      showError(err instanceof Error ? err.message : "Unable to start 1v1 match");
    }
  };

  const tryEnterVersusMatch = async () => {
    if (!profile || !room || room.roomKind !== "versus") return;
    try {
      const refreshed = await getRoom(profile, room.roomCode);
      if (refreshed) {
        setRoom(refreshed);
        await maybeStartMatch(refreshed);
      }
    } catch (err) {
      showError(err instanceof Error ? err.message : "Unable to enter match");
    }
  };

  beginChaoticMatchRef.current = beginChaoticMatch;
  lobbyStateRef.current = { mode, profile, room };

  const joinGame = async () => {
    if (!profile) return;
    try {
      const snapshot = await joinRoom(profile, joinCode.trim().toUpperCase());
      if (
        snapshot.players.length === 1 &&
        snapshot.players[0]?.id === profile.sessionId &&
        snapshot.players[0].isHost
      ) {
        showError(
          "That room code is yours already (same browser session). For a second player, open a private/incognito window or click New guest session, then join again."
        );
        setRoom(snapshot);
        await connectToRoom(snapshot);
        setMode("lobby");
        return;
      }
      setRoom(snapshot);
      await connectToRoom(snapshot);
      setMode("lobby");
      const refreshed = await getRoom(profile, snapshot.roomCode);
      if (refreshed) {
        setRoom(refreshed);
        await maybeStartMatch(refreshed);
        await maybeStartChaoticMatch(refreshed);
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

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat || e.code !== "KeyH") return;
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      const { mode: m, profile: prof, room: r } = lobbyStateRef.current;
      if (m === "game" || !prof || !r) return;
      if (!isChaoticWaitingHost(r, prof.sessionId)) return;
      if (r.players.length < 2) {
        e.preventDefault();
        showError("Share the room code so someone joins, then press H to start.");
        return;
      }
      e.preventDefault();
      void beginChaoticMatchRef.current();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [showError]);

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
          <ConnectivityProbe />
          <label>
            Nickname
            <div className="inline">
              <input value={nicknameDraft} onChange={(e) => setNicknameDraft(e.target.value)} maxLength={20} />
              <button onClick={() => void saveNickname()}>Save</button>
              <button type="button" onClick={() => void newGuestSession()} title="New random session for a second player on this PC">
                New guest session
              </button>
            </div>
          </label>

          <div className="actions">
            <button className="primary" onClick={startSolo}>
              Solo Mode
            </button>
            <button className="primary" onClick={() => void hostGame()}>
              Host Game
            </button>
            <button className="primary" onClick={() => void hostChaoticCoop()} title="Many players, one shared grid">
              Host chaotic co-op
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
                <span style={{ marginLeft: 8 }}>Mode: {room.roomKind === "chaotic" ? "Chaotic co-op" : "1v1"}</span>
                <button onClick={() => void copyRoomCode()}>Copy Code</button>
              </div>
              <p>
                Status:{" "}
                {room.status === "waiting" && room.roomKind === "versus" && room.players.length === 2
                  ? "Ready — host starts the match with the green button below."
                  : room.status === "waiting"
                    ? "Waiting for players..."
                    : room.status}
              </p>
              <p>
                Connected: {room.players.filter((player) => player.connected).length}
                {room.roomKind === "versus" ? " / 2 max" : " — unlimited players"}
              </p>
              <ul className="room-player-list">
                {room.players.map((player) => (
                  <li key={player.id}>
                    {player.nickname} {player.isHost ? "(HOST)" : "(PLAYER)"} {player.connected ? "- ONLINE" : "- OFFLINE"}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {error && <p className="error">{error}</p>}
          {room && room.roomKind === "versus" && room.players.length === 2 && profile && (
            <div className="versus-panel-footer">
              {room.status === "waiting" && isVersusWaitingHost(room, profile.sessionId) && (
                <>
                  <button type="button" className="versus-mega-start" onClick={() => void beginVersusMatch()}>
                    START 1v1 MATCH
                  </button>
                  <p className="versus-mega-sub">Host: both players are in — tap to begin (1v1 no longer auto-starts).</p>
                </>
              )}
              {room.status === "waiting" && !isVersusWaitingHost(room, profile.sessionId) && (
                <p className="versus-footer-guest">
                  1v1 lobby: wait for the <strong>host</strong> to press <strong>START 1v1 MATCH</strong>.
                </p>
              )}
              {room.status === "running" && (
                <>
                  <button type="button" className="versus-enter-btn" onClick={() => void tryEnterVersusMatch()}>
                    ENTER 1v1 MATCH
                  </button>
                  <p className="versus-mega-sub">Tap if the game did not open automatically after the host started.</p>
                </>
              )}
            </div>
          )}
          {room && room.roomKind === "chaotic" && room.status === "waiting" && profile && (
            <div className="chaotic-panel-footer">
              {isChaoticWaitingHost(room, profile.sessionId) ? (
                <>
                  <button type="button" className="chaotic-mega-start" onClick={() => void beginChaoticMatch()}>
                    START CHAOTIC MATCH
                  </button>
                  <p className="chaotic-mega-sub">
                    Host: use this button (big red). Or press <strong>H</strong> when two or more players are in the room.
                  </p>
                </>
              ) : (
                <p className="chaotic-footer-guest">
                  Chaotic lobby: wait for the <strong>host</strong> to start the match.
                </p>
              )}
            </div>
          )}
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

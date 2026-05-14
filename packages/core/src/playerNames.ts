/** Short display names with parallel / distributed systems flavor (max 20 chars for DB). */
const PREFIXES = [
  "Shard",
  "Replica",
  "RaftNode",
  "MapStage",
  "VectorClk",
  "Barrier",
  "Quorum",
  "Epoch",
  "Worker",
  "MapReduce",
  "Lamport",
  "Merkle",
  "Actor",
  "CAS",
  "LockFree",
  "Pipeline",
  "Gossip",
  "SplitBrain",
  "TwoPhase",
  "Byzantine",
  "CRDT",
  "Reducer",
  "FanOut",
  "Backpressure"
];

/**
 * Random nickname for a browser tab / session (not cryptographically unique;
 * room layer still dedupes by nickname index when needed).
 */
export function generateDistributedPlayerNickname(): string {
  const pick = PREFIXES[Math.floor(Math.random() * PREFIXES.length)]!;
  const tag = Math.random().toString(36).slice(2, 6);
  const base = `${pick}_${tag}`;
  return base.length > 20 ? base.slice(0, 20) : base;
}

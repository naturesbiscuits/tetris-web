export const BOARD_WIDTH = 10;
export const BOARD_HEIGHT = 22;
export const VISIBLE_HEIGHT = 20;

/** Chaotic co-op: wider, taller shared playfield (solo / 1v1 still use {@link BOARD_WIDTH} / {@link BOARD_HEIGHT}). */
export const CHAOTIC_BOARD_WIDTH = 18;
export const CHAOTIC_BOARD_HEIGHT = 32;
/** Rows shown above the vanish zone (two hidden rows at top, same pattern as standard). */
export const CHAOTIC_VISIBLE_HEIGHT = 30;
export const TICKS_PER_SECOND = 60;

export const INPUT_DELAY_TICKS = 2;
export const SERVER_STATE_BROADCAST_INTERVAL = 6;

export const SCORE_SOFT_DROP = 1;
export const SCORE_HARD_DROP = 2;

export const SCORE_LINE_CLEAR: Record<number, number> = {
  1: 100,
  2: 300,
  3: 500,
  4: 800
};

export const ATTACK_TABLE: Record<number, number> = {
  1: 0,
  2: 1,
  3: 2,
  4: 4
};

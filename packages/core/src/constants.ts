export const BOARD_WIDTH = 10;
export const BOARD_HEIGHT = 22;
export const VISIBLE_HEIGHT = 20;
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

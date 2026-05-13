export class DeterministicRng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0 || 1;
  }

  nextInt(): number {
    let x = this.state;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.state = x >>> 0;
    return this.state;
  }

  nextFloat(): number {
    return this.nextInt() / 0xffffffff;
  }

  nextRange(max: number): number {
    if (max <= 0) return 0;
    return this.nextInt() % max;
  }
}

export class PerformanceMonitor {
  private samples = new Float32Array(300);
  private index = 0;
  private count = 0;
  private calls = 0;
  private triangles = 0;
  totalFrames = 0;
  record(ms: number, info: { calls: number; triangles: number }): void {
    if (ms <= 0 || ms > 1000) return;
    this.samples[this.index] = ms;
    this.index = (this.index + 1) % this.samples.length;
    this.count = Math.min(this.count + 1, this.samples.length);
    this.calls = info.calls;
    this.triangles = info.triangles;
    this.totalFrames++;
  }
  reset(): void { this.count = 0; this.index = 0; }
  snapshot() {
    const values = Array.from(this.samples.subarray(0, this.count)).sort((a, b) => a - b);
    const avg = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
    const p95 = values[Math.min(values.length - 1, Math.floor(values.length * .95))] || 0;
    return { frames: this.count, totalFrames: this.totalFrames, fps: avg ? Math.round(100000 / avg) / 100 : 0,
      meanMs: +avg.toFixed(2), p95Ms: +p95.toFixed(2), drawCalls: this.calls, triangles: this.triangles };
  }
}

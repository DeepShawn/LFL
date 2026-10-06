import { describe, it, expect } from 'vitest';
import { createWebGLContext, getQualityProfile } from './qualityProfiles';
import { PerformanceMonitor } from './performanceMonitor';
import { moveWithinRoom } from '../world/collision';

describe('WebGL 2 and quality', () => {
  it('requests only WebGL 2 on the render canvas, with no WebGL 1 probe', () => {
    const requests: string[] = [];
    const gl = { isContextLost: () => false };
    const canvas = { getContext: (name: string) => { requests.push(name); return gl; } };
    expect(createWebGLContext(canvas as unknown as HTMLCanvasElement, false)).toBe(gl);
    expect(requests).toEqual(['webgl2']);
  });
  it('does not mislabel an unavailable context as a rendered scene', () => {
    const canvas = { getContext: () => null };
    expect(createWebGLContext(canvas as unknown as HTMLCanvasElement, true)).toBeNull();
  });
  it('uses explicit quality choices, pixel budgets, and mobile shadow limits', () => {
    expect(getQualityProfile('auto', true).assetTier).toBe('mobile');
    expect(getQualityProfile('auto', true).shadows).toBe(false);
    expect(getQualityProfile('high', true).assetTier).toBe('desktop');
    expect(getQualityProfile('low', false).maxPixelRatio).toBeLessThanOrEqual(1);
  });
});

describe('real frame measurements', () => {
  it('reports actual frame deltas rather than configured target FPS', () => {
    const monitor = new PerformanceMonitor();
    for (let i = 0; i < 120; i++) monitor.record(20, { calls: 17, triangles: 2000 });
    const report = monitor.snapshot();
    expect(report.fps).toBeCloseTo(50);
    expect(report.p95Ms).toBe(20);
    expect(report.drawCalls).toBe(17);
  });
  it('ignores pause gaps and clears the sample window explicitly', () => {
    const monitor = new PerformanceMonitor();
    monitor.record(10000, { calls: 1, triangles: 1 });
    expect(monitor.snapshot().frames).toBe(0);
    monitor.record(16, { calls: 1, triangles: 1 });
    monitor.reset();
    expect(monitor.snapshot().frames).toBe(0);
  });
});

describe('shared walk collision', () => {
  const room = { bounds: [-5, 5, -4, 4] as [number, number, number, number], obstacles: [[-1, 1, -1, 1] as [number, number, number, number]] };
  it('blocks desk penetration and allows movement down an aisle', () => {
    expect(moveWithinRoom({ x: 0, z: 1.3 }, 0, -0.2, room).z).toBeGreaterThanOrEqual(1.18);
    expect(moveWithinRoom({ x: 2, z: 1.3 }, 0, -0.2, room).z).toBeCloseTo(1.1);
  });
  it('keeps the player within room walls', () => {
    expect(moveWithinRoom({ x: 4.7, z: 0 }, 1, 0, room).x).toBeLessThanOrEqual(4.82);
  });
});

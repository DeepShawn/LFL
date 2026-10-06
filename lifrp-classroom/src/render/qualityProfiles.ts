export type Quality = 'auto' | 'high' | 'medium' | 'low';
export interface QualityProfile {
  assetTier: 'desktop' | 'mobile';
  maxPixelRatio: number;
  pixelBudget: number;
  shadows: boolean;
  shadowSize: number;
  rainCount: number;
}
const PROFILES: Record<Exclude<Quality, 'auto'>, QualityProfile> = {
  high: { assetTier: 'desktop', maxPixelRatio: 1.5, pixelBudget: 2400000, shadows: true, shadowSize: 1024, rainCount: 220 },
  medium: { assetTier: 'mobile', maxPixelRatio: 1.2, pixelBudget: 1100000, shadows: false, shadowSize: 512, rainCount: 90 },
  low: { assetTier: 'mobile', maxPixelRatio: 0.85, pixelBudget: 650000, shadows: false, shadowSize: 256, rainCount: 35 },
};
export function getQualityProfile(quality: Quality, coarsePointer: boolean): QualityProfile {
  return { ...PROFILES[quality === 'auto' ? (coarsePointer ? 'medium' : 'high') : quality] };
}
export function createWebGLContext(canvas: HTMLCanvasElement, antialias: boolean): WebGL2RenderingContext | null {
  return canvas.getContext('webgl2', { antialias, alpha: false, powerPreference: 'high-performance' });
}
export function pixelRatio(profile: QualityProfile, width: number, height: number, deviceRatio: number): number {
  return Math.min(deviceRatio, profile.maxPixelRatio, Math.sqrt(profile.pixelBudget / (width * height)));
}

import type { Lut } from './luts';
import { PostProcessor, postActive } from './post';
import { drawSafeZones, renderFrame, type RenderInput } from './renderer';
import type { PostSettings, Ratio } from './types';

export interface CompositeInput extends RenderInput {
  getLut: (key: string) => Lut | null;
}

type DrawLayer = (ctx: CanvasRenderingContext2D, W: number, H: number) => void;

export interface LayeredFrame {
  t: number;
  post: PostSettings;
  getLut: (key: string) => Lut | null;
  /** Everything that gets graded (LUT, grain, vignette). */
  base: DrawLayer;
  /** Drawn on top after grading, e.g. an overlay that should stay clean. */
  top?: DrawLayer;
  /** Draws Instagram safe-zone guides for this ratio (preview only). */
  safeZones?: Ratio | null;
}

/**
 * Renders frames into a 2D canvas, routing them through the WebGL
 * post-processing pass (LUT, grain, vignette) when any of those are on.
 * Shared by the previews and all exporters so they always match.
 */
export class Compositor {
  private scene: HTMLCanvasElement | null = null;
  private post: PostProcessor | null = null;
  private postFailed = false;

  constructor(private readonly target: CanvasRenderingContext2D) {}

  /** False when post effects are requested but WebGL2 isn't available. */
  get postAvailable(): boolean {
    return !this.postFailed;
  }

  /** A cover-crate frame (see renderer.ts). */
  draw(input: CompositeInput): void {
    this.drawLayers({
      t: input.t,
      post: input.project.post,
      getLut: input.getLut,
      base: (ctx, W, H) => renderFrame(ctx, W, H, { ...input, safeZones: false }),
      safeZones: input.safeZones ? input.project.ratio : null,
    });
  }

  drawLayers(frame: LayeredFrame): void {
    const ctx = this.target;
    const W = ctx.canvas.width;
    const H = ctx.canvas.height;
    const post = postActive(frame.post) ? this.ensurePost() : null;

    if (!post) {
      frame.base(ctx, W, H);
    } else {
      if (!this.scene) this.scene = document.createElement('canvas');
      if (this.scene.width !== W || this.scene.height !== H) {
        this.scene.width = W;
        this.scene.height = H;
      }
      const sceneCtx = this.scene.getContext('2d', { alpha: false })!;
      frame.base(sceneCtx, W, H);
      const lut = frame.post.lut === 'none' ? null : frame.getLut(frame.post.lut);
      post.render(this.scene, W, H, frame.post, lut, frame.t);
      ctx.drawImage(post.canvas, 0, 0, W, H);
    }
    frame.top?.(ctx, W, H);
    // Guides are drawn last so they stay legible.
    if (frame.safeZones) drawSafeZones(ctx, W, H, frame.safeZones);
  }

  private ensurePost(): PostProcessor | null {
    if (this.postFailed) return null;
    if (this.post?.lost) {
      this.post = null;
    }
    if (!this.post) {
      try {
        this.post = new PostProcessor();
      } catch (err) {
        console.warn('[CoverVinyl] Post-processing unavailable:', err);
        this.postFailed = true;
        return null;
      }
    }
    return this.post;
  }

  dispose(): void {
    this.post?.dispose();
    this.post = null;
  }
}

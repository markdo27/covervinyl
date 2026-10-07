import type { Lut } from './luts';
import { PostProcessor, postActive } from './post';
import { drawSafeZones, renderFrame, type RenderInput } from './renderer';

export interface CompositeInput extends RenderInput {
  getLut: (key: string) => Lut | null;
}

/**
 * Renders a frame into a 2D canvas, routing it through the WebGL
 * post-processing pass (LUT, grain, vignette) when any of those are on.
 * Shared by the preview and both exporters so they always match.
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

  draw(input: CompositeInput): void {
    const ctx = this.target;
    const W = ctx.canvas.width;
    const H = ctx.canvas.height;
    const settings = input.project.post;
    const post = postActive(settings) ? this.ensurePost() : null;
    if (!post) {
      renderFrame(ctx, W, H, input);
      return;
    }

    if (!this.scene) this.scene = document.createElement('canvas');
    if (this.scene.width !== W || this.scene.height !== H) {
      this.scene.width = W;
      this.scene.height = H;
    }
    const sceneCtx = this.scene.getContext('2d', { alpha: false })!;
    renderFrame(sceneCtx, W, H, { ...input, safeZones: false });
    const lut = settings.lut === 'none' ? null : input.getLut(settings.lut);
    post.render(this.scene, W, H, settings, lut, input.t);
    ctx.drawImage(post.canvas, 0, 0, W, H);
    // Guides are drawn after grading so they stay legible.
    if (input.safeZones) drawSafeZones(ctx, W, H, input.project.ratio);
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

/**
 * Plays a decoded AudioBuffer in step with a playhead (used to hear the
 * enhanced clip sound in the preview while the <video> stays muted).
 */
let sharedCtx: AudioContext | null = null;

export interface LoopRange {
  start: number;
  end: number;
}

const DRIFT = 0.15;

export class BufferPlayer {
  private readonly ctx: AudioContext;
  private readonly gain: GainNode;
  private node: AudioBufferSourceNode | null = null;
  private buffer: AudioBuffer | null = null;
  private loop: LoopRange | null = null;
  private anchor = { ctxTime: 0, offset: 0 };

  constructor() {
    this.ctx = sharedCtx ??= new AudioContext();
    this.gain = this.ctx.createGain();
    this.gain.connect(this.ctx.destination);
  }

  setBuffer(buffer: AudioBuffer | null): void {
    if (buffer === this.buffer) return;
    this.stop();
    this.buffer = buffer;
  }

  /** Where in the buffer playback is now. */
  private position(): number {
    let pos = this.anchor.offset + (this.ctx.currentTime - this.anchor.ctxTime);
    const loop = this.loop;
    if (loop && pos >= loop.end) pos = loop.start + ((pos - loop.start) % (loop.end - loop.start));
    return pos;
  }

  /** Plays from `offset` seconds (restarting only when asked or when it has drifted), or stops. */
  sync(offset: number, playing: boolean, force: boolean, volume: number, loop: LoopRange | null = null): void {
    this.gain.gain.setTargetAtTime(Math.max(0, volume), this.ctx.currentTime, 0.015);
    if (!playing || !this.buffer) {
      this.stop();
      return;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    const loopChanged = (loop?.start ?? -1) !== (this.loop?.start ?? -1) || (loop?.end ?? -1) !== (this.loop?.end ?? -1);
    if (!this.node || force || loopChanged || Math.abs(this.position() - offset) > DRIFT) this.start(offset, loop);
  }

  private start(offset: number, loop: LoopRange | null): void {
    const buffer = this.buffer;
    if (!buffer) return;
    this.stop();
    const node = this.ctx.createBufferSource();
    node.buffer = buffer;
    if (loop && loop.end - loop.start > 0.05) {
      node.loop = true;
      node.loopStart = loop.start;
      node.loopEnd = Math.min(loop.end, buffer.duration);
    }
    node.connect(this.gain);
    const at = Math.min(Math.max(0, offset), buffer.duration);
    node.start(0, at);
    this.node = node;
    this.loop = loop;
    this.anchor = { ctxTime: this.ctx.currentTime, offset: at };
  }

  stop(): void {
    if (!this.node) return;
    try {
      this.node.stop();
    } catch {
      // Already stopped.
    }
    this.node.disconnect();
    this.node = null;
  }

  dispose(): void {
    this.stop();
    this.gain.disconnect();
  }
}

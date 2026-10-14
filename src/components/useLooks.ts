/** The colour-look (LUT) handlers every editor shares: uploads, removal and presets. */
import { useEffect } from 'react';
import { CUSTOM_LUT_PREFIX } from '../engine/luts';
import { unembedLut, type EmbeddedLut } from '../engine/presets';
import type { PostSettings } from '../engine/types';
import type { Attachment } from './PresetDialogs';
import type { LutLibrary } from './shell';

export function useLooks(
  luts: LutLibrary,
  post: PostSettings,
  setPost: (patch: Partial<PostSettings>) => void,
  flash: (kind: 'error' | 'info', text: string) => void,
) {
  const onLutFile = async (file: File) => {
    try {
      const lut = await luts.addFile(file);
      setPost({ lut: lut.key, lutIntensity: 1 });
      flash('info', `Loaded LUT “${lut.name}” (${lut.size}³).`);
    } catch (err) {
      flash('error', `Couldn't load “${file.name}”: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const onRemoveLut = (key: string) => {
    luts.remove(key);
    if (post.lut === key) setPost({ lut: 'none' });
  };

  // A LUT removed in another editor falls back to no look here too.
  const missing = post.lut.startsWith(CUSTOM_LUT_PREFIX) && !luts.get(post.lut);
  useEffect(() => {
    if (missing) setPost({ lut: 'none' });
  }, [missing, setPost]);

  /** The uploaded LUT in use, if any. */
  const customLut = () => (post.lut.startsWith(CUSTOM_LUT_PREFIX) ? luts.get(post.lut) : null);

  const lutAttachment = (): Attachment | null => {
    const lut = customLut();
    return lut ? { key: 'lut', label: `LUT: ${lut.name}`, detail: `Your .cube look (${lut.size}³)`, bytes: lut.size ** 3 * 3 } : null;
  };

  /** Registers a preset's LUT; returns its key and a warning if the preset needed one it doesn't carry. */
  const adoptPresetLut = (embedded: EmbeddedLut | undefined, presetLut: string) => {
    const lutKey = embedded ? luts.adopt(unembedLut(embedded, '')).key : null;
    const warning =
      presetLut.startsWith(CUSTOM_LUT_PREFIX) && !lutKey ? `its own LUT wasn't saved with it, so no colour look is applied.` : null;
    return { lutKey, warning };
  };

  return { onLutFile, onRemoveLut, customLut, lutAttachment, adoptPresetLut };
}

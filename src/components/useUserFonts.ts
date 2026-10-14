/** Uploaded fonts for one editor: loading, removing, and fonts carried by presets. */
import { useEffect, useState } from 'react';
import {
  BUILT_IN_FONTS,
  ensureFontsLoaded,
  fontStack,
  loadUserFont,
  unloadUserFont,
  USER_FONT_PREFIX,
  userFontKey,
  type UserFontFace,
} from '../engine/fonts';
import { clearPlaceholderCache } from '../engine/placeholder';
import type { EmbeddedFile } from '../engine/presets';
import { clearLayoutCache } from '../engine/textLayout';
import type { TextStyle } from '../engine/types';
import { unembedFile } from '../lib/presetFiles';

export function useUserFonts(flash: (kind: 'error' | 'info', text: string) => void) {
  const [fonts, setFonts] = useState<UserFontFace[]>([]);
  /** Bumped whenever text measurements change, so previews redraw. */
  const [fontEpoch, setFontEpoch] = useState(0);

  const remeasure = () => {
    clearLayoutCache();
    setFontEpoch((e) => e + 1);
  };

  // Re-measure text whenever a font finishes loading.
  useEffect(() => {
    const onFontsLoaded = () => {
      clearLayoutCache();
      clearPlaceholderCache();
      setFontEpoch((e) => e + 1);
    };
    document.fonts.addEventListener('loadingdone', onFontsLoaded);
    void ensureFontsLoaded([fontStack('inter')], [300, 400, 700, 800]).then(onFontsLoaded);
    return () => document.fonts.removeEventListener('loadingdone', onFontsLoaded);
  }, []);

  /** Loads uploaded font files; returns the ones that worked. */
  const addFiles = async (files: File[]): Promise<UserFontFace[]> => {
    const loaded: UserFontFace[] = [];
    for (const file of files) {
      try {
        loaded.push(await loadUserFont(file));
      } catch {
        flash('error', `Couldn't read “${file.name}” as a font.`);
      }
    }
    if (loaded.length) {
      setFonts((old) => [...old, ...loaded]);
      remeasure();
    }
    return loaded;
  };

  const removeFamily = (family: string) => {
    fonts.filter((f) => f.family === family).forEach(unloadUserFont);
    setFonts((old) => old.filter((f) => f.family !== family));
    remeasure();
  };

  /** Font files of the families a text style uses. */
  const filesFor = (text: TextStyle) => {
    const used = new Set([text.family, text.headlineFamily]);
    return fonts.filter((f) => used.has(userFontKey(f.family)));
  };

  /**
   * Loads a preset's fonts (skipping files already loaded) and returns a
   * check for which font keys can be drawn afterwards, plus any warnings.
   */
  const loadEmbedded = async (embedded: EmbeddedFile[] | undefined) => {
    const available = new Set(fonts.map((f) => f.family));
    const warnings: string[] = [];
    const loaded: UserFontFace[] = [];
    for (const e of embedded ?? []) {
      const file = await unembedFile(e);
      if (fonts.some((f) => f.fileName === file.name && f.file.size === file.size)) continue;
      try {
        loaded.push(await loadUserFont(file));
      } catch {
        warnings.push(`couldn't read the font “${file.name}”.`);
      }
    }
    if (loaded.length) {
      setFonts((old) => [...old, ...loaded]);
      loaded.forEach((f) => available.add(f.family));
      remeasure();
    }
    const hasFont = (key: string) =>
      key.startsWith(USER_FONT_PREFIX) ? available.has(key.slice(USER_FONT_PREFIX.length)) : BUILT_IN_FONTS.some((f) => f.key === key);
    return { hasFont, warnings };
  };

  /** A warning when a text style names a font that isn't loaded. */
  const missingFontWarning = (text: TextStyle, hasFont: (key: string) => boolean): string | null => {
    const missing = [...new Set([text.family, text.headlineFamily])].filter((k) => !hasFont(k));
    return missing.length ? `the font “${missing[0].replace(USER_FONT_PREFIX, '')}” wasn't saved with it, so Inter is used.` : null;
  };

  return { fonts, fontEpoch, addFiles, removeFamily, filesFor, loadEmbedded, missingFontWarning, remeasure };
}

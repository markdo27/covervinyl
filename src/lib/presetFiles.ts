/** Reading and writing preset .json files, and packing user files into them. */
import { parsePreset, presetFileName, type EmbeddedFile, type Preset } from '../engine/presets';

export async function embedFile(file: File): Promise<EmbeddedFile> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error(`Couldn't read “${file.name}”.`));
    reader.readAsDataURL(file);
  });
  return { name: file.name, type: file.type, data: dataUrl.slice(dataUrl.indexOf(',') + 1) };
}

export async function unembedFile(e: EmbeddedFile): Promise<File> {
  const type = e.type || 'application/octet-stream';
  const blob = await (await fetch(`data:${type};base64,${e.data}`)).blob();
  return new File([blob], e.name, { type: e.type });
}

/** Size of a file once base64-encoded into the preset. */
export const embeddedSize = (bytes: number) => Math.ceil(bytes / 3) * 4;

export function downloadPreset(preset: Preset): string {
  const fileName = presetFileName(preset.name);
  const blob = new Blob([JSON.stringify(preset, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return fileName;
}

export async function readPresetFile(file: File): Promise<Preset> {
  let raw: unknown;
  try {
    raw = JSON.parse(await file.text());
  } catch {
    throw new Error(`“${file.name}” isn’t a preset file (it isn’t valid JSON).`);
  }
  return parsePreset(raw);
}

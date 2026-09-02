/**
 * Saving a frame.
 *
 * A plain <a download> works when the page is served normally, but inside the
 * claude.ai artifact viewer the frame has no download permission and such a
 * link silently does nothing. There the page asks the host to hand the file to
 * the viewer instead, which shows a confirmation the viewer can decline.
 *
 * Both paths are attempted in order and the caller is told what happened, so
 * the interface never claims to have saved something it did not.
 */

interface ClaudeHost {
  use?: (name: string) => Promise<unknown>;
}

interface DownloadsNamespace {
  save: (req: { filename: string; data: Blob }) => Promise<{ status: string }>;
}

let downloadsPromise: Promise<DownloadsNamespace | null> | null = null;

function hostDownloads(): Promise<DownloadsNamespace | null> {
  if (!downloadsPromise) {
    const host = (window as unknown as { claude?: ClaudeHost }).claude;
    downloadsPromise = host?.use
      ? host.use('downloads').then((d) => (d as DownloadsNamespace | null) ?? null, () => null)
      : Promise.resolve(null);
  }
  return downloadsPromise;
}

export type SaveOutcome = 'saved' | 'declined' | 'unavailable';

export async function saveBlob(blob: Blob, filename: string): Promise<SaveOutcome> {
  const host = await hostDownloads();
  if (host) {
    try {
      await host.save({ filename, data: blob });
      return 'saved';
    } catch (err) {
      const code = (err as { code?: string } | undefined)?.code;
      return code === 'declined' ? 'declined' : 'unavailable';
    }
  }
  // Ordinary page: hand the browser a blob URL.
  try {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    return 'saved';
  } catch {
    return 'unavailable';
  }
}

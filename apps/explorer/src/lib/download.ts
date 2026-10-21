/** Browser download of in-memory bytes. Returns false when the runtime
 *  cannot produce object URLs (e.g. test DOMs) — callers surface an honest
 *  "download unavailable" instead of a silent no-op. */
export function saveBlob(bytes: Uint8Array, fileName: string, mime = 'application/octet-stream'): boolean {
  if (typeof URL.createObjectURL !== 'function') return false;
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    return true;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Best-effort clipboard copy; reports failure honestly. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator === 'undefined' || navigator.clipboard === undefined) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

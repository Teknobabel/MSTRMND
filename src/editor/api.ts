import type { ContentIssue, RawContentSlices } from "../game/contentSchema";

export type SaveResult =
  | { ok: true; written: string[] }
  | { ok: false; issues: ContentIssue[]; error?: string };

export async function fetchSlices(): Promise<RawContentSlices> {
  const res = await fetch("/__content-api/slices");
  if (!res.ok) {
    throw new Error(`Failed to load content slices (HTTP ${res.status})`);
  }
  const body = (await res.json()) as { slices: RawContentSlices };
  return body.slices;
}

export async function saveSlices(slices: RawContentSlices): Promise<SaveResult> {
  const res = await fetch("/__content-api/slices", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ slices }),
  });
  if (res.status === 422) {
    const body = (await res.json()) as { issues: ContentIssue[] };
    return { ok: false, issues: body.issues };
  }
  if (!res.ok) {
    return { ok: false, issues: [], error: `HTTP ${res.status}` };
  }
  const body = (await res.json()) as { written: string[] };
  return { ok: true, written: body.written };
}

/* ---------- Uploaded card art (dev-server writes to public/assets/cards/custom/) ---------- */

export type ArtFileEntry = { name: string; path: string; animated: boolean; bytes: number };

export type ArtUploadResult =
  | { ok: true; path: string; animated: boolean }
  | { ok: false; status: number; error: string };

export async function fetchArtList(): Promise<ArtFileEntry[]> {
  const res = await fetch("/__content-api/art");
  if (!res.ok) {
    throw new Error(`Failed to list art files (HTTP ${res.status})`);
  }
  const body = (await res.json()) as { files: ArtFileEntry[] };
  return body.files;
}

export async function uploadArt(
  name: string,
  bytes: ArrayBuffer,
  overwrite: boolean,
): Promise<ArtUploadResult> {
  const params = new URLSearchParams({ name });
  if (overwrite) {
    params.set("overwrite", "1");
  }
  const res = await fetch(`/__content-api/art?${params.toString()}`, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: bytes,
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: false, status: res.status, error: body.error ?? `HTTP ${res.status}` };
  }
  const body = (await res.json()) as { path: string; animated: boolean };
  return { ok: true, path: body.path, animated: body.animated };
}

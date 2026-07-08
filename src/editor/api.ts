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

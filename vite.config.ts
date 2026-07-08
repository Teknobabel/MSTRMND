import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { defineConfig, type Plugin } from "vite";
import {
  CONTENT_MANIFEST,
  parseContentCatalog,
  type ContentSliceKey,
  type RawContentSlices,
} from "./src/game/contentSchema";
import { serializeContentSlice } from "./src/game/contentSerialize";
import {
  ART_UPLOAD_DIR,
  ART_URL_PREFIX,
  MAX_ART_BYTES,
  isWebpBytes,
  sanitizeArtFileName,
  webpHasAnimation,
} from "./src/editor/artFiles";

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

function readBodyBytes(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolvePromise, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolvePromise(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function readBody(req: IncomingMessage): Promise<string> {
  return (await readBodyBytes(req)).toString("utf8");
}

/**
 * Dev-only content API for the editor page (`/editor.html`).
 *
 * GET  /__content-api/slices  → { slices: RawContentSlices } read from `content/*.json`
 * PUT  /__content-api/slices  → body { slices: RawContentSlices }; re-validates the whole
 *      draft and refuses to write when issues exist (422 with the issue list), so files on
 *      disk always pass `npm run content:validate`. Writes only changed slices, through
 *      `serializeContentSlice` (canonical formatting).
 *
 * GET  /__content-api/art  → { files: [{ name, path, animated, bytes }] } listing
 *      `public/assets/cards/custom/*.webp` (uploads live under `public/`, so Vite
 *      serves them in dev and copies them into `dist/` on build).
 * POST /__content-api/art?name=<slug>[&overwrite=1] → raw WebP bytes in the body;
 *      the name is slugged, the bytes must carry a real WebP header, and an existing
 *      file is a 409 unless `overwrite=1`. Responds { path, animated }.
 *
 * `apply: "serve"` keeps this out of production builds entirely.
 */
function contentEditorPlugin(): Plugin {
  return {
    name: "mastermind-content-editor-api",
    apply: "serve",
    configureServer(server) {
      const root = server.config.root;
      const artDir = resolve(root, ART_UPLOAD_DIR);

      server.middlewares.use("/__content-api/art", (req, res) => {
        void (async () => {
          if (req.method === "GET") {
            const files = (existsSync(artDir) ? readdirSync(artDir) : [])
              .filter((f) => f.toLowerCase().endsWith(".webp"))
              .sort()
              .map((f) => {
                const bytes = readFileSync(resolve(artDir, f));
                return {
                  name: f,
                  path: `${ART_URL_PREFIX}${f}`,
                  animated: webpHasAnimation(bytes),
                  bytes: statSync(resolve(artDir, f)).size,
                };
              });
            sendJson(res, 200, { files });
            return;
          }
          if (req.method === "POST") {
            const url = new URL(req.url ?? "", "http://localhost");
            const slug = sanitizeArtFileName(url.searchParams.get("name") ?? "");
            if (slug === null) {
              sendJson(res, 400, { error: "Provide ?name= (letters/digits; slugged server-side)" });
              return;
            }
            const body = await readBodyBytes(req);
            if (body.length === 0 || body.length > MAX_ART_BYTES) {
              sendJson(res, 413, {
                error: `Upload must be 1 byte – ${MAX_ART_BYTES / (1024 * 1024)} MB`,
              });
              return;
            }
            if (!isWebpBytes(body)) {
              sendJson(res, 415, {
                error: "Not a WebP file (bad magic bytes) — export as .webp and retry",
              });
              return;
            }
            const filePath = resolve(artDir, `${slug}.webp`);
            if (existsSync(filePath) && url.searchParams.get("overwrite") !== "1") {
              sendJson(res, 409, { error: `${slug}.webp already exists` });
              return;
            }
            mkdirSync(artDir, { recursive: true });
            writeFileSync(filePath, body);
            sendJson(res, 200, {
              path: `${ART_URL_PREFIX}${slug}.webp`,
              animated: webpHasAnimation(body),
            });
            return;
          }
          res.setHeader("Allow", "GET, POST");
          sendJson(res, 405, { error: "Method not allowed" });
        })().catch((e: unknown) => {
          sendJson(res, 500, { error: String(e) });
        });
      });

      server.middlewares.use("/__content-api/slices", (req, res) => {
        void (async () => {
          if (req.method === "GET") {
            const slices = {} as Record<ContentSliceKey, unknown>;
            for (const entry of CONTENT_MANIFEST) {
              slices[entry.key] = JSON.parse(
                readFileSync(resolve(root, entry.fileName), "utf8"),
              );
            }
            sendJson(res, 200, { slices });
            return;
          }
          if (req.method === "PUT") {
            let slices: RawContentSlices;
            try {
              const parsed: unknown = JSON.parse(await readBody(req));
              slices = (parsed as { slices: RawContentSlices }).slices;
              if (slices === null || typeof slices !== "object") {
                throw new Error("missing slices");
              }
            } catch {
              sendJson(res, 400, { error: "Body must be JSON: { slices: { <sliceKey>: ... } }" });
              return;
            }
            const { catalog, issues } = parseContentCatalog(slices);
            if (catalog === null) {
              sendJson(res, 422, { issues });
              return;
            }
            const written: string[] = [];
            for (const entry of CONTENT_MANIFEST) {
              const filePath = resolve(root, entry.fileName);
              const next = serializeContentSlice(slices[entry.key]);
              const current = existsSync(filePath) ? readFileSync(filePath, "utf8") : "";
              if (next !== current) {
                writeFileSync(filePath, next, "utf8");
                written.push(entry.fileName);
              }
            }
            sendJson(res, 200, { written });
            return;
          }
          res.setHeader("Allow", "GET, PUT");
          sendJson(res, 405, { error: "Method not allowed" });
        })().catch((e: unknown) => {
          sendJson(res, 500, { error: String(e) });
        });
      });
    },
  };
}

export default defineConfig({
  root: ".",
  publicDir: "public",
  plugins: [contentEditorPlugin()],
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});

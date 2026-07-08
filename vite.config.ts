import { readFileSync, writeFileSync, existsSync } from "node:fs";
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

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolvePromise(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
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
 * `apply: "serve"` keeps this out of production builds entirely.
 */
function contentEditorPlugin(): Plugin {
  return {
    name: "mastermind-content-editor-api",
    apply: "serve",
    configureServer(server) {
      const root = server.config.root;
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

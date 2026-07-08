/**
 * Card-art form field: path input + live preview + WebP upload + picker of
 * previously uploaded files. Async results (upload, list, animation sniff)
 * mutate the already-rendered DOM directly instead of forcing a re-render;
 * committing a path goes through `ctx.update` like any other field.
 */
import { fetchArtList, uploadArt, type ArtFileEntry } from "./api";
import { MAX_ART_BYTES, isWebpBytes, sanitizeArtFileName, webpHasAnimation } from "./artFiles";
import type { FormCtx } from "./forms/context";
import { el, formRow, setOrDelete, str, textInput } from "./widgets";

/** One fetch per editor session; invalidated after every successful upload. */
let artListCache: Promise<ArtFileEntry[]> | null = null;

function artList(): Promise<ArtFileEntry[]> {
  artListCache ??= fetchArtList().catch((e: unknown) => {
    artListCache = null;
    throw e;
  });
  return artListCache;
}

/** Animation sniffs by path, so re-renders don't refetch the same image. */
const animatedByPath = new Map<string, boolean>();

async function sniffAnimated(path: string): Promise<boolean> {
  const cached = animatedByPath.get(path);
  if (cached !== undefined) {
    return cached;
  }
  const res = await fetch(path);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  const animated = isWebpBytes(bytes) && webpHasAnimation(bytes);
  animatedByPath.set(path, animated);
  return animated;
}

function renderPreview(box: HTMLElement, path: string): void {
  box.innerHTML = "";
  if (path === "") {
    box.appendChild(el("span", "ed-hint", "no art — default placeholder is used in game"));
    return;
  }
  const img = el("img", "ed-art-preview");
  img.src = path;
  img.alt = "";
  const badge = el("span", "ed-art-badge", "…");
  img.addEventListener("error", () => {
    badge.textContent = "file not found";
    badge.classList.add("ed-art-badge--err");
  });
  box.append(img, badge);
  if (path.toLowerCase().endsWith(".webp")) {
    sniffAnimated(path).then(
      (animated) => {
        badge.textContent = animated ? "animated ✓" : "static webp";
      },
      () => {
        badge.textContent = "file not found";
        badge.classList.add("ed-art-badge--err");
      },
    );
  } else {
    badge.textContent = "";
  }
}

/**
 * A `formRow` for a string art-path field (`cardArt` / `profilePic`).
 * `optional: true` deletes the key when cleared; `suggestedName` seeds the
 * upload filename (e.g. `minion-<id>`).
 */
export function artFieldRow(
  ctx: FormCtx,
  key: string,
  opts: { optional: boolean; suggestedName: string },
): HTMLElement {
  const current = str(ctx.row, key);
  const commit = (v: string): void => {
    ctx.update((row) => {
      setOrDelete(row, key, v, opts.optional);
    });
  };

  const wrap = el("div", "ed-art-field");
  const previewBox = el("div", "ed-art-preview-box");
  renderPreview(previewBox, current);
  wrap.appendChild(previewBox);

  wrap.appendChild(
    textInput(current, commit, opts.optional ? "/assets/… (optional)" : "/assets/…"),
  );

  const controls = el("div", "ed-art-controls");
  const status = el("span", "ed-hint", "");

  /* Upload: hidden file input, name prompt, client-side preflight, POST. */
  const fileInput = el("input");
  fileInput.type = "file";
  fileInput.accept = ".webp,image/webp";
  fileInput.style.display = "none";
  const uploadBtn = el("button", "ed-btn-small", "Upload .webp…");
  uploadBtn.type = "button";
  uploadBtn.addEventListener("click", () => {
    fileInput.click();
  });
  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    fileInput.value = "";
    if (file === undefined) {
      return;
    }
    void (async () => {
      if (file.size > MAX_ART_BYTES) {
        status.textContent = `Too large (max ${MAX_ART_BYTES / (1024 * 1024)} MB).`;
        return;
      }
      const bytes = await file.arrayBuffer();
      if (!isWebpBytes(new Uint8Array(bytes))) {
        status.textContent = "Not a WebP file — export as .webp and retry.";
        return;
      }
      const suggested =
        sanitizeArtFileName(opts.suggestedName) ?? sanitizeArtFileName(file.name) ?? "art";
      const entered = window.prompt("File name for the upload (saved as <name>.webp):", suggested);
      if (entered === null) {
        return;
      }
      const name = sanitizeArtFileName(entered);
      if (name === null) {
        status.textContent = "Name must contain letters or digits.";
        return;
      }
      status.textContent = "Uploading…";
      let result = await uploadArt(name, bytes, false);
      if (!result.ok && result.status === 409) {
        if (!window.confirm(`${name}.webp already exists. Overwrite it?`)) {
          status.textContent = "Upload cancelled.";
          return;
        }
        result = await uploadArt(name, bytes, true);
      }
      if (!result.ok) {
        status.textContent = `Upload failed: ${result.error}`;
        return;
      }
      artListCache = null;
      animatedByPath.delete(result.path);
      commit(result.path); /* re-renders the form; preview shows the new file */
    })().catch((e: unknown) => {
      status.textContent = `Upload failed: ${String(e)}`;
    });
  });
  controls.append(uploadBtn, fileInput);

  /* Picker over previously uploaded files (populated async into the live node). */
  const picker = el("select");
  picker.classList.add("ed-art-picker");
  picker.appendChild(new Option("(choose uploaded art…)", ""));
  artList().then(
    (files) => {
      for (const f of files) {
        picker.appendChild(new Option(`${f.name}${f.animated ? " ⏵" : ""}`, f.path));
      }
      picker.value = files.some((f) => f.path === current) ? current : "";
    },
    () => {
      picker.disabled = true;
    },
  );
  picker.addEventListener("change", () => {
    if (picker.value !== "") {
      commit(picker.value);
    }
  });
  controls.appendChild(picker);
  controls.appendChild(status);
  wrap.appendChild(controls);

  return formRow(key, wrap);
}

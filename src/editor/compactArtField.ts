/**
 * Compact-portrait field: crop a square out of a row's card art, bake it, upload it as its own
 * file through the ordinary art endpoint.
 *
 * The game never crops at draw time — `compactArt` is a plain second URL that rides the same
 * paths `cardArt` does (see `ui/cardArt.ts`). All of the cropping happens here, once, and what
 * leaves is an ordinary `.webp`. That is also why the field takes no upload of its own: the
 * face is *derived* from the portrait above it, which is what stops the two drifting apart when
 * the portrait is redrawn.
 */
import { invalidateArtCaches } from "./artField";
import { uploadArt } from "./api";
import { ART_URL_PREFIX, sanitizeArtFileName } from "./artFiles";
import type { FormCtx } from "./forms/context";
import {
  COMPACT_ART_QUALITY,
  COMPACT_ART_SIZE,
  clampCropSquare,
  defaultCropSquare,
  fromPortraitCrop,
  isUsablePortraitCrop,
  toPortraitCrop,
  type CropSquare,
} from "./portraitCrop";
import type { PortraitCrop } from "../game/types";
import { el, formRow, hint, setOrDelete, str, textInput } from "./widgets";

/**
 * Freshly baked faces by path, so the preview after a re-bake shows what was just cut rather
 * than whatever the browser still holds cached under that same URL. Session-scoped; a reload
 * refetches and gets the new bytes anyway.
 */
const bakedPreviewUrls = new Map<string, string>();

/** Crops `img` to `sq` and re-encodes it as a square WebP at {@link COMPACT_ART_SIZE}. */
async function bakeCompactArt(img: HTMLImageElement, sq: CropSquare): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = COMPACT_ART_SIZE;
  canvas.height = COMPACT_ART_SIZE;
  const c2d = canvas.getContext("2d");
  if (c2d === null) {
    throw new Error("no 2d canvas context");
  }
  c2d.imageSmoothingEnabled = true;
  c2d.imageSmoothingQuality = "high";
  c2d.drawImage(img, sq.x, sq.y, sq.side, sq.side, 0, 0, COMPACT_ART_SIZE, COMPACT_ART_SIZE);
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, "image/webp", COMPACT_ART_QUALITY);
  });
  if (blob === null) {
    throw new Error("canvas could not encode WebP");
  }
  return blob;
}

type CropStage = {
  root: HTMLElement;
  /** The image and box to bake, or null while the portrait is still loading or failed to. */
  picked(): { img: HTMLImageElement; sq: CropSquare } | null;
};

/**
 * The crop stage: the portrait at whatever width the panel gives it, with a square box over it
 * that drags to move and pulls by its corner to resize.
 *
 * Everything the box knows is kept in *source* pixels and projected through one scale factor,
 * so the box means the same thing however large the image happens to be displayed — and so the
 * rect that gets stored does not depend on the width of the editor panel it was dragged in.
 *
 * `onChange` fires whenever the box settles, so the caller can keep the bake button and the
 * size readout in step with it.
 */
function buildCropStage(
  sourceUrl: string,
  initial: PortraitCrop | null,
  onChange: (sq: CropSquare | null) => void,
): CropStage {
  const root = el("div", "ed-crop");
  const img = el("img", "ed-crop__img");
  img.alt = "";
  img.draggable = false;
  const box = el("div", "ed-crop__box");
  const handle = el("div", "ed-crop__handle");
  box.appendChild(handle);
  root.append(img, box);

  let sq: CropSquare | null = null;
  /** Displayed px per source px; 0 until the image has loaded and been laid out. */
  let scale = 0;

  function paint(): void {
    if (sq === null || scale === 0) {
      box.style.display = "none";
      return;
    }
    box.style.display = "block";
    box.style.left = `${sq.x * scale}px`;
    box.style.top = `${sq.y * scale}px`;
    box.style.width = `${sq.side * scale}px`;
    box.style.height = `${sq.side * scale}px`;
  }

  function commit(next: CropSquare): void {
    sq = clampCropSquare(next, img.naturalWidth, img.naturalHeight);
    paint();
    onChange(sq);
  }

  img.addEventListener("load", () => {
    scale = img.clientWidth / img.naturalWidth;
    sq =
      initial !== null
        ? fromPortraitCrop(initial, img.naturalWidth, img.naturalHeight)
        : defaultCropSquare(img.naturalWidth, img.naturalHeight);
    paint();
    onChange(sq);
  });
  img.addEventListener("error", () => {
    root.appendChild(el("span", "ed-art-badge ed-art-badge--err", "portrait not found"));
    onChange(null);
  });
  img.src = sourceUrl;

  /*
   * One pointer gesture with two meanings: the corner handle resizes, anywhere else moves. Both
   * are measured against the box as it stood when the gesture began rather than against the
   * previous frame, so a long drag does not accumulate rounding.
   *
   * Pointer capture on the element that was grabbed, so a fast drag that outruns the pointer —
   * or leaves the panel entirely — keeps feeding the same handler instead of dropping the box
   * wherever the cursor happened to exit.
   */
  function beginDrag(e: PointerEvent, mode: "move" | "resize"): void {
    if (sq === null || scale === 0) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    const start = { ...sq };
    const originX = e.clientX;
    const originY = e.clientY;
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);

    const onMove = (ev: PointerEvent): void => {
      const dx = (ev.clientX - originX) / scale;
      const dy = (ev.clientY - originY) / scale;
      if (mode === "move") {
        commit({ ...start, x: start.x + dx, y: start.y + dy });
      } else {
        /* A diagonal pull follows whichever axis it went further along, so the square does not
         * fight itself trying to honour both at once. */
        commit({ ...start, side: start.side + Math.max(dx, dy) });
      }
    };
    const onUp = (): void => {
      target.releasePointerCapture(e.pointerId);
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerup", onUp);
      target.removeEventListener("pointercancel", onUp);
    };
    target.addEventListener("pointermove", onMove);
    target.addEventListener("pointerup", onUp);
    target.addEventListener("pointercancel", onUp);
  }

  box.addEventListener("pointerdown", (e) => {
    beginDrag(e, "move");
  });
  handle.addEventListener("pointerdown", (e) => {
    beginDrag(e, "resize");
  });

  return {
    root,
    picked: () => (sq === null || img.naturalWidth === 0 ? null : { img, sq }),
  };
}

/**
 * A `formRow` for `compactArt` — the face-framed square the small boxes in game use.
 *
 * `sourceKey` names the field the face is cut from (`cardArt`), `cropKey` the field the box is
 * remembered in (`compactCrop`). A path can still be typed straight in, for a face cut
 * somewhere else; clearing the field takes the remembered box with it, since a box pointing at
 * a file that is no longer referenced is just stale bookkeeping in the content file.
 *
 * `note` goes *inside* the field rather than being appended to the returned row by the caller:
 * `.ed-form-row` is a two-column grid, so a third child lands back under the label in the 170px
 * column and wraps to a ribbon.
 */
export function compactArtFieldRow(
  ctx: FormCtx,
  opts: {
    key: string;
    sourceKey: string;
    cropKey: string;
    suggestedName: string;
    note: string;
  },
): HTMLElement {
  const current = str(ctx.row, opts.key);
  const sourceUrl = str(ctx.row, opts.sourceKey);
  const storedCrop: unknown = ctx.row[opts.cropKey];

  const wrap = el("div", "ed-art-field");

  /* Shown in the box shape the game draws it in, and preferring a just-baked blob over the URL
   * the browser has cached — a re-bake writes the same path, so the cached copy is the old face. */
  const previewBox = el("div", "ed-art-preview-box");
  if (current === "") {
    previewBox.appendChild(
      el("span", "ed-hint", "no face crop — small boxes fall back to the full portrait"),
    );
  } else {
    const preview = el("img", "ed-art-preview ed-art-preview--compact");
    preview.src = bakedPreviewUrls.get(current) ?? current;
    preview.alt = "";
    const badge = el("span", "ed-art-badge", "");
    preview.addEventListener("error", () => {
      badge.textContent = "file not found";
      badge.classList.add("ed-art-badge--err");
    });
    previewBox.append(preview, badge);
  }
  wrap.appendChild(previewBox);

  wrap.appendChild(
    textInput(
      current,
      (v) => {
        ctx.update((row) => {
          setOrDelete(row, opts.key, v, true);
        });
      },
      "/assets/… (optional)",
    ),
  );

  const controls = el("div", "ed-art-controls");
  const status = el("span", "ed-hint", "");
  const cropBtn = el("button", "ed-btn-small", current === "" ? "Crop a face…" : "Re-crop…");
  cropBtn.type = "button";
  const clearBtn = el("button", "ed-btn-small", "Clear");
  clearBtn.type = "button";
  clearBtn.disabled = current === "";
  clearBtn.addEventListener("click", () => {
    ctx.update((row) => {
      setOrDelete(row, opts.key, "", true);
      setOrDelete(row, opts.cropKey, "", true);
    });
  });
  controls.append(cropBtn, clearBtn, status);
  wrap.appendChild(controls);

  if (sourceUrl === "") {
    cropBtn.disabled = true;
    status.textContent = "Set the portrait above first — the face is cut from it.";
    wrap.appendChild(hint(opts.note));
    return formRow(opts.key, wrap);
  }

  const bakeRow = el("div", "ed-art-controls");
  bakeRow.style.display = "none";
  const bakeBtn = el("button", "ed-btn-small", "Bake & upload");
  bakeBtn.type = "button";
  bakeBtn.disabled = true;
  const readout = el("span", "ed-hint", "");
  bakeRow.append(bakeBtn, readout);
  wrap.appendChild(bakeRow);

  /* Built on demand and torn down on close, so the form does not hold a second full-size
   * portrait in the DOM for every row the designer merely clicks past. */
  let stage: CropStage | null = null;
  cropBtn.addEventListener("click", () => {
    if (stage !== null) {
      stage.root.remove();
      stage = null;
      cropBtn.textContent = current === "" ? "Crop a face…" : "Re-crop…";
      bakeRow.style.display = "none";
      return;
    }
    cropBtn.textContent = "Close crop";
    bakeRow.style.display = "flex";
    stage = buildCropStage(
      sourceUrl,
      isUsablePortraitCrop(storedCrop) ? storedCrop : null,
      (sq) => {
        bakeBtn.disabled = sq === null;
        readout.textContent =
          sq === null ? "" : `${Math.round(sq.side)}px square → ${COMPACT_ART_SIZE}px`;
      },
    );
    wrap.insertBefore(stage.root, bakeRow);
  });

  bakeBtn.addEventListener("click", () => {
    const picked = stage?.picked() ?? null;
    if (picked === null) {
      return;
    }
    void (async () => {
      status.textContent = "Baking…";
      const blob = await bakeCompactArt(picked.img, picked.sq);
      const bytes = await blob.arrayBuffer();
      const name = sanitizeArtFileName(`${opts.suggestedName}-face`);
      if (name === null) {
        status.textContent = "Could not build a file name from this row.";
        return;
      }
      /* Overwriting is the normal case: a re-bake replaces this row's own face, and asking
       * every time would make adjusting a crop a three-click job. An existing file that is
       * *not* the one this row already points at still gets the confirm. */
      const ownFile = current === `${ART_URL_PREFIX}${name}.webp`;
      let result = await uploadArt(name, bytes, ownFile);
      if (!result.ok && result.status === 409) {
        if (!window.confirm(`${name}.webp already exists. Overwrite it?`)) {
          status.textContent = "Bake cancelled.";
          return;
        }
        result = await uploadArt(name, bytes, true);
      }
      if (!result.ok) {
        status.textContent = `Upload failed: ${result.error}`;
        return;
      }
      invalidateArtCaches(result.path);
      const stale = bakedPreviewUrls.get(result.path);
      if (stale !== undefined) {
        URL.revokeObjectURL(stale);
      }
      bakedPreviewUrls.set(result.path, URL.createObjectURL(blob));
      const crop = toPortraitCrop(picked.sq, picked.img.naturalWidth, picked.img.naturalHeight);
      const path = result.path;
      ctx.update((row) => {
        row[opts.key] = path;
        row[opts.cropKey] = crop;
      }); /* re-renders the form; the preview picks up the blob just baked */
    })().catch((e: unknown) => {
      status.textContent = `Bake failed: ${String(e)}`;
    });
  });

  wrap.appendChild(hint(opts.note));
  return formRow(opts.key, wrap);
}

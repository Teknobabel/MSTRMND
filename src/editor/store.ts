import {
  parseContentCatalog,
  type ContentIssue,
  type RawContentSlices,
} from "../game/contentSchema";
import type { ContentCatalog } from "../game/types";

const DRAFT_STORAGE_KEY = "mastermind-editor-draft-v1";
const MAX_UNDO_DEPTH = 50;

export type EditorStore = {
  readonly draft: RawContentSlices;
  readonly issues: ContentIssue[];
  /** Parsed catalog when the draft is fully valid, else null (drives refs/preview tools). */
  readonly catalog: ContentCatalog | null;
  readonly dirty: boolean;
  readonly canUndo: boolean;
  /** Snapshot, mutate the draft in place, revalidate, notify. */
  update(mutate: (draft: RawContentSlices) => void): void;
  /** Swap in a whole new draft (e.g. id rename), with undo. */
  replaceDraft(next: RawContentSlices): void;
  undo(): void;
  markSaved(): void;
  subscribe(listener: () => void): void;
};

export function loadPersistedDraft(): RawContentSlices | null {
  try {
    const text = localStorage.getItem(DRAFT_STORAGE_KEY);
    if (text === null) {
      return null;
    }
    return JSON.parse(text) as RawContentSlices;
  } catch {
    return null;
  }
}

export function clearPersistedDraft(): void {
  localStorage.removeItem(DRAFT_STORAGE_KEY);
}

export function createStore(
  initial: RawContentSlices,
  opts?: { startDirty?: boolean },
): EditorStore {
  let draft = structuredClone(initial);
  let issues: ContentIssue[] = [];
  let catalog: ContentCatalog | null = null;
  let dirty = opts?.startDirty === true;
  const undoStack: RawContentSlices[] = [];
  const listeners: (() => void)[] = [];
  let persistTimer: number | undefined;

  function validate(): void {
    const result = parseContentCatalog(draft);
    issues = result.issues;
    catalog = result.catalog;
  }

  function persistSoon(): void {
    clearTimeout(persistTimer);
    persistTimer = window.setTimeout(() => {
      try {
        if (dirty) {
          localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft));
        } else {
          clearPersistedDraft();
        }
      } catch {
        /* storage full/unavailable — drafts are still in memory */
      }
    }, 400);
  }

  function emit(): void {
    persistSoon();
    for (const l of listeners) {
      l();
    }
  }

  function pushUndo(): void {
    undoStack.push(structuredClone(draft));
    if (undoStack.length > MAX_UNDO_DEPTH) {
      undoStack.shift();
    }
  }

  validate();

  return {
    get draft() {
      return draft;
    },
    get issues() {
      return issues;
    },
    get catalog() {
      return catalog;
    },
    get dirty() {
      return dirty;
    },
    get canUndo() {
      return undoStack.length > 0;
    },
    update(mutate) {
      pushUndo();
      mutate(draft);
      dirty = true;
      validate();
      emit();
    },
    replaceDraft(next) {
      pushUndo();
      draft = structuredClone(next);
      dirty = true;
      validate();
      emit();
    },
    undo() {
      const prev = undoStack.pop();
      if (prev === undefined) {
        return;
      }
      draft = prev;
      dirty = true;
      validate();
      emit();
    },
    markSaved() {
      dirty = false;
      clearPersistedDraft();
      emit();
    },
    subscribe(listener) {
      listeners.push(listener);
    },
  };
}

/** Small DOM helpers + shared form widgets for the editor. Inputs commit on `change`
 * (blur/enter), not per keystroke, so the immediate-mode re-render never steals focus. */

export type Row = Record<string, unknown>;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== undefined && className !== "") {
    node.className = className;
  }
  if (text !== undefined) {
    node.textContent = text;
  }
  return node;
}

export function formRow(label: string, ...inputs: (HTMLElement | Text)[]): HTMLElement {
  const row = el("div", "ed-form-row");
  const lab = el("label", "", label);
  row.appendChild(lab);
  const holder = el("div");
  for (const i of inputs) {
    holder.appendChild(i);
  }
  row.appendChild(holder);
  return row;
}

export function textInput(
  value: string,
  onCommit: (v: string) => void,
  placeholder = "",
): HTMLInputElement {
  const input = el("input");
  input.type = "text";
  input.value = value;
  input.placeholder = placeholder;
  input.addEventListener("change", () => {
    onCommit(input.value);
  });
  return input;
}

export function textArea(value: string, onCommit: (v: string) => void): HTMLTextAreaElement {
  const input = el("textarea");
  input.value = value;
  input.addEventListener("change", () => {
    onCommit(input.value);
  });
  return input;
}

export function numberInput(
  value: number,
  onCommit: (v: number) => void,
  opts?: { min?: number; max?: number },
): HTMLInputElement {
  const input = el("input");
  input.type = "number";
  if (opts?.min !== undefined) {
    input.min = String(opts.min);
  }
  if (opts?.max !== undefined) {
    input.max = String(opts.max);
  }
  input.value = String(value);
  input.addEventListener("change", () => {
    const n = Number(input.value);
    if (Number.isFinite(n)) {
      onCommit(n);
    }
  });
  return input;
}

export type SelectOption = { value: string; label: string; disabled?: boolean };

export function selectInput(
  options: SelectOption[],
  value: string,
  onCommit: (v: string) => void,
): HTMLSelectElement {
  const sel = el("select");
  for (const o of options) {
    const opt = el("option");
    opt.value = o.value;
    opt.textContent = o.label;
    if (o.disabled === true) {
      opt.disabled = true;
    }
    sel.appendChild(opt);
  }
  /* Keep an unknown current value visible instead of silently snapping to the first option. */
  if (value !== "" && !options.some((o) => o.value === value)) {
    const opt = el("option");
    opt.value = value;
    opt.textContent = `${value} (unknown)`;
    sel.appendChild(opt);
  }
  sel.value = value;
  sel.addEventListener("change", () => {
    onCommit(sel.value);
  });
  return sel;
}

/** Options for an id picker over a slice, labeled `id — name` when a name exists. */
export function idOptions(
  ids: string[],
  namesById?: ReadonlyMap<string, string>,
): SelectOption[] {
  return ids.map((id) => {
    const name = namesById?.get(id);
    return { value: id, label: name !== undefined ? `${id} — ${name}` : id };
  });
}

/**
 * Ordered list editor: one row per item with remove / move up / move down, plus an Add
 * button. `makeRowInput` renders the value editor for one item.
 */
export function listEditor<T>(
  items: readonly T[],
  onCommit: (next: T[]) => void,
  makeRowInput: (item: T, replace: (v: T) => void) => HTMLElement,
  makeNewItem: () => T | null,
  addLabel = "+ Add",
): HTMLElement {
  const wrap = el("div", "ed-list");
  items.forEach((item, i) => {
    const row = el("div", "ed-list-row");
    row.appendChild(
      makeRowInput(item, (v) => {
        const next = [...items];
        next[i] = v;
        onCommit(next);
      }),
    );
    const up = el("button", "ed-btn-small", "↑");
    up.type = "button";
    up.disabled = i === 0;
    up.addEventListener("click", () => {
      const next = [...items];
      [next[i - 1], next[i]] = [next[i]!, next[i - 1]!];
      onCommit(next);
    });
    const down = el("button", "ed-btn-small", "↓");
    down.type = "button";
    down.disabled = i === items.length - 1;
    down.addEventListener("click", () => {
      const next = [...items];
      [next[i], next[i + 1]] = [next[i + 1]!, next[i]!];
      onCommit(next);
    });
    const rm = el("button", "ed-btn-small ed-btn-danger", "×");
    rm.type = "button";
    rm.addEventListener("click", () => {
      onCommit(items.filter((_, j) => j !== i));
    });
    row.append(up, down, rm);
    wrap.appendChild(row);
  });
  const add = el("button", "ed-btn-small", addLabel);
  add.type = "button";
  add.addEventListener("click", () => {
    const item = makeNewItem();
    if (item !== null) {
      onCommit([...items, item]);
    }
  });
  wrap.appendChild(add);
  return wrap;
}

export function hint(text: string): HTMLElement {
  return el("p", "ed-hint", text);
}

export function fieldset(legend: string, ...children: HTMLElement[]): HTMLFieldSetElement {
  const fs = el("fieldset", "ed-fieldset");
  const leg = el("legend", "", legend);
  fs.appendChild(leg);
  for (const c of children) {
    fs.appendChild(c);
  }
  return fs;
}

/* ---------- Safe raw-row accessors (draft rows are unvalidated JSON) ---------- */

export function str(row: Row, key: string): string {
  const v = row[key];
  return typeof v === "string" ? v : "";
}

export function num(row: Row, key: string, fallback = 0): number {
  const v = row[key];
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

export function strArray(row: Row, key: string): string[] {
  const v = row[key];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

export function rowArray(row: Row, key: string): Row[] {
  const v = row[key];
  return Array.isArray(v)
    ? v.filter((x): x is Row => x !== null && typeof x === "object")
    : [];
}

/** Set `row[key] = value`, deleting the key entirely for empty optional values. */
export function setOrDelete(row: Row, key: string, value: unknown, deleteWhenEmpty: boolean): void {
  const isEmpty =
    value === "" ||
    value === undefined ||
    (Array.isArray(value) && value.length === 0) ||
    (value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.keys(value as Row).length === 0);
  if (deleteWhenEmpty && isEmpty) {
    delete row[key];
  } else {
    row[key] = value;
  }
}

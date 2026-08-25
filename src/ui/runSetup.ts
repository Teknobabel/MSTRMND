import type { RunSetup } from "../game/gameState";
import type { ContentCatalog } from "../game/types";

/** Value of the "Random" option — no id can collide with it because ids are catalog-authored. */
const RANDOM_VALUE = "random";

export type RunSetupApi = {
  /** The title screen's current picks; a field is `null` when "Random" is selected. */
  read: () => RunSetup;
};

function req<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) {
    throw new Error(`Missing #${id}`);
  }
  return el as T;
}

/** Rebuilds a picker as "Random" plus one option per catalog entry, in catalog order. */
function fillOptions(
  select: HTMLSelectElement,
  entries: readonly { id: string; name: string }[],
): void {
  const random = document.createElement("option");
  random.value = RANDOM_VALUE;
  random.textContent = "Random";
  select.replaceChildren(random);
  for (const entry of entries) {
    const option = document.createElement("option");
    option.value = entry.id;
    option.textContent = entry.name;
    select.append(option);
  }
  select.value = RANDOM_VALUE;
}

function selectedId(select: HTMLSelectElement): string | null {
  return select.value === RANDOM_VALUE ? null : select.value;
}

/**
 * Wires the title screen's omega plan / lair pickers from the catalog. Both default to
 * **Random**, which leaves the roll to `createInitialGameState`.
 */
export function initRunSetup(catalog: ContentCatalog): RunSetupApi {
  const omegaPlanSelect = req<HTMLSelectElement>("select-omega-plan");
  const lairSelect = req<HTMLSelectElement>("select-lair");
  fillOptions(omegaPlanSelect, catalog.omegaPlans);
  fillOptions(lairSelect, catalog.lairs);

  return {
    read: () => ({
      omegaPlanId: selectedId(omegaPlanSelect),
      lairId: selectedId(lairSelect),
    }),
  };
}

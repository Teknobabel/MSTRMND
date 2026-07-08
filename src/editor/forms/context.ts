import type { ContentSliceKey, RawContentSlices } from "../../game/contentSchema";
import type { Row } from "../widgets";

/** Everything a slice form needs to render one entity and commit edits. */
export type FormCtx = {
  slice: ContentSliceKey;
  index: number;
  /** The entity's current raw row. Do not mutate directly — go through {@link update}. */
  row: Row;
  draft: RawContentSlices;
  /** Ids available in a slice (for pickers). */
  ids(slice: ContentSliceKey): string[];
  /** id → display name for a slice (for picker labels). */
  names(slice: ContentSliceKey): ReadonlyMap<string, string>;
  /** Snapshot + mutate this entity's row + revalidate + re-render. */
  update(mutate: (row: Row) => void): void;
};

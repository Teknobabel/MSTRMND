/**
 * The title screen: the run is configured on a mission planner, by dragging cards into it.
 *
 * Mission planning is the whole game — pick a play, drop the pieces it needs into the slots the
 * planner asks for, press Deploy. So starting a run is the same act at a smaller scale: three
 * slots (identity, lair, omega plan), a roster of cards filed under three tabs, and the same
 * Deploy button at the foot of the same column. By the time a player is looking at their first
 * turn they have already done the one thing the game will ask of them every turn after, and
 * nothing had to explain it to them.
 *
 * Everything here rides the run planner's own machinery rather than imitating it: `wireDropSlot`
 * lights the slots and takes the drops, `beginCardDrag` carries the payload, `addDragTokenFaces`
 * says what a card looks like in hand, and the slot rows are built from the same classes the run
 * planner's are (`.plan-slot-empty`, `.assign-pick-chip`). A card that behaves differently here
 * than it will in the run would be teaching the wrong lesson.
 *
 * **Random** is a card, not a checkbox. It sits at the head of each tab and is dragged in like
 * any other, so "let the game choose" is reached by the same gesture as every other choice and a
 * slot is never ambiguous about whether it has been answered. It is rolled on the way out of
 * `read`, over the unlocked cards only.
 *
 * **Locked cards** stay in the deck rather than being filtered out of it. A roster that grows
 * as you play is only legible if you can see what is still out there, so a locked dossier keeps
 * its art, its name and its stats behind a scrim and simply cannot be picked up — no drag, no
 * reticle, no keyboard route. What is open is decided by `game/progression.ts`, which this
 * module only ever reads; the deck is rebuilt whenever that answer changes, which is how the
 * Unlock All Content setting takes effect on a title screen that is already on screen.
 *
 * The markup shell is in `index.html`; the look is under "Title screen setup console" in
 * `styles.css`.
 */

import type { RunSetup } from "../game/gameState";
import type { ProgressionApi, UnlockView, UnlockableKind } from "../game/progression";
import type { ContentCatalog, LairTemplate, OmegaPlanTemplate, PlayerProfile } from "../game/types";
import {
  appendCardHeroOverlay,
  appendCardHeroShell,
  createCardArtImg,
  resolveLairCardArt,
  resolveOmegaPlanCardArt,
  resolveUnknownCardArt,
  DEFAULT_MINION_CARD_ART,
} from "./cardArt";
import { attachCardPreview, hideCardPreview } from "./cardPreview";
import { addDragTokenFaces, type DragTokenFace } from "./dragToken";
import {
  beginCardDrag,
  playLanding,
  setCardDragPayload,
  wireDropSlot,
  type DragPayloadKind,
} from "./dropHint";
import { setTooltip } from "./tooltip";

export type RunSetupApi = {
  /**
   * The title screen's answer for each slot. A staged Random card is rolled here, against the
   * unlocked pool only — so a field is `null` just when the slot was never answered at all, and
   * the run's own roll takes it from there.
   */
  read: () => RunSetup;
};

/** The three slots, in the order they run down the planner. */
type SetupSlotId = "identity" | "lair" | "omegaPlan";

/**
 * The card a slot holds. `null` is the Random card — a real pick, distinct from an empty slot,
 * which is `undefined` in {@link picks}.
 */
type SetupPick = string | null;

/** One card in the roster. `id` is `null` for the Random card at the head of each tab. */
interface SetupCard {
  id: SetupPick;
  name: string;
  art: string;
  /** The card's own prose; the Random card's says what rolling it means. */
  description: string;
  /** Labelled lines under the description — what this choice actually changes about the run. */
  stats: readonly { label: string; value: string }[];
  /** Not yet unlocked: shown, scrimmed, and inert. The Random card is never locked. */
  locked: boolean;
}

interface SetupSlotSpec {
  id: SetupSlotId;
  /** The drag payload kind, and the field it rides in. */
  kind: DragPayloadKind;
  /** Which unlockable kind this slot draws from; see `game/progression.ts`. */
  unlockKind: UnlockableKind;
  /** Tab label, slot tag, and the line an empty slot shows. */
  tab: string;
  tag: string;
  emptyHint: string;
  /** What a locked card in this tab says it is. */
  lockedNoun: string;
  /** Portrait art rather than the default 16:9 banner. */
  portrait: boolean;
  /** Rebuilt whenever the unlock view changes, so the tab is never stale. */
  cards: readonly SetupCard[];
}

const SLOT_ORDER: readonly SetupSlotId[] = ["identity", "lair", "omegaPlan"];

/** Where each slot's row is built, and which tab fills it. */
const SLOT_ELEMENT_ID: Record<SetupSlotId, string> = {
  identity: "setup-slot-identity",
  lair: "setup-slot-lair",
  omegaPlan: "setup-slot-omega-plan",
};

const ICON_LOCK =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10.5" width="14" height="10" rx="1.5"/><path d="M8.2 10.5V7.4a3.8 3.8 0 0 1 7.6 0v3.1"/></svg>';

const ICON_CROSSHAIR =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7"/><path d="M12 2v4m0 12v4M2 12h4m12 0h4"/></svg>';

function req<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) {
    throw new Error(`Missing #${id}`);
  }
  return el as T;
}

/** The payload a card hands over. One shape for all three; the kind is what tells them apart. */
function cardDragJson(kind: DragPayloadKind, id: SetupPick): string {
  return JSON.stringify({ kind, id });
}

/** Reads a payload back, or `undefined` when it is not this slot's. */
function parseSetupPayload(raw: string, kind: DragPayloadKind): SetupPick | undefined {
  try {
    const parsed = JSON.parse(raw) as { kind?: unknown; id?: unknown };
    if (parsed.kind !== kind) {
      return undefined;
    }
    if (parsed.id === null) {
      return null;
    }
    return typeof parsed.id === "string" ? parsed.id : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The Random card, at the head of every tab. It wears the same static an unscouted site does —
 * the console's own mark for something it cannot see yet, which is exactly what this is.
 */
function randomCard(what: string, unlockedCount: number): SetupCard {
  return {
    id: null,
    name: "Random",
    art: resolveUnknownCardArt(),
    description: `Leave the choice to the console. A ${what} is drawn when the run opens, and you find out which at the briefing.`,
    /*
     * The pool it draws from, not a flat "at deployment": Random only ever rolls dossiers the
     * player has open (see {@link rollUnlocked}), and saying how many says that — a player who
     * has unlocked three of eight can read straight off the card that the locked five are not
     * about to be handed to them by the console.
     */
    stats: [{ label: "Drawn From", value: `${unlockedCount} unlocked` }],
    locked: false,
  };
}

/**
 * Locked dossiers to the back of the tab, each group left in catalog order.
 *
 * Sorting rather than filtering: what is unlocked is the deck you are picking from and belongs
 * under the hand, while what is not is the reason to keep playing and belongs where it can be
 * browsed without getting in the way of the pick.
 */
function unlockedFirst(cards: SetupCard[]): SetupCard[] {
  return [...cards.filter((c) => !c.locked), ...cards.filter((c) => c.locked)];
}

/**
 * A mastermind's whole dossier is the portrait, the name, and the organization that name fronts —
 * the one thing picking a mastermind settles beyond the face on the warrant, so it is the one stat
 * row. A row reading "Alias: Victor Malice" under a card titled "Victor Malice" would be furniture
 * pretending to be information; the org name is not, because it is not on the card already.
 */
function identityCards(profiles: readonly PlayerProfile[], unlocked: UnlockView): SetupCard[] {
  const cards = unlockedFirst(
    profiles.map((p) => ({
      id: p.name,
      name: p.name,
      art: p.profilePic === "" ? DEFAULT_MINION_CARD_ART : p.profilePic,
      description: "The name on the broadcasts and the face on every warrant.",
      stats: [{ label: "Organization", value: p.organizationName }],
      locked: !unlocked.isUnlocked("mastermind", p.name),
    })),
  );
  return [randomCard("mastermind", unlocked.counts("mastermind").unlocked), ...cards];
}

function lairCards(lairs: readonly LairTemplate[], unlocked: UnlockView): SetupCard[] {
  const cards = unlockedFirst(
    lairs.map((lair) => ({
      id: lair.id,
      name: lair.name,
      art: resolveLairCardArt(lair),
      description: lair.description ?? "",
      stats: [
        { label: "Opening Missions", value: String(lair.availableMissionIds.length) },
        { label: "Upgrade Tiers", value: String(lair.upgradeLevels.length) },
      ],
      locked: !unlocked.isUnlocked("lair", lair.id),
    })),
  );
  return [randomCard("lair", unlocked.counts("lair").unlocked), ...cards];
}

function omegaPlanCards(
  plans: readonly OmegaPlanTemplate[],
  unlocked: UnlockView,
): SetupCard[] {
  const cards = unlockedFirst(
    plans.map((plan) => ({
      id: plan.id,
      name: plan.name,
      art: resolveOmegaPlanCardArt(plan),
      description: plan.description ?? "",
      stats: [
        { label: "Stages", value: String(plan.stages.length) },
        {
          label: "Missions Required",
          value: String(plan.stages.reduce((n, s) => n + s.requiredMissions, 0)),
        },
      ],
      locked: !unlocked.isUnlocked("omegaPlan", plan.id),
    })),
  );
  return [randomCard("plan", unlocked.counts("omegaPlan").unlocked), ...cards];
}

/**
 * Wires the title screen's planner from the catalog. Both panels are filled here; the shell they
 * are filled into is static markup in `index.html`.
 */
export function initRunSetup(catalog: ContentCatalog, progression: ProgressionApi): RunSetupApi {
  const specs: Record<SetupSlotId, SetupSlotSpec> = {
    identity: {
      id: "identity",
      kind: "mastermind-identity",
      unlockKind: "mastermind",
      tab: "Masterminds",
      tag: "Identity",
      emptyHint: "Drag a mastermind here",
      lockedNoun: "mastermind",
      portrait: true,
      cards: [],
    },
    lair: {
      id: "lair",
      kind: "mastermind-lair",
      unlockKind: "lair",
      tab: "Lairs",
      tag: "Lair",
      emptyHint: "Drag a lair here",
      lockedNoun: "lair",
      portrait: false,
      cards: [],
    },
    omegaPlan: {
      id: "omegaPlan",
      kind: "mastermind-omega-plan",
      unlockKind: "omegaPlan",
      tab: "Omega Plans",
      tag: "Omega Plan",
      emptyHint: "Drag an omega plan here",
      lockedNoun: "omega plan",
      portrait: false,
      cards: [],
    },
  };

  /** Re-read the unlock view onto the specs. Cheap; the whole deck is rebuilt after it. */
  function rebuildCards(): void {
    const unlocked = progression.view();
    specs.identity.cards = identityCards(catalog.playerProfiles, unlocked);
    specs.lair.cards = lairCards(catalog.lairs, unlocked);
    specs.omegaPlan.cards = omegaPlanCards(catalog.omegaPlans, unlocked);
  }

  rebuildCards();

  /** A slot with no entry has not been answered; an entry of `null` is a staged Random card. */
  const picks = new Map<SetupSlotId, SetupPick>();

  const btnDeploy = req<HTMLButtonElement>("btn-play");
  const deploySubmitWrap = req<HTMLElement>("setup-submit-wrap");
  const blockedAlertEl = req<HTMLElement>("setup-blocked-alert");
  const tabsEl = req<HTMLElement>("setup-deck-tabs");
  const pagesEl = req<HTMLElement>("setup-deck-pages");

  let activeTab: SetupSlotId = "identity";
  let blockedAlertTimer: ReturnType<typeof setTimeout> | null = null;

  function cardFor(slot: SetupSlotId, id: SetupPick): SetupCard | undefined {
    return specs[slot].cards.find((c) => c.id === id);
  }

  /* ---------------------------------------------------------------------------------------
   * Cards
   * ------------------------------------------------------------------------------------ */

  /**
   * A roster card's face, with none of the behaviour — so the same build serves the card in the
   * deck and the hover preview a staged chip floats beside itself, the way the run's cards do.
   */
  function fillCard(article: HTMLElement, spec: SetupSlotSpec, card: SetupCard): void {
    const { meta, body } = appendCardHeroShell(article, card.art);

    /* Over the art and under the name plate, so the picture reads as shut away while the name
     * stays legible — the same layering an unscouted site's comb uses. The badge goes in beside
     * the scrim rather than inside `meta`: `meta` is the bottom-anchored name plate, and a badge
     * parented to it would measure its `top` from there instead of from the top of the banner. */
    if (card.locked) {
      appendCardHeroOverlay(meta, "setup-card__lock-scrim");
      const badge = document.createElement("div");
      badge.className = "setup-card__lock-badge";
      badge.setAttribute("aria-hidden", "true");
      badge.innerHTML = ICON_LOCK;
      const word = document.createElement("span");
      word.textContent = "Restricted";
      badge.appendChild(word);
      meta.before(badge);
    }

    const title = document.createElement("h4");
    title.className = "asset-card-title";
    title.textContent = card.name;
    meta.appendChild(title);

    const desc = document.createElement("p");
    desc.className = "asset-card-description";
    desc.textContent = card.description;
    body.appendChild(desc);

    if (card.stats.length > 0) {
      const dl = document.createElement("dl");
      dl.className = "asset-card-stats";
      for (const stat of card.stats) {
        const dt = document.createElement("dt");
        dt.textContent = stat.label;
        const dd = document.createElement("dd");
        dd.textContent = stat.value;
        dl.append(dt, dd);
      }
      body.appendChild(dl);
    }
    /* Read off the spec rather than the slot, so a card built for the preview layer — where
     * there is no slot around it — still wears the right banner ratio. */
    if (spec.portrait) {
      article.classList.add("setup-card--portrait");
    }
    if (card.locked) {
      const note = document.createElement("p");
      note.className = "setup-card__lock-note";
      note.textContent = `Restricted — unlock this ${spec.lockedNoun} to bring it into a run.`;
      body.appendChild(note);
      article.classList.add("setup-card--locked");
    }
    if (card.id === null) {
      article.classList.add("setup-card--random");
    }
  }

  function buildCardArticle(spec: SetupSlotSpec, card: SetupCard, draggable: boolean): HTMLElement {
    const article = document.createElement("article");
    article.className = "asset-card setup-card";
    fillCard(article, spec, card);
    if (!draggable) {
      return article;
    }

    /*
     * A locked dossier is browsable and nothing else: no `draggable`, no drag payload, no
     * reticle. Every route into a slot goes through one of those three, so withholding them is
     * the whole of "not selectable" — there is no disabled state left over to police. The
     * tooltip is what a player who tried gets back, since the card itself cannot respond.
     */
    if (card.locked) {
      article.setAttribute("aria-disabled", "true");
      setTooltip(
        article,
        `${card.name} — Restricted`,
        `This ${spec.lockedNoun} is not unlocked yet. Unlock it to pick it, or turn on Unlock All Content in Settings.`,
      );
      return article;
    }

    const payload = (): string => cardDragJson(spec.kind, card.id);
    article.draggable = true;
    setCardDragPayload(article, payload);
    article.addEventListener("dragstart", (e) => {
      beginCardDrag(e, payload());
      e.dataTransfer!.effectAllowed = "copy";
    });

    /*
     * Dragging is the lesson, but it must not be the only way through: a keyboard, a screen
     * reader, or a player who simply has not worked the gesture out yet still has to be able to
     * start a run. The reticle stages the card exactly as a drop does, landing animation and
     * all — the same escape hatch the run's own cards carry.
     */
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "card-add-to-planner-btn";
    btn.setAttribute("aria-label", `Assign ${card.name} to the ${spec.tag} slot`);
    setTooltip(btn, "Add to Plan", `Assigns ${card.name}, the same way dragging the card there would.`);
    btn.innerHTML = ICON_CROSSHAIR;
    btn.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      stage(spec.id, card.id);
      playLanding(slotKey(spec.id));
    });
    article.appendChild(btn);
    return article;
  }

  /* ---------------------------------------------------------------------------------------
   * The planner column
   * ------------------------------------------------------------------------------------ */

  /** Unique across the planner: how `dropHint` finds a slot again once a drop re-rendered it. */
  function slotKey(slot: SetupSlotId): string {
    return `setup-${slot}`;
  }

  function createPlanSlotTag(text: string): HTMLElement {
    const tag = document.createElement("span");
    tag.className = "plan-slot-tag";
    tag.textContent = text;
    return tag;
  }

  /**
   * An empty slot: the reticle standing where the thumbnail will be, the slot's tag, and what to
   * drag into it. Clicking it brings the tab holding those cards forward — the one thing a player
   * stuck at an empty slot is looking for.
   */
  function fillEmptySlot(host: HTMLElement, spec: SetupSlotSpec): void {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "plan-slot-empty plan-slot-empty--opens";
    row.setAttribute(
      "aria-label",
      `${spec.tag} slot: ${spec.emptyHint}. Opens the ${spec.tab} dossiers.`,
    );
    setTooltip(row, `${spec.tag} Slot`, `${spec.emptyHint}. Click to open the ${spec.tab} dossiers.`);
    row.addEventListener("click", () => {
      setActiveTab(spec.id);
    });

    const ghost = document.createElement("span");
    ghost.className = "plan-slot-ghost";
    ghost.setAttribute("aria-hidden", "true");
    ghost.textContent = "+";
    row.appendChild(ghost);

    const main = document.createElement("div");
    main.className = "plan-slot-main";
    main.appendChild(createPlanSlotTag(spec.tag));
    const hint = document.createElement("span");
    hint.className = "assign-minion-slot-placeholder";
    hint.textContent = spec.emptyHint;
    main.appendChild(hint);
    row.appendChild(main);

    host.appendChild(row);
  }

  /** The collapsed form of a staged card: thumbnail, tag and name, with the card on hover. */
  function fillStagedSlot(host: HTMLElement, spec: SetupSlotSpec, card: SetupCard): void {
    const wrap = document.createElement("div");
    wrap.className = "assign-pick-slot-card-wrap";

    const chip = document.createElement("div");
    chip.className = "assign-pick-chip";
    chip.tabIndex = 0;
    chip.draggable = true;
    chip.addEventListener("dragstart", (e) => {
      beginCardDrag(e, cardDragJson(spec.kind, card.id));
      /* `move`, where a roster card carries `copy`: this one is already staged, so the drag is
       * a relocation, and the cursor should say so. It is also what the drag token reads to
       * decide between flying the card back and dropping it away. */
      e.dataTransfer!.effectAllowed = "move";
    });
    /*
     * Dragged off the planner and let go over nothing: the card is taken out of the slot. The
     * same gesture means the same thing in the run's planner, and the drag token has already
     * played the card dropping away by the time this runs — leaving the chip sitting there
     * would contradict the animation the player just watched.
     */
    chip.addEventListener("dragend", (e) => {
      if (e.dataTransfer?.dropEffect !== "none") {
        return;
      }
      picks.delete(spec.id);
      renderSlot(spec.id);
      syncDeployButton();
    });
    chip.appendChild(createCardArtImg(card.art, "card-art--chip"));

    const main = document.createElement("div");
    main.className = "plan-slot-main assign-pick-chip-main";
    main.appendChild(createPlanSlotTag(spec.tag));
    const name = document.createElement("span");
    name.className = "assign-pick-chip-label";
    name.textContent = card.name;
    main.appendChild(name);
    chip.appendChild(main);

    const preview = buildCardArticle(spec, card, false);
    preview.classList.add("assign-pick-preview-card");
    attachCardPreview(chip, preview);
    wrap.appendChild(chip);

    const clear = document.createElement("button");
    clear.type = "button";
    clear.className = "assign-pick-slot-clear";
    clear.setAttribute("aria-label", `Clear ${spec.tag.toLowerCase()}`);
    clear.textContent = "×";
    clear.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      picks.delete(spec.id);
      renderSlot(spec.id);
      syncDeployButton();
    });
    clear.addEventListener("mousedown", (ev) => {
      ev.stopPropagation();
    });
    wrap.appendChild(clear);

    host.appendChild(wrap);
  }

  function renderSlot(slot: SetupSlotId): void {
    hideCardPreview();
    const spec = specs[slot];
    const host = req<HTMLElement>(SLOT_ELEMENT_ID[slot]);
    host.replaceChildren();

    const inner = document.createElement("div");
    inner.className = "assign-pick-slot-inner";
    const staged = picks.has(slot) ? cardFor(slot, picks.get(slot)!) : undefined;
    if (staged === undefined) {
      fillEmptySlot(inner, spec);
    } else {
      fillStagedSlot(inner, spec, staged);
    }
    host.appendChild(inner);
  }

  /** Stages `id` in `slot`; false when the card is not one this slot knows, or is locked. */
  function stage(slot: SetupSlotId, id: SetupPick): boolean {
    const card = cardFor(slot, id);
    /* Locked is checked here rather than only at the card, because this is the one funnel every
     * route runs through — drop, reticle, and the re-stage a rebuild does. A pick that survived
     * a change to the unlock view is refused on exactly the same line as one that never had a
     * card to come from. */
    if (card === undefined || card.locked) {
      return false;
    }
    picks.set(slot, id);
    renderSlot(slot);
    syncDeployButton();
    return true;
  }

  /* ---------------------------------------------------------------------------------------
   * Deploy
   * ------------------------------------------------------------------------------------ */

  /** The slots still to be answered, top of the planner first. */
  function missingSlots(): SetupSlotSpec[] {
    return SLOT_ORDER.filter((slot) => !picks.has(slot)).map((slot) => specs[slot]);
  }

  function syncDeployButton(): void {
    const missing = missingSlots();
    const ready = missing.length === 0;
    btnDeploy.disabled = !ready;
    /* Same treatment the run planner's Submit wears once a plan will start: primary fill, the
     * pulse, and the sweep across its face. */
    btnDeploy.classList.toggle("btn-primary", ready);
    btnDeploy.classList.toggle("btn-submit-mission--ready", ready);
    setTooltip(
      btnDeploy,
      "Deploy",
      ready
        ? "Opens the run on the picks staged above."
        : `Fill the ${missing.map((s) => s.tag).join(", ")} slot${missing.length === 1 ? "" : "s"} first.`,
    );
  }

  /**
   * A click landed on Deploy while it was disabled. The button never sees it — a disabled
   * control eats the click — so the wrap behind it catches it (pointer events pass through the
   * disabled button, see `.btn-submit-mission:disabled`) and names what is still missing.
   * Clearing the text before re-setting it is what makes the live region re-announce a repeat.
   */
  function flashBlockedAlert(): void {
    const missing = missingSlots();
    if (missing.length === 0) {
      return;
    }
    if (blockedAlertTimer !== null) {
      clearTimeout(blockedAlertTimer);
    }
    blockedAlertEl.classList.remove("assign-blocked-alert--visible");
    blockedAlertEl.textContent = "";
    void blockedAlertEl.offsetWidth;
    blockedAlertEl.textContent = `No ${missing[0]!.tag} Assigned`;
    blockedAlertEl.classList.add("assign-blocked-alert--visible");
    blockedAlertTimer = setTimeout(() => {
      blockedAlertEl.classList.remove("assign-blocked-alert--visible");
      blockedAlertTimer = null;
    }, 1600);
  }

  /* ---------------------------------------------------------------------------------------
   * The roster panel
   * ------------------------------------------------------------------------------------ */

  const pageBySlot = new Map<SetupSlotId, HTMLElement>();

  function setActiveTab(slot: SetupSlotId): void {
    activeTab = slot;
    for (const id of SLOT_ORDER) {
      const page = pageBySlot.get(id);
      if (page !== undefined) {
        page.hidden = id !== slot;
      }
    }
    for (const tab of tabsEl.querySelectorAll<HTMLButtonElement>("[data-setup-tab]")) {
      const on = tab.dataset.setupTab === slot;
      tab.classList.toggle("missions-panel-tab--active", on);
      tab.setAttribute("aria-selected", on ? "true" : "false");
    }
  }

  function buildDeck(): void {
    tabsEl.replaceChildren();
    pagesEl.replaceChildren();
    for (const slot of SLOT_ORDER) {
      const spec = specs[slot];

      const tabId = `setup-tab-${slot}`;
      const pageId = `setup-page-${slot}`;

      const tab = document.createElement("button");
      tab.type = "button";
      tab.id = tabId;
      tab.className = "missions-panel-tab";
      tab.dataset.setupTab = slot;
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-controls", pageId);
      tab.replaceChildren(document.createTextNode(spec.tab));
      /* The ladder, stated where the deck is chosen from. Dropped once everything in the tab is
       * open — a counter reading 8/8 on every tab is noise, and on a finished collection the
       * absence of it is the reward. */
      const { unlocked, total } = progression.view().counts(spec.unlockKind);
      if (unlocked < total) {
        const count = document.createElement("span");
        count.className = "setup-deck__tab-count";
        count.textContent = `${unlocked}/${total}`;
        count.setAttribute(
          "aria-label",
          `${unlocked} of ${total} unlocked`,
        );
        tab.appendChild(count);
      }
      tab.addEventListener("click", () => {
        setActiveTab(slot);
      });
      tabsEl.appendChild(tab);

      const page = document.createElement("div");
      page.id = pageId;
      page.className = "setup-deck__page";
      page.setAttribute("role", "tabpanel");
      page.setAttribute("aria-labelledby", tabId);
      for (const card of spec.cards) {
        page.appendChild(buildCardArticle(spec, card, true));
      }
      pagesEl.appendChild(page);
      pageBySlot.set(slot, page);
    }
    setActiveTab(activeTab);
  }

  /* ---------------------------------------------------------------------------------------
   * Wiring
   * ------------------------------------------------------------------------------------ */

  for (const slot of SLOT_ORDER) {
    const spec = specs[slot];
    wireDropSlot(req<HTMLElement>(SLOT_ELEMENT_ID[slot]), {
      key: slotKey(slot),
      accepts: [spec.kind],
      canTake: (raw) => parseSetupPayload(raw, spec.kind) !== undefined,
      isFilled: () => picks.has(slot),
      onDrop: (raw) => {
        const id = parseSetupPayload(raw, spec.kind);
        return id !== undefined && stage(slot, id);
      },
    });
    renderSlot(slot);
  }

  /** What the title screen's cards look like in hand; the run controller registers its own. */
  addDragTokenFaces((raw): DragTokenFace | null => {
    for (const slot of SLOT_ORDER) {
      const spec = specs[slot];
      const id = parseSetupPayload(raw, spec.kind);
      if (id === undefined) {
        continue;
      }
      const card = cardFor(slot, id);
      return card === undefined ? null : { art: card.art, label: card.name };
    }
    return null;
  });

  /* Read off the button rather than off the event target: the label inside Deploy is what a
   * real click reports as its target, so "did this click miss the button" cannot be asked that
   * way. Disabled is the only state in which the wrap hears a click at all. */
  deploySubmitWrap.addEventListener("click", () => {
    if (btnDeploy.disabled) {
      flashBlockedAlert();
    }
  });

  /**
   * The unlock view moved — the setting was toggled, or something was earned. Rebuild the cards,
   * rebuild the deck around them, and drop any staged pick the new view no longer allows.
   *
   * Dropping rather than leaving it staged: turning Unlock All Content off with a locked plan in
   * the planner and then pressing Deploy would start a run on content the player does not have,
   * and a slot that says a thing is picked while the rules say it is not is the worse of the two
   * ways to be wrong. `stage` already refuses a locked card, so re-staging each pick through it
   * is both the test and the repair.
   */
  function onUnlocksChanged(): void {
    rebuildCards();
    for (const slot of SLOT_ORDER) {
      const pick = picks.get(slot);
      if (pick !== undefined) {
        picks.delete(slot);
        stage(slot, pick);
      }
      renderSlot(slot);
    }
    buildDeck();
    syncDeployButton();
  }

  progression.subscribe(onUnlocksChanged);

  /**
   * What a staged Random card resolves to: a uniform draw over this slot's **unlocked** cards.
   *
   * Rolled here rather than left to `createInitialGameState`'s own roll, which knows nothing
   * about unlocks and would happily hand the player a lair they have never seen. An empty pool
   * reads back as `null` and falls through to that roll, which is the right degenerate answer —
   * a slot with nothing in it is a content problem, not a reason to refuse to start.
   */
  function rollUnlocked(slot: SetupSlotId): string | null {
    const pool = specs[slot].cards.filter((c): c is SetupCard & { id: string } =>
      c.id !== null && !c.locked,
    );
    if (pool.length === 0) {
      return null;
    }
    return pool[Math.floor(Math.random() * pool.length)]!.id;
  }

  /** A slot's answer: the staged id, a roll for Random, `null` for a slot never answered. */
  function resolve(slot: SetupSlotId): string | null {
    const pick = picks.get(slot);
    if (pick === undefined) {
      return null;
    }
    return pick ?? rollUnlocked(slot);
  }

  buildDeck();
  syncDeployButton();

  return {
    read: (): RunSetup => ({
      omegaPlanId: resolve("omegaPlan"),
      lairId: resolve("lair"),
      playerProfileName: resolve("identity"),
    }),
  };
}

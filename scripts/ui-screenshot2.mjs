/**
 * Dev-only visual check for the end-of-turn report (mission results → turn summary).
 *
 * Requires a running `npm run dev` and `npm i --no-save playwright-core`. Drives a real
 * Chrome: hires a minion, plans a lair mission at a site, executes the plan, then shoots
 * every step of the report. Screenshots land in `.screens/`.
 *
 * Not part of the build; delete freely.
 */
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const URL = process.env.UI_URL ?? "http://localhost:5173/";
const OUT = ".screens";
const CHROME =
  process.env.CHROME_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

mkdirSync(OUT, { recursive: true });

/** Real dragstart → drop pair sharing one DataTransfer, so the app's own handlers fill it. */
const DND = ([sourceSel, targetSel, sourceIndex = 0]) => {
  const source = document.querySelectorAll(sourceSel)[sourceIndex];
  const target = document.querySelector(targetSel);
  if (!source || !target) {
    return `missing: ${source ? "" : sourceSel} ${target ? "" : targetSel}`;
  }
  const dataTransfer = new DataTransfer();
  source.dispatchEvent(new DragEvent("dragstart", { dataTransfer, bubbles: true }));
  target.dispatchEvent(
    new DragEvent("dragover", { dataTransfer, bubbles: true, cancelable: true }),
  );
  target.dispatchEvent(new DragEvent("drop", { dataTransfer, bubbles: true, cancelable: true }));
  source.dispatchEvent(new DragEvent("dragend", { dataTransfer, bubbles: true }));
  return `ok (${dataTransfer.getData("text/plain") || "no payload"})`;
};

const browser = await chromium.launch({ executablePath: CHROME });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
page.on("console", (m) => {
  if (m.type() === "error") {
    console.error("[page error]", m.text());
  }
});
page.on("pageerror", (e) => console.error("[page exception]", e.message));

await page.goto(URL, { waitUntil: "networkidle" });
await page.click("#btn-play");
await page.waitForTimeout(300);

const LAIR_CARDS = () =>
  [...document.querySelectorAll("#lair-panel article.asset-card")].map((card, index) => {
    const row = (label) => {
      const dt = [...card.querySelectorAll("dt")].find((d) => d.textContent === label);
      return dt?.nextElementSibling?.textContent ?? "";
    };
    return {
      index,
      name: card.querySelector(".asset-card-title")?.textContent ?? "",
      targetType: row("Target"),
      cost: Number.parseInt(row("Start cost"), 10),
      duration: row("Duration"),
    };
  });

const STATUS = () => ({
  cp:
    [...document.querySelectorAll("#game-stats .stat-block")]
      .find((b) => b.querySelector(".stat-block__label")?.textContent === "Command")
      ?.querySelector(".stat-block__value")?.textContent ?? "",
  roster: [...document.querySelectorAll("#minions-roster-list article.assign-draggable-minion")]
    .length,
  turn: document.querySelector("#game-hud-short")?.textContent ?? "",
});

async function hireIfAffordable() {
  const hire = page.locator("#minions-available-list button.minions-card-hire:not([disabled])");
  if ((await hire.count()) === 0) {
    return false;
  }
  await hire.first().click();
  await page.waitForTimeout(150);
  return true;
}

/** Plans lair mission at card `missionIndex` on location `locationIndex` with a free minion. */
async function planMission(missionIndex, locationIndex) {
  await page.evaluate(DND, [
    "#lair-panel article.asset-card",
    "#assign-mission-slot",
    missionIndex,
  ]);
  await page.waitForTimeout(120);
  await page.evaluate(DND, [
    "#locations-panel article.location-card",
    "#assign-target-slot",
    locationIndex,
  ]);
  await page.waitForTimeout(120);
  await page.evaluate(DND, [
    "#minions-roster-list article.assign-draggable-minion",
    "#assign-minions-list [data-slot-index='0']",
    0,
  ]);
  await page.waitForTimeout(120);
  const submit = page.locator("#btn-assign-mission");
  if (await submit.isDisabled()) {
    console.log("  submit blocked:", await submit.getAttribute("title"));
    return false;
  }
  await submit.click();
  await page.waitForTimeout(200);
  return true;
}

/** Pages the open report, shooting each step; clicks "Skip all" once when it is offered. */
async function walkReport(label) {
  await page.waitForSelector("#overlay-turn-report:not([hidden])");
  await page.waitForTimeout(250);
  let missionSteps = 0;
  let usedSkip = false;
  for (let step = 0; ; step += 1) {
    await page.screenshot({ path: `${OUT}/${label}-step${step}.png` });
    const kicker = (await page.textContent("#turn-report-kicker")) ?? "";
    const skipVisible = await page.locator("#btn-turn-report-skip").isVisible();
    console.log(`  ${label} step ${step}: ${kicker} (skip offered: ${skipVisible})`);
    const isSummary = kicker.startsWith("End of turn");
    if (!isSummary) {
      missionSteps += 1;
    }
    if (skipVisible && !usedSkip) {
      usedSkip = true;
      await page.click("#btn-turn-report-skip");
    } else {
      await page.click("#btn-turn-report-continue");
    }
    await page.waitForTimeout(200);
    if (isSummary) {
      break;
    }
  }
  console.log(
    `  ${label}: ${missionSteps} mission step(s), skip used: ${usedSkip}, closed: ${await page
      .locator("#overlay-turn-report")
      .isHidden()}`,
  );
  return { missionSteps, usedSkip };
}

/* Phase A — bank CP and recruits until two one-turn location missions are affordable. */
let planned = 0;
for (let turn = 1; turn <= 12 && planned < 2; turn += 1) {
  const status = await page.evaluate(STATUS);
  const cards = (await page.evaluate(LAIR_CARDS)).filter(
    (c) => c.duration === "1 turn" && c.targetType === "Location",
  );
  console.log(`turn ${turn}`, status, `one-turn location missions: ${cards.length}`);
  const cp = Number.parseInt(status.cp, 10);
  if (status.roster >= 2 && cards.length >= 2 && cp >= cards[0].cost + cards[1].cost) {
    console.log(`  planning ${cards[0].name} + ${cards[1].name}`);
    if (await planMission(cards[0].index, 0)) {
      planned += 1;
    }
    if (await planMission(cards[1].index, 1)) {
      planned += 1;
    }
    await page.screenshot({ path: `${OUT}/planned-two.png` });
  } else if (status.roster < 2) {
    await hireIfAffordable();
  }
  if (planned >= 2) {
    break;
  }
  await page.click("#btn-execute-plan");
  await walkReport(`warmup${turn}`);
}

/* Phase B — both one-turn missions resolve in the same execute: two cards, then the summary. */
console.log("planned this turn:", planned);
await page.click("#btn-execute-plan");
const result = await walkReport("multi");
console.log("multi-mission report:", result);

await browser.close();
console.log(`screens written to ${OUT}/`);

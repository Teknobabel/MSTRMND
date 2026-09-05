/**
 * Dev-only helper for placing `content/maps.json` markers on the world map art.
 *
 * Renders the art at its native size with each marker drawn on top and labelled, so the
 * placement can be checked by eye and nudged. Writes `.screens/map-calibrate.png` and prints the
 * `markers` array ready to paste into the map row.
 *
 * Requires `npm i --no-save playwright-core`. Not part of the build; delete freely.
 */
import { chromium } from "playwright-core";
import { readFileSync } from "node:fs";

const CHROME =
  process.env.CHROME_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const IMG = "public/assets/map/world-map.png";
const MAP_ID = "the_global_stage";

/* Sites are fictional; each sits on the region its description evokes. x/y are percentages of
 * the art box, hand-placed against the coastlines rather than projected from lat/lon — the art
 * is stylised and does not hold to a strict equirectangular grid. */
const MARKERS = [
  { locationId: "skywatch_station", place: "Alaska range", x: 11.2, y: 17.8 },
  { locationId: "harbor_armory", place: "US Pacific NW", x: 16.0, y: 29.2 },
  { locationId: "the_citadel", place: "Rocky Mountains", x: 19.6, y: 33.4 },
  { locationId: "world_assembly", place: "US Northeast", x: 27.0, y: 30.2 },
  { locationId: "aerodyne_campus", place: "Florida", x: 26.2, y: 40.4 },
  { locationId: "city_hall_annex", place: "Southeast Brazil", x: 32.4, y: 67.2 },
  { locationId: "broadcast_house", place: "British Isles", x: 45.4, y: 25.8 },
  { locationId: "meridian_bank", place: "Alps", x: 47.8, y: 29.8 },
  { locationId: "grand_embassy", place: "Eastern Europe", x: 53.4, y: 26.6 },
  { locationId: "fort_bastion", place: "North Africa", x: 51.4, y: 41.0 },
  { locationId: "sunstone_exchange", place: "Southern Africa", x: 55.2, y: 77.0 },
  { locationId: "records_bureau", place: "Indian subcontinent", x: 66.4, y: 50.5 },
  { locationId: "gilded_lotus", place: "South China coast", x: 78.4, y: 42.8 },
  { locationId: "dockside_freeport", place: "Malacca Strait", x: 76.0, y: 53.2 },
  { locationId: "southern_airfield", place: "Australian outback", x: 83.0, y: 76.0 },
];

const dataUrl = `data:image/png;base64,${readFileSync(IMG).toString("base64")}`;

const browser = await chromium.launch({ executablePath: CHROME });
const page = await browser.newPage({ viewport: { width: 1400, height: 800 } });

const { w, h } = await page.evaluate(async (src) => {
  const img = new Image();
  img.src = src;
  await img.decode();
  return { w: img.naturalWidth, h: img.naturalHeight };
}, dataUrl);

console.log(`native size: ${w}x${h}`);

await page.setContent(`
  <style>
    html, body { margin: 0; background: #000; }
    .wrap { position: relative; width: ${w}px; height: ${h}px; }
    .wrap img { width: 100%; height: 100%; display: block; }
    .pin { position: absolute; width: 11px; height: 11px; margin: -5.5px 0 0 -5.5px;
           border: 2px solid #00e5ff; border-radius: 50%; background: rgba(0,229,255,.35); }
    .pin b { position: absolute; left: 11px; top: -4px; color: #00e5ff; font: 10px monospace;
             white-space: nowrap; text-shadow: 0 0 3px #000, 0 0 3px #000; }
  </style>
  <div class="wrap">
    <img src="${dataUrl}" />
    ${MARKERS.map(
      (m) => `<div class="pin" style="left:${m.x}%;top:${m.y}%"><b>${m.place}</b></div>`,
    ).join("")}
  </div>
`);
await page.setViewportSize({ width: w, height: h });
await page.locator(".wrap").screenshot({ path: ".screens/map-calibrate.png" });
await browser.close();

console.log(`markers for map "${MAP_ID}":`);
console.log(
  JSON.stringify(
    MARKERS.map(({ locationId, x, y }) => ({ locationId, x, y })),
    null,
    2,
  ),
);
console.log("\noverlay written to .screens/map-calibrate.png");

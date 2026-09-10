import { chromium } from "playwright";

const browser = await chromium.launch({ args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
page.on("console", (msg) => console.log("[console]", msg.type(), msg.text()));
page.on("pageerror", (err) => console.log("[pageerror]", err.message));
await page.goto("http://localhost:5183", { waitUntil: "load" });
await page.waitForTimeout(1500);
await page.screenshot({ path: "screenshot-1-initial.png" });
console.log("TITLE", await page.title());
const buttons = await page.$$eval("button", (els) => els.slice(0, 40).map((e) => e.textContent?.trim()));
console.log("BUTTONS", JSON.stringify(buttons));
await browser.close();

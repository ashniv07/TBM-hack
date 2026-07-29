import puppeteer from "puppeteer-core";

const browser = await puppeteer.connect({ browserURL: "http://localhost:9333" });
const page = await browser.newPage();
await page.setCacheEnabled(false);
await page.setViewport({ width: 1906, height: 970 });
await page.goto("http://localhost:5173", { waitUntil: "networkidle0" });
await new Promise(r => setTimeout(r, 1000));

function clickText(t) {
  return page.evaluate((text) => {
    const el = Array.from(document.querySelectorAll("*")).find(el => el.textContent?.trim() === text && el.children.length === 0);
    el?.click();
  }, t);
}
function clickButtonText(t) {
  return page.evaluate((text) => {
    const btn = Array.from(document.querySelectorAll("button")).find(b => b.textContent?.trim() === text);
    btn?.click();
  }, t);
}

await clickText("Relationships");
await new Promise(r => setTimeout(r, 2500));

const entityCount = await page.evaluate(() => {
  const chip = Array.from(document.querySelectorAll(".stat-chip")).find(c => c.textContent?.includes("ENTITIES"));
  return chip?.querySelector(".stat-chip-value")?.textContent;
});
console.log("entity count on fresh load:", entityCount);

const consoleErrors = [];
page.on("console", msg => { if (msg.type() === "error") consoleErrors.push(msg.text()); });
page.on("pageerror", err => consoleErrors.push(String(err)));
await new Promise(r => setTimeout(r, 500));
console.log("console errors so far:", consoleErrors);

await clickButtonText("Graph View");
await new Promise(r => setTimeout(r, 1500));
await page.screenshot({ path: "_shotJ_overview.png" });
console.log("more console errors:", consoleErrors);

await browser.disconnect();

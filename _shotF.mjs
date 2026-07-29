import puppeteer from "puppeteer-core";

const browser = await puppeteer.connect({ browserURL: "http://localhost:9333" });
const page = await browser.newPage();
await page.setViewport({ width: 1906, height: 970 });
await page.goto("http://localhost:5173", { waitUntil: "networkidle0" });

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
await new Promise(r => setTimeout(r, 1500));
await clickButtonText("Graph View");
await new Promise(r => setTimeout(r, 1200));
await page.screenshot({ path: "_shotF_overview.png" });
await browser.disconnect();

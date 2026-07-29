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
await new Promise(r => setTimeout(r, 2500));
await clickButtonText("Graph View");
await new Promise(r => setTimeout(r, 1500));
await page.screenshot({ path: "_shotK_overview.png" });

const info = await page.evaluate(() => {
  const svg = document.querySelector("svg.graph-viz");
  if (!svg) return { noSvg: true };
  const vb = svg.getAttribute("viewBox");
  const rect = svg.getBoundingClientRect();
  const rects = Array.from(svg.querySelectorAll("rect"));
  const xs = rects.map(c => parseFloat(c.getAttribute("x")));
  const ys = rects.map(c => parseFloat(c.getAttribute("y")));
  const ws = rects.map(c => parseFloat(c.getAttribute("width")));
  const hs = rects.map(c => parseFloat(c.getAttribute("height")));
  return {
    viewBox: vb, containerW: rect.width, containerH: rect.height,
    containerAspect: rect.width / rect.height, nodeCount: rects.length,
    minX: Math.min(...xs), maxX: Math.max(...xs.map((x, i) => x + ws[i])),
    minY: Math.min(...ys), maxY: Math.max(...ys.map((y, i) => y + hs[i])),
  };
});
console.log(JSON.stringify(info, null, 2));
await page.close();
await browser.disconnect();

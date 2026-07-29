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

// poll: if entities stat is 0, trigger rebuild and wait for it to land
async function entityCount() {
  return page.evaluate(() => {
    const chip = Array.from(document.querySelectorAll(".stat-chip")).find(c => c.textContent?.includes("ENTITIES"));
    const v = chip?.querySelector(".stat-chip-value")?.textContent;
    return v ? parseInt(v.replace(/,/g, ""), 10) : 0;
  });
}

let count = await entityCount();
console.log("initial entity count:", count);
if (count === 0) {
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll("button")).find(b => b.textContent?.includes("Rebuild"));
    btn?.click();
  });
  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 3000));
    count = await entityCount();
    console.log(`poll ${i}: entities=${count}`);
    if (count > 0) break;
  }
}

await clickButtonText("Graph View");
await new Promise(r => setTimeout(r, 1500));

// settle: wait until the svg has nonzero measured height before capturing
for (let i = 0; i < 10; i++) {
  const h = await page.evaluate(() => document.querySelector("svg.graph-viz")?.getBoundingClientRect().height ?? 0);
  if (h > 100) break;
  await new Promise(r => setTimeout(r, 400));
}

await page.screenshot({ path: "_shotI_overview.png" });

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
    viewBox: vb,
    containerW: rect.width, containerH: rect.height,
    containerAspect: rect.width / rect.height,
    nodeCount: rects.length,
    minX: Math.min(...xs), maxX: Math.max(...xs.map((x, i) => x + ws[i])),
    minY: Math.min(...ys), maxY: Math.max(...ys.map((y, i) => y + hs[i])),
  };
});
console.log(JSON.stringify(info, null, 2));
await browser.disconnect();

// ssg_scrape_v3.js
const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const fs = require("fs-extra");
const axios = require("axios");
puppeteer.use(StealthPlugin());

const TARGET_URL =
  "https://emart.ssg.com/disp/category.ssg?dispCtgId=6000213557";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function sanitizeFilename(name) {
  return name.replace(/[\\/:*?"<>|]/g, "_").trim();
}

async function downloadImage(url, savePath) {
  const res = await axios.get(url, {
    responseType: "arraybuffer",
    timeout: 30000,
  });
  await fs.outputFile(savePath, res.data);
}

async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let total = 0;
      const dist = 600;
      const timer = setInterval(() => {
        window.scrollBy(0, dist);
        total += dist;
        if (total >= document.body.scrollHeight - window.innerHeight) {
          clearInterval(timer);
          resolve();
        }
      }, 250);
    });
  });
}

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-features=site-per-process",
    ],
  });

  const page = await browser.newPage();
  await page.setUserAgent(UA);
  await page.setExtraHTTPHeaders({
    "accept-language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
  });
  await page.setViewport({ width: 1440, height: 900 });

  // 탐지 완화
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => false });
    Object.defineProperty(navigator, "languages", {
      get: () => ["ko-KR", "ko", "en-US", "en"],
    });
    Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3] });
    window.chrome = window.chrome || { runtime: {} };
  });

  try {
    await page.goto(TARGET_URL, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await page.waitForSelector("#ty_thmb_view > ul > li", { timeout: 30000 });

    await autoScroll(page);
    await new Promise((r) => setTimeout(r, 1200));

    // === 여기 수정됨 ===
    const items = await page.$$eval("#ty_thmb_view > ul > li", (lis) => {
      const resolveAbs = (href) => {
        try {
          return new URL(href, location.href).toString();
        } catch {
          return href;
        }
      };

      return lis
        .map((li) => {
          const a = li.querySelector("div > a");
          const href = a?.getAttribute("href") || a?.href || null;
          const url = href ? resolveAbs(href) : null;

          const brandEl = li.querySelector(
            "div > a > div.mnemitem_tit > span.mnemitem_goods_brand"
          );
          const brand = brandEl?.textContent?.trim() || null;

          const titleEl = li.querySelector(
            "div > a > div.mnemitem_tit > span.mnemitem_goods_tit"
          );
          const title = titleEl?.textContent?.trim() || null;

          const imgEl = li.querySelector("div > a img");
          let imageUrl =
            imgEl?.getAttribute("data-src") ||
            imgEl?.getAttribute("data-original") ||
            imgEl?.getAttribute("src") ||
            null;
          if (imageUrl) {
            try {
              imageUrl = new URL(imageUrl, location.href).toString();
            } catch {}
          }

          return { url, brand, title, imageUrl };
        })
        .filter(Boolean);
    });

    // 저장
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const outDir = `./output/ssg_${ts}`;
    const imgDir = `${outDir}/images`;
    await fs.ensureDir(imgDir);

    const results = [];
    for (const [idx, item] of items.entries()) {
      if (!item.title && !item.url && !item.imageUrl) continue;

      let savedImagePath = null;
      if (item.imageUrl) {
        const baseName = sanitizeFilename(item.title || `item_${idx}`);
        const ext = (item.imageUrl
          .split("?")[0]
          .match(/\.(jpg|jpeg|png|webp|gif)$/i) || [".jpg"])[0];
        const savePath = `${imgDir}/${baseName}${ext}`;
        try {
          await downloadImage(item.imageUrl, savePath);
          savedImagePath = savePath;
        } catch (e) {
          console.warn("이미지 저장 실패:", item.imageUrl);
        }
        await new Promise((r) =>
          setTimeout(r, 150 + Math.floor(Math.random() * 200))
        );
      }

      results.push({
        url: item.url,
        brand: item.brand,
        title: item.title,
        imageUrl: item.imageUrl,
        imageLocalPath: savedImagePath,
      });
    }

    await fs.outputJSON(
      `${outDir}/result.json`,
      { source: TARGET_URL, count: results.length, items: results },
      { spaces: 2 }
    );

    console.log("수집 완료:", results.length, "건");
    console.log("출력 폴더:", outDir);
  } catch (err) {
    console.error("오류:", err);
  } finally {
    await browser.close();
  }
})();

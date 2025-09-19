// ssg_scrape_v3_paged_withLogs.js
const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const fs = require("fs-extra");
const axios = require("axios");
puppeteer.use(StealthPlugin());

const TARGET_URL =
  "https://emart.ssg.com/disp/category.ssg?dispCtgId=6000213557";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// 수집할 최대 페이지 수 (null이면 가능한 전부)
const MAX_PAGES = null;

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

async function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function getCurrentPageNum(page) {
  const cur = await page
    .$eval(".paging", (el) => {
      const strong = el.querySelector("strong[title='현재위치']");
      return strong ? parseInt(strong.textContent.trim(), 10) : 1;
    })
    .catch(() => 1);
  return Number.isFinite(cur) ? cur : 1;
}

async function getMaxPageNumFromDOM(page) {
  const max = await page
    .$eval(".paging", (el) => {
      const nums = [];
      el.querySelectorAll("a, strong").forEach((a) => {
        const t = a.textContent.trim();
        const n = parseInt(t, 10);
        if (Number.isFinite(n)) nums.push(n);
      });
      return nums.length ? Math.max(...nums) : 1;
    })
    .catch(() => 1);
  return max || 1;
}

async function goToPage(page, targetPageNum) {
  console.log(`➡️  페이지 ${targetPageNum}로 이동 시도 중...`);
  const beforeKey = await page
    .$eval("#ty_thmb_view", (wrap) => {
      const first = wrap.querySelector("ul > li:first-child a");
      return first ? first.getAttribute("href") || first.href || "" : "";
    })
    .catch(() => "");

  const called = await page
    .evaluate((n) => {
      try {
        if (
          window.itemLister &&
          typeof window.itemLister.changePage === "function"
        ) {
          window.itemLister.changePage(n);
          return true;
        }
      } catch (e) {}
      return false;
    }, targetPageNum)
    .catch(() => false);

  if (!called) {
    await page
      .$eval(
        ".paging",
        (root, n) => {
          const links = Array.from(root.querySelectorAll("a"));
          let el = links.find((a) => a.textContent.trim() === String(n));
          if (!el) {
            el = links.find((a) => {
              const oc = a.getAttribute("onclick") || "";
              return oc.includes(`itemLister.changePage(${n})`);
            });
          }
          if (el) el.click();
        },
        targetPageNum
      )
      .catch(() => {
        throw new Error(`페이지 ${targetPageNum} 이동 실패`);
      });
  }

  try {
    await page.waitForFunction(
      (n) => {
        const strong = document.querySelector(
          ".paging strong[title='현재위치']"
        );
        const cur = strong ? parseInt(strong.textContent.trim(), 10) : 0;
        return cur === n;
      },
      { timeout: 15000 },
      targetPageNum
    );
  } catch (_) {
    await page
      .waitForFunction(
        (prevKey) => {
          const first = document.querySelector(
            "#ty_thmb_view ul > li:first-child a"
          );
          const now = first
            ? first.getAttribute("href") || first.href || ""
            : "";
          return now && now !== prevKey;
        },
        { timeout: 15000 },
        beforeKey
      )
      .catch(() => {});
  }

  await autoScroll(page);
  await wait(800 + Math.floor(Math.random() * 400));
  console.log(`✅ 페이지 ${targetPageNum} 로딩 완료`);
}

async function scrapeItemsOnPage(page) {
  await page
    .waitForSelector("#ty_thmb_view > ul > li", { timeout: 20000 })
    .catch(() => {});
  await autoScroll(page);
  await wait(400);

  const items = await page.$$eval("#ty_thmb_view > ul > li", (lis) => {
    const resolveAbs = (href) => {
      try {
        return new URL(href, location.href).toString();
      } catch {
        return href;
      }
    };

    return lis.map((li) => {
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

      if (!imageUrl) {
        const srcset = imgEl?.getAttribute("srcset");
        if (srcset) {
          const candidates = srcset
            .split(",")
            .map((s) => s.trim().split(" ")[0])
            .filter(Boolean);
          if (candidates.length) imageUrl = candidates[candidates.length - 1];
        }
      }
      if (imageUrl) {
        try {
          imageUrl = new URL(imageUrl, location.href).toString();
        } catch {}
      }

      return { url, brand, title, imageUrl };
    });
  });

  console.log(`📦 ${items.length}개 아이템 추출 완료`);
  return items;
}

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const page = await browser.newPage();
  await page.setUserAgent(UA);
  await page.setExtraHTTPHeaders({
    "accept-language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
  });
  await page.setViewport({ width: 1440, height: 900 });

  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => false });
    Object.defineProperty(navigator, "languages", {
      get: () => ["ko-KR", "ko", "en-US", "en"],
    });
    Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3] });
    window.chrome = window.chrome || { runtime: {} };
  });

  const allResults = [];
  try {
    console.log("🌐 페이지 접속 중...");
    await page.goto(TARGET_URL, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await page.waitForSelector("#ty_thmb_view > ul > li", { timeout: 30000 });

    let current = await getCurrentPageNum(page);
    console.log(`🔎 현재 페이지: ${current}`);
    let lastInDOM = await getMaxPageNumFromDOM(page);
    console.log(`📑 DOM에서 감지한 마지막 페이지: ${lastInDOM}`);

    let firstPageItems = await scrapeItemsOnPage(page);
    allResults.push({ page: current, items: firstPageItems });

    while (true) {
      current = await getCurrentPageNum(page);
      lastInDOM = await getMaxPageNumFromDOM(page);
      const next = current + 1;

      if (MAX_PAGES && next > MAX_PAGES) {
        console.log("⛔️ 설정한 MAX_PAGES 도달, 중단합니다.");
        break;
      }
      if (next > lastInDOM) {
        console.log("⛔️ 더 이상 다음 페이지 없음, 종료합니다.");
        break;
      }

      await goToPage(page, next);
      const items = await scrapeItemsOnPage(page);
      allResults.push({ page: next, items });
    }

    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const outDir = `./output/ssg_${ts}`;
    const imgDir = `${outDir}/images`;
    await fs.ensureDir(imgDir);

    const flat = [];
    for (const grp of allResults) {
      for (const [idx, item] of grp.items.entries()) {
        if (!item.title && !item.imageUrl) continue;

        let savedImagePath = null;
        if (item.imageUrl && item.title) {
          const baseName = sanitizeFilename(item.title);
          const extMatch = item.imageUrl
            .split("?")[0]
            .match(/\.(jpg|jpeg|png|webp|gif)$/i);
          const ext = extMatch ? extMatch[0] : ".jpg";
          const savePath = `${imgDir}/${String(grp.page).padStart(
            2,
            "0"
          )}_${String(idx + 1).padStart(3, "0")}_${baseName}${ext}`;
          try {
            console.log(`🖼️  이미지 저장: ${savePath}`);
            await downloadImage(item.imageUrl, savePath);
            savedImagePath = savePath;
          } catch {
            console.warn("⚠️ 이미지 저장 실패:", item.imageUrl);
          }
          await wait(100);
        }

        flat.push({ page: grp.page, ...item, imageLocalPath: savedImagePath });
      }
    }

    await fs.outputJSON(
      `${outDir}/result.json`,
      { source: TARGET_URL, count: flat.length, items: flat },
      { spaces: 2 }
    );

    console.log("🎉 크롤링 완료!");
    console.log(
      `총 페이지 수: ${allResults.length}, 총 아이템 수: ${flat.length}`
    );
    console.log("📂 출력 폴더:", outDir);
  } catch (err) {
    console.error("🚨 오류 발생:", err);
  } finally {
    await browser.close();
  }
})();

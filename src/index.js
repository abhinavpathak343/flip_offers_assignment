    import fs from "fs";
    import path from "path";
    import puppeteer from "puppeteer-extra";
    import StealthPlugin from "puppeteer-extra-plugin-stealth";
    import pLimit from "p-limit";
    import slugify from "slugify";
    import {
        resolveEligibleCards
    } from "./extractor/sbiExtractor.js";


    puppeteer.use(StealthPlugin());

    const START_URL = "https://www.sbicard.com/en/personal/offers.page";
    const OUTPUT_DIR = path.join("data", "sbi-offers");
    const CONCURRENCY = Number(6);

    function sleep(ms) {
        return new Promise((r) => setTimeout(r, ms));
    }

    function jitter(min = 100, max = 300) {
        return min + Math.floor(Math.random() * (max - min + 1));
    }

    function ensureDir(dir) {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, {
                recursive: true
            });
        }
    }

    function safeSlug(input) {
        return slugify(String(input || ""), {
            lower: true,
            strict: true,
            replacement: "-",
            trim: true
        }).replace(/-+/g, "-");
    }

    async function getInnerText(page, selectors) {
        for (const sel of selectors) {
            try {
                const el = await page.$(sel);
                if (el) {
                    const txt = await page.evaluate((e) => e.innerText, el);
                    if (txt && txt.trim().length > 0) return txt.trim();
                }
            } catch {}
        }
        return "";
    }

    async function extractDetail(page) {
        await page.waitForSelector("body", {
            timeout: 20000
        });

        const title = (await getInnerText(page, ["h1", "h2", ".offer-title", "[data-testid=offer-title]"])) ||
            await page.title();

        const possibleDesc = await getInnerText(page, [
            ".offer-description", ".description", "article p", ".content p", "main p"
        ]);

        const fullText = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " ").trim());

        const validityMatch = fullText.match(/(offer\s*valid(?:ity)?|valid(?:ity)?|offer\s*period)\s*[:\-]?\s*([^\n]{5,120})/i);
        const validity = validityMatch ? validityMatch[2].trim() : "";

        const tnc = await page.evaluate(() => {
            function textFromNode(node) {
                return node ? (node.innerText || node.textContent || "").trim() : "";
            }
            const candidates = Array.from(document.querySelectorAll("*"))
                .filter(n => /terms?\s*&?\s*conditions?/i.test(n.textContent || ""));
            for (const node of candidates) {
                const parent = node.closest("section, article, div");
                const text = textFromNode(parent) || textFromNode(node);
                if (text && text.length > 50) return text;
            }
            return "";
        });

        const applicabilityText = (() => {
            const m = fullText.match(/(applicab(?:le|ility)\s*(?:cards?)?|valid\s*for|offer\s*valid\s*(?:on|for)|eligible\s*cards?|all\s*sbi\s*cards[^\n]*exclud[^\n]*|exclud(?:e|es|ing)\s*[^\n]{3,})[^\n]*/i);
            return m ? m[0].trim() : "";
        })();

        const description = possibleDesc || (() => {
            const m = fullText.match(/(?:about\s*the\s*offer|offer\s*details|description)\s*[:\-]?\s*([^\n]{20,300})/i);
            return m ? m[1].trim() : "";
        })();

        return {
            title: String(title || "").trim(),
            description,
            validity,
            tnc: tnc || "",
            applicabilityText
        };
    }

    async function scrapeOffersIndex(page) {
        await page.goto(START_URL, {
            waitUntil: "domcontentloaded",
            timeout: 60000
        });
        await page.waitForSelector("body", {
            timeout: 30000
        });

        try {
            const cookieBtn = await page.$x("//button[contains(translate(., 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), 'accept') or contains(translate(., 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), 'agree') or contains(translate(., 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), 'close')]");
            if (cookieBtn && cookieBtn[0]) await cookieBtn[0].click();
        } catch {}

        try {
            await page.evaluate(async () => {
                await new Promise((resolve) => {
                    let lastHeight = 0;
                    let stableTicks = 0;
                    const int = setInterval(() => {
                        const {
                            scrollHeight
                        } = document.documentElement;
                        window.scrollTo(0, scrollHeight);
                        if (scrollHeight === lastHeight) {
                            stableTicks++;
                            if (stableTicks >= 5) {
                                clearInterval(int);
                                resolve(null);
                            }
                        } else {
                            stableTicks = 0;
                            lastHeight = scrollHeight;
                        }
                    }, 400);
                });
            });
        } catch {}

        try {
            let tries = 0;
            while (tries < 5) {
                const buttons = await page.$x("//button[contains(translate(., 'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'load more')]");
                if (!buttons || buttons.length === 0) break;
                for (const b of buttons) {
                    try {
                        await b.click();
                    } catch {}
                    await sleep(500);
                }
                tries++;
            }
        } catch {}

        const cards = await page.evaluate(() => {
            const set = new Map();
            const add = (title, href) => {
                if (!title || !href) return;
                const t = title.trim();
                const h = href.trim();
                if (!set.has(h)) set.set(h, t);
            };

            const anchors = Array.from(document.querySelectorAll("a[href]"));
            for (const a of anchors) {
                const href = a.getAttribute("href") || "";
                const abs = a.href || href;
                const text = (a.innerText || a.textContent || a.getAttribute("title") || "").replace(/\s+/g, " ").trim();
                if (/\/en\/personal\/offer\/[^?#]+\.page/i.test(abs)) {
                    if (text && text.length >= 3) add(text, abs);
                }
            }
            const idAnchors = Array.from(document.querySelectorAll("a.so-card-arrow-block[data-id]"));
            for (const a of idAnchors) {
                const dataId = a.getAttribute("data-id");
                let title = "";
                const card = a.closest(".so-card, .offer-card, li, article, .card, .col-12, div");
                if (card) {
                    const heading = card.querySelector("h3, h2, .title, .heading");
                    title = (heading ? (heading.innerText || heading.textContent) : (card.innerText || "")) || "";
                }
                title = (title || dataId || "").replace(/\s+/g, " ").trim();
                if (dataId) add(title || dataId, `/en/personal/offer/${dataId}`);
            }
            return Array.from(set.entries()).map(([href, title]) => ({
                title,
                href
            }));
        });

        const normalized = cards.map(c => {
            const href = c.href.startsWith("http") ? c.href : new URL(c.href, "https://www.sbicard.com").href;
            return {
                title: c.title,
                href
            };
        });

        return normalized;
    }

    async function processOffer(browser, card) {
        const page = await browser.newPage();
        try {
            await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36");
            await page.goto(card.href, {
                waitUntil: "domcontentloaded",
                timeout: 60000
            });
            await page.waitForSelector("body", {
                timeout: 20000
            });
            const detail = await extractDetail(page);

            const {
                eligibleCards,
                excludedCards
            } = resolveEligibleCards(detail.applicabilityText || "");

            let slug = "";
            try {
                const u = new URL(card.href);
                const last = u.pathname.split("/").filter(Boolean).pop() || "offer";
                slug = safeSlug(last.replace(/\.page$/i, ""));
            } catch {
                slug = safeSlug(detail.title || card.title || "offer");
            }
            const payload = {
                offerId: slug,
                title: detail.title || card.title || "",
                description: detail.description || "",
                validity: detail.validity || "",
                tnc: detail.tnc || "",
                eligibleCards,
                excludedCards
            };

            ensureDir(OUTPUT_DIR);
            const target = path.join(OUTPUT_DIR, `${slug}.json`);
            fs.writeFileSync(target, JSON.stringify(payload, null, 2), "utf8");
            console.log(`✅ Saved -> ${target}`);
        } catch (e) {
            console.warn(`Failed to process offer: ${card.href} - ${e.message}`);
        } finally {
            try {
                await page.close();
            } catch {}
            await sleep(jitter());
        }
    }

    async function run() {
        console.log("\n=== SBI Offers Scraper ===");
        ensureDir(OUTPUT_DIR);

        const browser = await puppeteer.launch({
            headless: true,
            args: ["--no-sandbox", "--disable-setuid-sandbox"]
        });
        const page = await browser.newPage();

        try {
            const cards = await scrapeOffersIndex(page);
            console.log(`Found ${cards.length} offer links`);

            const uniqueByHref = Array.from(new Map(cards.map(c => [c.href, c])).values());

            const limit = pLimit(CONCURRENCY);
            const tasks = uniqueByHref.map((card) => limit(() => processOffer(browser, card)));
            const results = await Promise.allSettled(tasks);

            const ok = results.filter(r => r.status === "fulfilled").length;
            const fail = results.length - ok;
            console.log(`Done. Success: ${ok}, Failed: ${fail}`);
        } catch (e) {
            console.error("Fatal error:", e.message);
        } finally {
            try {
                await page.close();
            } catch {}
            await browser.close();
        }
    }

    run().catch((e) => {
        console.error("Unhandled error:", e);
        process.exit(1);
    });
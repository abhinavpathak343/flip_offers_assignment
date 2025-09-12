// src/crawler/crawler.js
import axios from "axios";
import * as cheerio from "cheerio";

function normalizeUrl(rawUrl, base, {
    keepQueryForPdf = true
} = {}) {
    try {
        const u = new URL(rawUrl, base);
        u.hash = ""; // strip fragments
        const isPdf = u.pathname.toLowerCase().endsWith(".pdf");
        if (!isPdf || !keepQueryForPdf) {
            u.search = ""; // drop query for normal pages to avoid duplicates
        }
        if (u.pathname.length > 1 && u.pathname.endsWith("/")) {
            u.pathname = u.pathname.slice(0, -1);
        }
        return u.href;
    } catch {
        return null;
    }
}

function isSameOrigin(url, root) {
    try {
        const u = new URL(url, root);
        const r = new URL(root);
        return u.origin === r.origin;
    } catch {
        return false;
    }
}

function isRelevantLink(absoluteUrl, anchorText, rootPathHint) {
    const urlLower = absoluteUrl.toLowerCase();
    const textLower = (anchorText || "").toLowerCase();
    const keywords = [
        "click here",
        "know more",
        "terms",
        "conditions",
        "tnc",
        "benefits",
        "features",
        "offers",
        "lounge",
        "product",
        "privilege",
    ];
    if (urlLower.endsWith(".pdf")) return true;
    if (rootPathHint && urlLower.includes(rootPathHint)) return true;
    return keywords.some((k) => textLower.includes(k) || urlLower.includes(k));
}

export async function crawlPage(url) {
    try {
        const {
            data
        } = await axios.get(url);
        const $ = cheerio.load(data);

        const text = " " + $("body").text().replace(/\s+/g, " ").trim();
        const links = [];
        const root = url;
        const rootUrl = new URL(root);
        const rootPathHint = rootUrl.pathname
            .split("/")
            .filter(Boolean)
            .join("-");

        $("a").each((_, el) => {
            const href = $(el).attr("href");
            const anchorText = $(el).text();
            if (!href) return;
            const absoluteUrl = normalizeUrl(href, root);
            if (!absoluteUrl) return;
            if (!isSameOrigin(absoluteUrl, root)) return;
            if (!isRelevantLink(absoluteUrl, anchorText, rootPathHint)) return;

            let type = "page";
            if (absoluteUrl.toLowerCase().endsWith(".pdf")) type = "pdf";

            links.push({
                url: absoluteUrl,
                type
            });
        });

        return {
            text,
            links
        };
    } catch (err) {
        console.error(`❌ Failed to crawl ${url}:`, err.message);
        return {
            text: "",
            links: []
        };
    }
}

export async function crawlWithinScope(startUrl, maxDepth = 2, options = {}) {
    const pageLimit = options.pageLimit ?? 20;
    const pdfLimit = options.pdfLimit ?? 20;
    const pathMustContain = (options.pathMustContain ?? new URL(startUrl).pathname)
        .toLowerCase();

    const normalizedStart = normalizeUrl(startUrl, startUrl, {
        keepQueryForPdf: false
    });
    const visitedPages = new Set();
    const visitedPdfs = new Set();
    const queue = [{
        url: normalizedStart,
        depth: 0
    }];
    let aggregatedText = "";
    const discoveredLinks = [];
    const root = new URL(startUrl);

    while (queue.length && visitedPages.size < pageLimit) {
        const {
            url,
            depth
        } = queue.shift();
        if (visitedPages.has(url) || depth > maxDepth) continue;
        const urlPath = new URL(url).pathname.toLowerCase();
        if (pathMustContain && !urlPath.includes(pathMustContain)) continue;
        visitedPages.add(url);

        const {
            text,
            links
        } = await crawlPage(url);
        aggregatedText += `\n\n[PAGE:${url}]\n` + text;

        for (const link of links) {
            if (!isSameOrigin(link.url, root.href)) continue;
            const linkPath = new URL(link.url).pathname.toLowerCase();
            if (pathMustContain && !linkPath.includes(pathMustContain)) continue;

            if (link.type === "pdf") {
                if (visitedPdfs.size >= pdfLimit) continue;
                const pdfKey = normalizeUrl(link.url, root.href, {
                    keepQueryForPdf: false
                });
                if (!pdfKey || visitedPdfs.has(pdfKey)) continue;
                visitedPdfs.add(pdfKey);
                discoveredLinks.push({
                    ...link,
                    url: pdfKey,
                    referer: url
                });
            } else if (link.type === "page") {
                const pageKey = normalizeUrl(link.url, root.href, {
                    keepQueryForPdf: false
                });
                if (!pageKey || visitedPages.has(pageKey)) continue;
                if (visitedPages.size + queue.length >= pageLimit) continue;
                queue.push({
                    url: pageKey,
                    depth: depth + 1
                });
            }
        }
    }

    return {
        text: aggregatedText.trim(),
        links: discoveredLinks
    };
}
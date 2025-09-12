import axios from "axios";
import * as cheerio from "cheerio";

function normalizeUrl(rawUrl, base, {
    keepQueryForPdf = true
} = {}) {
    try {
        const u = new URL(rawUrl, base);
        u.hash = ""; // strip fragments
        const isPdf = u.pathname.toLowerCase().endsWith(".pdf") || u.href.includes('.pdf') || (u.searchParams.get('path') && u.searchParams.get('path').includes('.pdf'));
        if (!isPdf || !keepQueryForPdf) {
            u.search = ""; // drop query for normal pages to avoid duplicates
        }
        if (u.pathname.length > 1 && u.pathname.endsWith("/") && !isPdf) {
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

    // Skip unwanted URLs
    if (urlLower.includes('{{') ||
        urlLower.includes('}}') ||
        urlLower.includes('minilogolink') ||
        urlLower.includes('javascript:') ||
        urlLower.includes('tel:') ||
        urlLower.includes('mailto:') ||
        urlLower.includes('locateus')) {
        return false;
    }

    const keywords = [
        "click here", "know more", "terms", "conditions", "tnc",
        "benefits", "features", "offers", "lounge", "product",
        "privilege", "diners", "rewards", "fees", "charges",
        "pdf", "document", "brochure", "policy", "details"
    ];

    // Check for PDF files
    if (urlLower.endsWith(".pdf")) return true;

    // Check for PDF links that might not have .pdf extension but contain PDF content
    if (urlLower.includes("pdf") ||
        urlLower.includes("document") ||
        urlLower.includes("brochure") ||
        urlLower.includes("policy") ||
        urlLower.includes("terms") ||
        urlLower.includes("charges")) return true;

    // Check for "click here" links that might lead to PDFs
    if (textLower.includes("click here") &&
        (textLower.includes("t&c") ||
            textLower.includes("terms") ||
            textLower.includes("conditions") ||
            textLower.includes("policy") ||
            textLower.includes("details") ||
            textLower.includes("charges"))) return true;

    if (rootPathHint && urlLower.includes(rootPathHint)) return true;
    return keywords.some((k) => textLower.includes(k) || urlLower.includes(k));
}

export async function crawlPage(url) {
    const maxRetries = 3;
    let lastError;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            console.log(`🔍 Crawling (attempt ${attempt}/${maxRetries}): ${url}`);

            const {
                data
            } = await axios.get(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.5',
                    'Accept-Encoding': 'gzip, deflate, br',
                    'Connection': 'keep-alive',
                    'Upgrade-Insecure-Requests': '1',
                    'Sec-Fetch-Dest': 'document',
                    'Sec-Fetch-Mode': 'navigate',
                    'Sec-Fetch-Site': 'none'
                },
                timeout: 20000, // Increased timeout to 20 seconds
                maxRedirects: 10,
                validateStatus: (status) => status >= 200 && status < 400
            });

            const $ = cheerio.load(data);

            // Remove unwanted elements that might contain noise
            $('script, style, nav, header, footer, .cookie-banner, .popup, .advertisement').remove();

            // Extract text content more selectively
            let text = "";

            // Try to get main content areas first
            const contentSelectors = [
                'main',
                '.main-content',
                '.content',
                '.card-details',
                '.card-features',
                '.benefits',
                '.offers',
                '.product-info',
                'article',
                '.container'
            ];

            let foundMainContent = false;
            for (const selector of contentSelectors) {
                const mainContent = $(selector);
                if (mainContent.length > 0) {
                    const mainText = mainContent.text().replace(/\s+/g, " ").trim();
                    if (mainText.length > 100) {
                        text += mainText + " ";
                        foundMainContent = true;
                        break;
                    }
                }
            }

            // Fallback to body if no main content found
            if (!foundMainContent) {
                text = $("body").text().replace(/\s+/g, " ").trim();
            }

            const links = [];
            const root = url;
            const rootUrl = new URL(root);
            const rootPathHint = rootUrl.pathname
                .split("/")
                .filter(Boolean)
                .join("-");

            $("a").each((_, el) => {
                const href = $(el).attr("href");
                const anchorText = $(el).text().trim();
                if (!href) return;

                const absoluteUrl = normalizeUrl(href, root);
                if (!absoluteUrl) return;
                if (!isSameOrigin(absoluteUrl, root)) return;
                if (!isRelevantLink(absoluteUrl, anchorText, rootPathHint)) return;

                let type = "page";
                const urlLower = absoluteUrl.toLowerCase();
                const textLower = anchorText.toLowerCase();

                // Detect PDF links more comprehensively
                if (urlLower.endsWith(".pdf") ||
                    urlLower.includes("pdf") ||
                    urlLower.includes("document") ||
                    urlLower.includes("brochure") ||
                    urlLower.includes("policy") ||
                    absoluteUrl.includes('/content/bbp/repositories/') ||
                    (absoluteUrl.includes('?path=') && absoluteUrl.includes('.pdf')) ||
                    (textLower.includes("click here") &&
                        (textLower.includes("t&c") ||
                            textLower.includes("terms") ||
                            textLower.includes("conditions") ||
                            textLower.includes("policy") ||
                            textLower.includes("details") ||
                            textLower.includes("charges")))) {
                    type = "pdf";
                }

                links.push({
                    url: absoluteUrl,
                    type,
                    anchorText
                });
            });

            console.log(`✅ Crawled: ${url} | Text: ${text.length} chars | Links: ${links.length}`);
            return {
                text: " " + text,
                links
            };

        } catch (err) {
            lastError = err;

            if (err.code === 'ECONNABORTED' || err.message.includes('timeout')) {
                console.log(`Timeout on attempt ${attempt}/${maxRetries} for ${url}`);
            } else if (err.response && err.response.status === 404) {
                console.log(`Skipping 404: ${url}`);
                return {
                    text: "",
                    links: []
                };
            } else {
                console.warn(`Error on attempt ${attempt}/${maxRetries}: ${err.message}`);
            }

            if (attempt < maxRetries) {
                const waitTime = 2000 * attempt; // Progressive backoff
                console.log(`Waiting ${waitTime}ms before retry...`);
                await new Promise(resolve => setTimeout(resolve, waitTime));
            }
        }
    }

    console.error(`Failed to crawl ${url} after ${maxRetries} attempts:`, lastError.message);
    return {
        text: "",
        links: []
    };
}

export async function crawlWithinScope(startUrl, maxDepth = 2, options = {}) {
    const pageLimit = options.pageLimit || 20;
    const pdfLimit = options.pdfLimit || 20;
    const pathMustContain = (options.pathMustContain || new URL(startUrl).pathname)
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

    console.log(`Starting crawl from: ${normalizedStart}`);
    console.log(`Scope: path contains "${pathMustContain}"`);

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
        if (text.trim().length > 50) { // Only add substantial content
            aggregatedText += `\n\n[PAGE:${url}]\n` + text;
        }

        for (const link of links) {
            if (!isSameOrigin(link.url, root.href)) continue;

            if (link.type === "pdf") {
                if (visitedPdfs.size >= pdfLimit) continue;
                const pdfKey = normalizeUrl(link.url, root.href, {
                    keepQueryForPdf: true
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
                const pagePath = new URL(pageKey).pathname.toLowerCase();
                if (pathMustContain && !pagePath.includes(pathMustContain)) continue;
                if (visitedPages.size + queue.length >= pageLimit) continue;
                queue.push({
                    url: pageKey,
                    depth: depth + 1
                });
            }
        }

        // Add delay between requests to be respectful
        await new Promise(resolve => setTimeout(resolve, 1000));
    }

    console.log(`Crawl summary: pages=${visitedPages.size}, pdfs=${discoveredLinks.length}`);
    return {
        text: aggregatedText.trim(),
        links: discoveredLinks
    };
}
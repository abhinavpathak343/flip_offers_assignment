// src/index.js
import fs from "fs";
import path from "path";
import {
    crawlWithinScope
} from "./crawler/crawler.js";
import {
    parsePdf
} from "./crawler/pdfparse.js";
import {
    extractCardDetails
} from "./extractor/Extractor.js";
import {
    extractBrandOffers
} from "./extractor/Extractor.js";

// Allow URL from CLI: node src/index.js <url>
const cliArgUrl = process.argv[2];
let START_URL = "https://www.hdfcbank.com/personal/pay/cards/credit-cards/diners-privilege";
if (cliArgUrl) {
    try {
        const candidate = new URL(cliArgUrl);
        START_URL = candidate.href;
    } catch {
        console.warn("Invalid URL provided via CLI. Falling back to default START_URL.");
    }
} else {
    console.log("You can provide a URL: node src/index.js <url>");
}

// Aggressive content pre-trimming to extract only offer-relevant sections
function preTrimContent(text) {
    const highValueKeywords = [
        // Specific brands/merchants
        'swiggy', 'zomato', 'bookmyshow', 'adidas', 'fortis', 'marriott', 'decathlon',
        'barbeque nation', 'o2 spa', 'lakme salon', 'times prime', 'amazon prime',
        'mmt black', 'club marriott', 'smartbuy',
        // Offer types
        'cashback', 'discount', 'offers', 'rewards', 'points', 'miles',
        'lounge access', 'travel insurance', 'welcome benefit', 'milestone',
        'annual fee', 'joining fee', 'renewal fee', 'foreign markup',
        'redemption', 'dining', 'entertainment', 'shopping', 'travel',
        'buy 1 get 1', 'bogo', 'voucher', 'membership'
    ];

    const lines = text.split('\n');
    const relevantLines = [];
    let inOfferSection = false;
    let contextLines = 0;
    let consecutiveEmptyLines = 0;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        const lineLower = line.toLowerCase();

        // Skip empty lines and navigation elements
        if (line.length === 0) {
            consecutiveEmptyLines++;
            if (consecutiveEmptyLines > 2) continue; // Skip multiple empty lines
        } else {
            consecutiveEmptyLines = 0;
        }

        // Skip navigation, headers, footers
        if (lineLower.includes('home') || lineLower.includes('menu') ||
            lineLower.includes('login') || lineLower.includes('register') ||
            lineLower.includes('contact us') || lineLower.includes('privacy') ||
            lineLower.includes('disclaimer') || lineLower.includes('copyright') ||
            lineLower.includes('sitemap') || lineLower.includes('careers')) {
            inOfferSection = false;
            continue;
        }

        const hasHighValueKeyword = highValueKeywords.some(keyword => lineLower.includes(keyword));

        if (hasHighValueKeyword) {
            inOfferSection = true;
            contextLines = 2; // Reduced context for more aggressive filtering
        }

        if (inOfferSection || contextLines > 0) {
            relevantLines.push(lines[i]);
            if (contextLines > 0) contextLines--;
        }

        // Stop processing if we hit non-offer sections
        if (lineLower.includes('terms and conditions') && !lineLower.includes('offer')) {
            inOfferSection = false;
        }
    }

    // Further filter: remove lines that are too short or contain only numbers/symbols
    const filteredLines = relevantLines.filter(line => {
        const trimmed = line.trim();
        if (trimmed.length < 10) return false;
        if (/^[\d\s\-\.\%₹\$]+$/.test(trimmed)) return false; // Only numbers/symbols
        return true;
    });

    const trimmed = filteredLines.join('\n');
    console.log(`Content aggressively trimmed: ${text.length} -> ${trimmed.length} chars (${Math.round((1 - trimmed.length/text.length) * 100)}% reduction)`);
    return trimmed;
}


async function run() {
    console.log("\n=== Start ===");
    console.log("Target URL:", START_URL);

    try {
        console.log("\nValidating configuration...");
        if (!process.env.OPENAI_API_KEY) {
            console.error('OPENAI_API_KEY missing. Create .env with OPENAI_API_KEY=your_key_here');
            process.exit(1);
        }
        console.log("✅ Configuration OK");

        console.log("\nCrawling...");
        const {
            text,
            links
        } = await crawlWithinScope(START_URL, 2, {
            pageLimit: 12,
            pdfLimit: 12,
            crawlConcurrency: 3 // Parallel page crawling
        });

        console.log(`✅ Crawl complete. Text: ${text.length} chars. PDFs found: ${links.length}`);

        if (!text || text.length === 0) {
            console.error("No content extracted from crawling");
            process.exit(1);
        }

        let allText = text;

        // Process PDFs with limited concurrency
        const seenPdf = new Set();
        const pdfLinks = [];
        for (const link of links) {
            if (link.type !== "pdf") continue;
            if (seenPdf.has(link.url)) continue;
            seenPdf.add(link.url);
            pdfLinks.push(link);
        }

        async function runWithConcurrency(items, limit, worker) {
            const results = new Array(items.length);
            let currentIndex = 0;
            async function next() {
                const idx = currentIndex++;
                if (idx >= items.length) return;
                try {
                    results[idx] = await worker(items[idx], idx);
                } catch (e) {
                    results[idx] = null;
                }
                return next();
            }
            const runners = Array.from({
                length: Math.min(limit, items.length)
            }, next);
            await Promise.all(runners);
            return results;
        }

        if (pdfLinks.length) {
            console.log(`\nProcessing ${pdfLinks.length} PDFs with limited concurrency...`);
            const concurrency = 5; // increased for better performance
            await runWithConcurrency(pdfLinks, concurrency, async (link, idx) => {
                console.log(`\nProcessing PDF ${idx + 1}/${pdfLinks.length}: ${link.url}`);
                const pdfText = await parsePdf(link.url, link.referer);
                if (pdfText && pdfText.trim()) {
                    allText += "\n\n[PDF:" + link.url + "]\n" + pdfText;
                    console.log(`✅ PDF parsed. Added ${pdfText.length} chars`);
                } else {
                    console.log("PDF returned no text");
                }
            });
        }

        if (!fs.existsSync("./data")) {
            fs.mkdirSync("./data", {
                recursive: true
            });
            console.log("\n✅ Created data directory");
        }

        try {
            fs.writeFileSync("./data/output.txt", allText, "utf8");
            console.log(`\n✅ Saved raw text to data/output.txt (${allText.length} chars)`);
        } catch (error) {
            console.error("Failed to save raw text:", error.message);
            process.exit(1);
        }

        // Pre-trim content to focus on offer-relevant sections
        const trimmedText = preTrimContent(allText);

        console.log("\nExtracting with OpenAI...");

        // Try brand-keyed extraction first (use trimmed content)
        const brandMap = await extractBrandOffers(trimmedText);
        const extracted = await extractCardDetails(trimmedText);

        if (!extracted) {
            console.log("Extraction failed or returned empty data");
            return;
        }

        console.log(`✅ Extraction OK. Card: ${extracted?.card_name || 'Unknown'} | Offers: ${extracted?.offers?.length || 0}`);

        // Create issuer-based directory structure
        const issuer = (
            Array.isArray(extracted.offers) && extracted.offers[0] && extracted.offers[0].issuer ?
            extracted.offers[0].issuer :
            "HDFC"
        ).toLowerCase();

        const issuerDir = path.join("data", issuer);
        if (!fs.existsSync(issuerDir)) {
            fs.mkdirSync(issuerDir, {
                recursive: true
            });
            console.log(`✅ Created issuer directory: ${issuerDir}`);
        }

        // Process card-wise offers
        const offers = Array.isArray(extracted?.offers)?extracted.offers : [];
        const cardToOffers = {};
        const cardNameSafe = String(extracted.card_name || "hdfc_diners_club_privilege").replace(/[^a-z0-9]+/gi, "_").toLowerCase();

        // Group offers by card applicability
        for (const offer of offers) {
            const cards = Array.isArray(offer.card_applicability) ? offer.card_applicability : [];
            if (cards.length === 0) {
                // If no specific card applicability, assign to main card
                if (!cardToOffers[cardNameSafe]) cardToOffers[cardNameSafe] = [];
                cardToOffers[cardNameSafe].push(offer);
            } else {
                for (const c of cards) {
                    const key = String(c).replace(/[^a-z0-9]+/gi, "_").toLowerCase();
                    if (!cardToOffers[key]) cardToOffers[key] = [];
                    cardToOffers[key].push(offer);
                }
            }
        }

        // If no offers were assigned to any specific card, assign all to main card
        if (Object.keys(cardToOffers).length === 0) {
            cardToOffers[cardNameSafe] = offers;
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0] + '_' +
            new Date().toISOString().replace(/[:.]/g, '-').split('T')[1].split('.')[0];

        const existingFiles = fs.readdirSync(issuerDir)
            .filter(f => /^(\d+)\.json$/i.test(f))
            .map(f => parseInt(f.match(/^(\d+)\.json$/i)[1], 10))
            .filter(n => Number.isFinite(n));
        let nextIndex = existingFiles.length ? Math.max(...existingFiles) + 1 : 1;

        let savedFiles = 0;
        for (const [cardKey, cardOffers] of Object.entries(cardToOffers)) {
            const target = path.join(issuerDir, `${nextIndex}.json`);

            // Prefer OpenAI brand map; if missing or contains generic entries, synthesize from offers
            let payload = brandMap && Object.keys(brandMap).length ? brandMap : {};

            // Check if brandMap contains only generic entries (like "HDFC Bank")
            const hasSpecificBrands = Object.keys(payload).some(key =>
                !key.toLowerCase().includes('hdfc') &&
                !key.toLowerCase().includes('bank') &&
                !key.toLowerCase().includes('diners') &&
                !key.toLowerCase().includes('club')
            );

            if (!hasSpecificBrands || Object.keys(payload).length === 0) {
                console.log("Synthesizing brand-specific offers from extracted data...");
                payload = {};

                for (const offer of cardOffers) {
                    const brandRaw = (offer.merchant || offer.title || "Unknown");
                    const brand = String(brandRaw).trim();
                    const validity = offer.validity || "";
                    const description = offer.description || offer.title || "";
                    const terms = Array.isArray(offer.terms_conditions) ? offer.terms_conditions.join(" ") : (offer.terms_conditions || "");

                    // Only include specific merchant brands, not generic bank names
                    if (brand && !brand.toLowerCase().includes('hdfc') && !brand.toLowerCase().includes('bank')) {
                        if (!payload[brand]) {
                            payload[brand] = {
                                "validity": validity,
                                "offer description": description,
                                "t&c": terms
                            };
                        } else {
                            payload[brand]["validity"] = [payload[brand]["validity"], validity].filter(Boolean).join(" | ");
                            payload[brand]["offer description"] = [payload[brand]["offer description"], description].filter(Boolean).join(" | ");
                            payload[brand]["t&c"] = [payload[brand]["t&c"], terms].filter(Boolean).join(" | ");
                        }
                    }
                }
            }

            try {
                fs.writeFileSync(target, JSON.stringify(payload, null, 2), "utf8");
                console.log(`✅ Saved JSON -> ${target} (offers: ${cardOffers.length})`);
                savedFiles++;
                nextIndex++;
            } catch (error) {
                console.error(`Failed to save ${target}:`, error.message);
            }
        }

        console.log(`\n✅ Done. Files saved: ${savedFiles}\n`);

    } catch (error) {
        console.error("Application error:", error.message);
        console.error(error.stack);
        process.exit(1);
    }
}

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection:', reason);
    process.exit(1);
});

process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    process.exit(1);
});

if (!fs.existsSync('.env')) {
    const envTemplate = `# OpenAI API Configuration
OPENAI_API_KEY=your_openai_api_key_here

# Optional: Adjust these if needed
# MAX_TOKENS=4000
# TEMPERATURE=0`;

    try {
        fs.writeFileSync('.env', envTemplate);
        console.log('Created .env template file. Add your OpenAI API key.');
    } catch (error) {
        console.error('Could not create .env file:', error.message);
    }
}

console.log("Starting application...\n");
run().catch(error => {
    console.error("Fatal error in main function:", error);
    process.exit(1);
});
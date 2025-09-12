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
            pdfLimit: 12
        });

        console.log(`✅ Crawl complete. Text: ${text.length} chars. PDFs found: ${links.length}`);

        if (!text || text.length === 0) {
            console.error("No content extracted from crawling");
            process.exit(1);
        }

        let allText = text;

        // Process PDFs
        const seenPdf = new Set();
        let pdfCount = 0;

        for (const link of links) {
            if (link.type !== "pdf") continue;
            if (seenPdf.has(link.url)) continue;
            seenPdf.add(link.url);

            console.log(`\nProcessing PDF ${++pdfCount}/${links.length}: ${link.url}`);
            const pdfText = await parsePdf(link.url, link.referer);
            if (pdfText.trim()) {
                allText += "\n\n[PDF:" + link.url + "]\n" + pdfText;
                console.log(`✅ PDF parsed. Added ${pdfText.length} chars`);
            } else {
                console.log("PDF returned no text");
            }
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

        console.log("\nExtracting with OpenAI...");

        const extracted = await extractCardDetails(allText);

        if (!extracted) {
            console.log("Extraction failed or returned empty data");
            return;
        }

        console.log(`✅ Extraction OK. Card: ${extracted.card_name || 'Unknown'} | Offers: ${extracted.offers?.length || 0}`);

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
        const offers = Array.isArray(extracted.offers) ? extracted.offers : [];
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
            const payload = {
                ...extracted,
                offers: cardOffers,
                extraction_timestamp: new Date().toISOString(),
                total_offers: cardOffers.length
            };

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
// src/index.js - Debug version with detailed logging
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

const START_URL = "https://www.hdfcbank.com/personal/pay/cards/credit-cards/diners-privilege";

async function run() {
    console.log("🚀 Starting HDFC Diners Club Privilege scraper...");
    console.log("🎯 Target URL:", START_URL);

    try {
        // Check for OpenAI API key first
        console.log("🔑 Checking OpenAI API key...");
        if (!process.env.OPENAI_API_KEY) {
            console.error('❌ OPENAI_API_KEY not found in environment variables');
            console.log('💡 Please create a .env file with: OPENAI_API_KEY=your_key_here');
            process.exit(1);
        }
        console.log("✅ OpenAI API key found");

        // Test network connectivity
        console.log("🌐 Testing network connectivity...");

        console.log("📡 Starting crawl process...");
        const {
            text,
            links
        } = await crawlWithinScope(START_URL, 2, {
            pageLimit: 12,
            pdfLimit: 12,
            pathMustContain: "/personal/pay/cards/credit-cards/diners-privilege",
        });

        console.log(`📊 Crawl completed - Text length: ${text.length} characters`);
        console.log(`📄 Found ${links.length} PDF links`);

        if (!text || text.length === 0) {
            console.error("❌ No content extracted from crawling");
            console.log("🔍 This could mean:");
            console.log("  - Network connectivity issues");
            console.log("  - Website blocking requests");
            console.log("  - Invalid URL or path filters");
            process.exit(1);
        }

        let allText = text;

        // Process PDFs with deduplication
        const seenPdf = new Set();
        let pdfCount = 0;

        for (const link of links) {
            if (link.type !== "pdf") continue;
            if (seenPdf.has(link.url)) continue;
            seenPdf.add(link.url);

            console.log(`📄 Processing PDF ${++pdfCount}/${links.length}: ${link.url}`);
            const pdfText = await parsePdf(link.url, link.referer);
            if (pdfText.trim()) {
                allText += "\n\n[PDF:" + link.url + "]\n" + pdfText;
                console.log(`✅ PDF processed, added ${pdfText.length} characters`);
            } else {
                console.log("⚠️ PDF processing returned empty content");
            }
        }

        // Ensure data directory exists
        if (!fs.existsSync("./data")) {
            fs.mkdirSync("./data", {
                recursive: true
            });
            console.log("📁 Created data directory");
        }

        // Save raw content
        try {
            fs.writeFileSync("./data/output.txt", allText, "utf8");
            console.log(`💾 Saved raw output to ./data/output.txt (${allText.length} characters)`);
        } catch (error) {
            console.error("❌ Failed to save raw output:", error.message);
            process.exit(1);
        }

        // Extract structured data using OpenAI
        console.log("🤖 Starting OpenAI extraction...");
        console.log(`📝 Sending ${allText.length} characters to OpenAI`);

        const extracted = await extractCardDetails(allText);

        if (!extracted) {
            console.warn("⚠️ No structured data extracted from OpenAI");
            console.log("🔍 Possible issues:");
            console.log("  - OpenAI API key invalid");
            console.log("  - Content too large or malformed");
            console.log("  - OpenAI service temporarily unavailable");
            console.log("  - Check ./data/output.txt to verify scraped content");
            return;
        }

        console.log(`✅ Successfully extracted data for: ${extracted.card_name || 'Unknown Card'}`);
        console.log(`📊 Found ${extracted.offers?.length || 0} offers`);

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
            console.log(`📁 Created issuer directory: ${issuerDir}`);
        }

        // Process card-wise offers
        const offers = Array.isArray(extracted.offers) ? extracted.offers : [];
        const cardToOffers = {};

        for (const offer of offers) {
            const cards = Array.isArray(offer.card_applicability) ? offer.card_applicability : [];
            for (const c of cards) {
                const key = String(c || cardNameSafe).replace(/[^a-z0-9]+/gi, "_").toLowerCase();
                if (!cardToOffers[key]) cardToOffers[key] = [];
                cardToOffers[key].push(offer);
            }
        }

        // Ensure main card has all offers if no specific applicability
        if (!cardToOffers[cardNameSafe]) {
            cardToOffers[cardNameSafe] = offers;
        }

        // Save card-specific JSON files
        let savedFiles = 0;
        for (const [cardKey, cardOffers] of Object.entries(cardToOffers)) {
            const target = path.join(issuerDir, `${cardKey}.json`);
            const payload = {
                ...extracted,
                offers: cardOffers,
                extraction_timestamp: new Date().toISOString(),
                total_offers: cardOffers.length
            };

            try {
                fs.writeFileSync(target, JSON.stringify(payload, null, 2), "utf8");
                console.log(`💾 Saved ${cardOffers.length} offers to ${target}`);
                savedFiles++;
            } catch (error) {
                console.error(`❌ Failed to save ${target}:`, error.message);
            }
        }

        console.log(`🎉 Scraping completed successfully! Saved ${savedFiles} files.`);

    } catch (error) {
        console.error("❌ Application error:", error.message);
        console.error("📍 Error stack:", error.stack);
        process.exit(1);
    }
}

// Add process handlers for better debugging
process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
    process.exit(1);
});

process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error);
    process.exit(1);
});

// Create .env file template if it doesn't exist
if (!fs.existsSync('.env')) {
    const envTemplate = `# OpenAI API Configuration
OPENAI_API_KEY=your_openai_api_key_here

# Optional: Adjust these if needed
# MAX_TOKENS=4000
# TEMPERATURE=0`;

    try {
        fs.writeFileSync('.env', envTemplate);
        console.log('📝 Created .env template file. Please add your OpenAI API key.');
    } catch (error) {
        console.error('❌ Could not create .env file:', error.message);
    }
}

console.log("🔧 Debug mode enabled - Starting application...");
run().catch(error => {
    console.error("❌ Fatal error in main function:", error);
    process.exit(1);
});
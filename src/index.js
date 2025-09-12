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

const START_URL =
    "https://www.hdfcbank.com/personal/pay/cards/credit-cards/diners-privilege";

async function run() {
    console.log("🚀 Starting crawler for:", START_URL);

    const {
        text,
        links
    } = await crawlWithinScope(START_URL, 2, {
        pageLimit: 12,
        pdfLimit: 12,
        pathMustContain: "/personal/pay/cards/credit-cards/diners-privilege",
    });

    let allText = text;

    // Process PDFs (respect referer when available) with dedupe
    const seenPdf = new Set();
    for (const link of links) {
        if (link.type !== "pdf") continue;
        if (seenPdf.has(link.url)) continue;
        seenPdf.add(link.url);
        console.log("📄 Found PDF:", link.url);
        const pdfText = await parsePdf(link.url, link.referer);
        allText += "\n\n[PDF:" + link.url + "]\n" + pdfText;
    }

    if (!fs.existsSync("./data")) {
        fs.mkdirSync("./data");
    }
    fs.writeFileSync("./data/output.txt", allText, "utf8");
    console.log("\n💾 Saved raw output to ./data/output.txt");

    // Run OpenAI extraction on the aggregated content
    const extracted = await extractCardDetails(allText);
    if (!extracted) {
        console.warn("⚠️ No structured data extracted. Check OpenAI API key and content.");
        return;
    }

    // Segregate offers card-wise for issuer HDFC (and framework for AMEX etc.)
    const issuer = (
        (extracted.offers && extracted.offers[0] && extracted.offers[0].issuer) ||
        "HDFC"
    ).toLowerCase();
    const cardNameSafe = (extracted.card_name || "diners_privilege")
        .replace(/[^a-z0-9]+/gi, "_")
        .toLowerCase();


    const issuerDir = path.join("data", issuer);
    if (!fs.existsSync(issuerDir)) fs.mkdirSync(issuerDir, {
        recursive: true
    });

    // Split offers by card and write per-card JSON under issuer
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

    if (!cardToOffers[cardNameSafe]) cardToOffers[cardNameSafe] = offers;

    for (const [cardKey, cardOffers] of Object.entries(cardToOffers)) {
        const target = path.join(issuerDir, `${cardKey}.json`);
        const payload = {
            ...extracted,
            offers: cardOffers
        };
        fs.writeFileSync(target, JSON.stringify(payload, null, 2), "utf8");
        console.log(`💾 Wrote structured card data to ${target}`);
    }
}

run();
import {
    openai,
    cardSchema
} from "../config/ai.js";

// Function to split large content into manageable chunks
function splitContent(text, maxTokens = 15000) {
    const words = text.split(' ');
    const chunks = [];
    let currentChunk = '';

    for (const word of words) {
        // Rough estimation: 1 token ≈ 4 characters
        if ((currentChunk + word).length > maxTokens * 4) {
            if (currentChunk) {
                chunks.push(currentChunk.trim());
                currentChunk = word + ' ';
            }
        } else {
            currentChunk += word + ' ';
        }
    }

    if (currentChunk.trim()) {
        chunks.push(currentChunk.trim());
    }

    return chunks;
}
async function processSingleChunk(content) {
    try {
        return JSON.parse(content);
    } catch (e) {
        console.warn("⚠️ Model did not return valid JSON, attempting to fix...");

        // Try to extract JSON from response
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            try {
                return JSON.parse(jsonMatch[0]);
            } catch (e2) {
                console.error("❌ Could not parse JSON even after cleanup");
                console.log("Raw output:", content.substring(0, 500) + "...");
                return null;
            }
        }
        return null;
    }
}



async function processMultipleChunks(chunks) {
    const results = [];

    for (let i = 0; i < chunks.length; i++) {
        console.log(`🔄 Processing chunk ${i + 1}/${chunks.length}`);

        try {
            const chunkResult = await processSingleChunk(chunks[i]);
            if (chunkResult) {
                results.push(chunkResult);
            }

            // Add delay between API calls to avoid rate limits
            if (i < chunks.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }

        } catch (error) {
            console.warn(`⚠️ Failed to process chunk ${i + 1}:`, error.message);
            continue;
        }
    }

    // Merge results from multiple chunks
    if (results.length === 0) {
        return null;
    }

    return mergeChunkResults(results);
}

function mergeChunkResults(results) {
    const merged = {
        card_name: "HDFC Diners Club Privilege",
        issuer: "HDFC Bank",
        joining_fee: "",
        annual_fee: "",
        renewal_fee: "",
        eligibility: "",
        foreign_markup: "",
        credit_limit: "",
        rewards: [],
        welcome_benefits: [],
        milestone_benefits: [],
        other_benefits: [],
        terms_conditions_summary: "",
        summary: "",
        offers: []
    };

    // Merge data from all chunks
    for (const result of results) {
        // Use the first non-empty value for simple fields
        for (const field of ['joining_fee', 'annual_fee', 'renewal_fee', 'eligibility', 'foreign_markup', 'credit_limit', 'terms_conditions_summary', 'summary']) {
            if (!merged[field] && result[field]) {
                merged[field] = result[field];
            }
        }

        // Merge arrays (remove duplicates)
        for (const arrayField of ['rewards', 'welcome_benefits', 'milestone_benefits', 'other_benefits']) {
            if (result[arrayField] && Array.isArray(result[arrayField])) {
                for (const item of result[arrayField]) {
                    if (!merged[arrayField].includes(item)) {
                        merged[arrayField].push(item);
                    }
                }
            }
        }

        // Merge offers (remove duplicates by title)
        if (result.offers && Array.isArray(result.offers)) {
            for (const offer of result.offers) {
                const existingOffer = merged.offers.find(o => o.title === offer.title);
                if (!existingOffer) {
                    merged.offers.push(offer);
                }
            }
        }
    }

    console.log(`✅ Merged ${results.length} chunk results into final data`);
    return merged;
}

export async function extractCardDetails(rawText) {
    try {
        console.log(`📝 Processing content of ${rawText.length} characters`);

        // Check if content is too large for single API call
        const chunks = splitContent(rawText, 15000);

        if (chunks.length > 1) {
            console.log(`📑 Splitting content into ${chunks.length} chunks`);
            return await processMultipleChunks(chunks);
        } else {
            return await processSingleChunk(rawText);
        }

    } catch (err) {
        console.error("❌ OpenAI extraction failed:", err.message);

        // If it's a token limit error, try splitting the content
        if (err.message.includes('maximum context length') || err.message.includes('tokens')) {
            console.log("🔄 Retrying with smaller chunks due to token limit...");
            const smallerChunks = splitContent(rawText, 10000);
            return await processMultipleChunks(smallerChunks);
        }

        return null;
    }
}

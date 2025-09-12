import {
    openai,
    cardSchema
} from "../config/ai.js";


// Function to split large content into manageable chunks
function splitContent(text, maxTokens = 4000) { // Much smaller chunks to avoid token limits
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

function sanitizeToJsonString(input) {
    let s = String(input || "");
    // Normalize smart quotes to straight quotes
    s = s.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
    // Strip line and block comments
    s = s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    // Remove markdown fences if any
    s = s.replace(/```json\s*([\s\S]*?)\s*```/gi, '$1').replace(/```\s*([\s\S]*?)\s*```/g, '$1');
    // Trim extraneous text outside the outermost JSON braces
    const jsonMatch = s.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (jsonMatch) s = jsonMatch[0];
    // Ensure property names are quoted
    s = s.replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_\-]*)\s*:/g, '$1"$2":');
    // Convert single-quoted strings to double-quoted strings safely
    s = s.replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, '"$1"');
    // Remove trailing commas before } or ]
    s = s.replace(/,\s*(?=[}\]])/g, '');
    // Collapse illegal control whitespace
    s = s.replace(/\u0000|\u0001|\u0002|\u0003|\u0004|\u0005|\u0006|\u0007|\u0008|\u000B|\u000C|\u000E|\u000F/g, '');
    return s.trim();
}

async function processSingleChunk(content) {
    try {
        console.log("Calling OpenAI API...");

        const completion = await openai.chat.completions.create({
            model: "gpt-3.5-turbo",
            messages: [{
                    role: "system",
                    content: cardSchema
                },
                {
                    role: "user",
                    content: `Extract credit card details from this content:\n\n${content}`
                }
            ],
            temperature: 0,
            max_tokens: 2500 // Reduced to leave more room for context
        });


        const response = completion.choices[0]?.message?.content?.trim();
        if (!response) {
            console.warn("OpenAI returned empty response");
            return null;
        }

        console.log("OpenAI API response received");

        // Try to clean up the response before parsing
        let cleanResponse = sanitizeToJsonString(response);

        try {
            return JSON.parse(cleanResponse);
        } catch (parseError) {
            console.warn(" JSON parsing failed, applying sanitization...");
            let fixedResponse = sanitizeToJsonString(cleanResponse);

            try {
                return JSON.parse(fixedResponse);
            } catch (fixError) {
                console.error("Could not parse JSON even after cleanup attempts");
                console.log("Original response:", response.substring(0, 500) + "...");
                throw parseError;
            }
        }

    } catch (e) {
        console.warn(" OpenAI API call failed:", e.message);

        // If it's a JSON parsing error, try to extract JSON from the response
        if (e.message && typeof e.message === 'string') {
            const jsonMatch = e.message.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                try {
                    console.log("Attempting to parse extracted JSON...");
                    const sanitized = sanitizeToJsonString(jsonMatch[0]);
                    return JSON.parse(sanitized);
                } catch (e2) {
                    console.error("Could not parse JSON even after cleanup");
                    return null;
                }
            }
        }

        // If it's an API error, log more details
        if (e.status || e.code) {
            console.error(`OpenAI API Error - Status: ${e.status}, Code: ${e.code}`);
        }

        return null;
    }
}



async function processMultipleChunks(chunks) {
    const results = [];

    // Limit to first 3 chunks as requested to avoid excessive API usage
    const chunksToProcess = chunks.slice(0, 3);
    console.log(` Processing first ${chunksToProcess.length} chunks out of ${chunks.length} total`);

    for (let i = 0; i < chunksToProcess.length; i++) {
        console.log(`Processing chunk ${i + 1}/${chunksToProcess.length}`);

        try {
            const chunkResult = await processSingleChunk(chunksToProcess[i]);
            if (chunkResult) {
                results.push(chunkResult);
            }

            // Add delay between API calls to avoid rate limits
            if (i < chunksToProcess.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }

        } catch (error) {
            console.warn(`Failed to process chunk ${i + 1}:`, error.message);
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
        card_category: "Premium Credit Card",
        card_type: "Diners Club",
        fees_and_charges: {
            joining_fee: "",
            annual_fee: "",
            renewal_fee: "",
            foreign_markup: "",
            late_payment_fee: "",
            overlimit_fee: ""
        },
        eligibility_criteria: {
            salaried: {
                age_range: "",
                minimum_income: "",
                other_requirements: []
            },
            self_employed: {
                age_range: "",
                minimum_income: "",
                other_requirements: []
            }
        },
        credit_details: {
            credit_limit: "",
            interest_free_period: "",
            revolving_credit: ""
        },
        rewards_program: {
            earning_structure: [],
            redemption_options: [],
            redemption_rates: {
                smartbuy: "",
                dining_catalogue: "",
                cashback: "",
                exclusive_catalogue: ""
            }
        },
        welcome_benefits: [],
        milestone_benefits: [],
        travel_benefits: {
            lounge_access: {
                domestic: "",
                international: "",
                frequency: ""
            },
            travel_insurance: {
                air_accident_cover: "",
                overseas_hospitalization: "",
                baggage_delay: "",
                credit_liability: ""
            },
            concierge_services: ""
        },
        dining_entertainment_benefits: [],
        other_benefits: [],
        terms_and_conditions: {
            general_terms: "",
            offer_terms: "",
            fee_terms: "",
            reward_terms: ""
        },
        summary: "",
        offers: []
    };

    // Merge data from all chunks
    for (const result of results) {
        // Merge simple fields
        for (const field of ['card_name', 'issuer', 'card_category', 'card_type', 'summary']) {
            if (!merged[field] && result[field]) {
                merged[field] = result[field];
            }
        }

        // Merge nested objects
        if (result.fees_and_charges) {
            Object.assign(merged.fees_and_charges, result.fees_and_charges);
        }
        if (result.eligibility_criteria) {
            Object.assign(merged.eligibility_criteria, result.eligibility_criteria);
        }
        if (result.credit_details) {
            Object.assign(merged.credit_details, result.credit_details);
        }
        if (result.rewards_program) {
            if (result.rewards_program.earning_structure) {
                merged.rewards_program.earning_structure = [...new Set([...merged.rewards_program.earning_structure, ...result.rewards_program.earning_structure])];
            }
            if (result.rewards_program.redemption_options) {
                merged.rewards_program.redemption_options = [...new Set([...merged.rewards_program.redemption_options, ...result.rewards_program.redemption_options])];
            }
            if (result.rewards_program.redemption_rates) {
                Object.assign(merged.rewards_program.redemption_rates, result.rewards_program.redemption_rates);
            }
        }
        if (result.travel_benefits) {
            if (result.travel_benefits.lounge_access) {
                Object.assign(merged.travel_benefits.lounge_access, result.travel_benefits.lounge_access);
            }
            if (result.travel_benefits.travel_insurance) {
                Object.assign(merged.travel_benefits.travel_insurance, result.travel_benefits.travel_insurance);
            }
            if (result.travel_benefits.concierge_services) {
                merged.travel_benefits.concierge_services = result.travel_benefits.concierge_services;
            }
        }
        if (result.terms_and_conditions) {
            Object.assign(merged.terms_and_conditions, result.terms_and_conditions);
        }

        // Merge arrays (remove duplicates)
        for (const arrayField of ['welcome_benefits', 'milestone_benefits', 'dining_entertainment_benefits', 'other_benefits']) {
            if (result[arrayField] && Array.isArray(result[arrayField])) {
                for (const item of result[arrayField]) {
                    const existingItem = merged[arrayField].find(existing =>
                        JSON.stringify(existing) === JSON.stringify(item)
                    );
                    if (!existingItem) {
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

    console.log(`Merged ${results.length} chunk results into final data`);
    return merged;
}

export async function extractCardDetails(rawText) {
    try {
        console.log(` Processing content of ${rawText.length} characters`);

        // Check if content is too large for single API call
        const chunks = splitContent(rawText, 4000); // Use smaller chunks

        if (chunks.length > 1) {
            console.log(` Splitting content into ${chunks.length} chunks`);
            return await processMultipleChunks(chunks);
        } else {
            return await processSingleChunk(rawText);
        }

    } catch (err) {
        console.error(" OpenAI extraction failed:", err.message);

        // If it's a token limit error, try splitting the content
        if (err.message.includes('maximum context length') || err.message.includes('tokens')) {
            console.log(" Retrying with smaller chunks due to token limit...");
            const smallerChunks = splitContent(rawText, 2500); // Very small chunks for retry
            return await processMultipleChunks(smallerChunks);
        }

        return null;
    }
}
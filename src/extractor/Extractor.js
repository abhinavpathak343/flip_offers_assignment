import {
    openai,
    cardSchema
} from "../config/ai.js";


// Function to split large content into manageable chunks
function splitContent(text, maxTokens = 400) { // Small chunks for OpenAI
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
    s = s.replace(/[""]/g, '"').replace(/['']/g, "'");

    // Strip line and block comments
    s = s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

    // Remove markdown fences if any
    s = s.replace(/```json\s*([\s\S]*?)\s*```/gi, '$1').replace(/```\s*([\s\S]*?)\s*```/g, '$1');

    // Trim extraneous text outside the outermost JSON braces
    const jsonMatch = s.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (jsonMatch) s = jsonMatch[0];

    // Handle truncated JSON by finding the last complete object/array
    if (s.includes('...') || s.endsWith(',')) {
        // Find the last complete closing brace or bracket
        let lastCompleteIndex = -1;
        let braceCount = 0;
        let bracketCount = 0;
        let inString = false;
        let escapeNext = false;

        for (let i = 0; i < s.length; i++) {
            const char = s[i];

            if (escapeNext) {
                escapeNext = false;
                continue;
            }

            if (char === '\\') {
                escapeNext = true;
                continue;
            }

            if (char === '"' && !escapeNext) {
                inString = !inString;
                continue;
            }

            if (!inString) {
                if (char === '{') braceCount++;
                else if (char === '}') braceCount--;
                else if (char === '[') bracketCount++;
                else if (char === ']') bracketCount--;

                // If we're back to 0, we have a complete structure
                if (braceCount === 0 && bracketCount === 0) {
                    lastCompleteIndex = i;
                }
            }
        }

        if (lastCompleteIndex > 0) {
            s = s.substring(0, lastCompleteIndex + 1);
        }
    }

    // Ensure property names are quoted
    s = s.replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_\-]*)\s*:/g, '$1"$2":');

    // Convert single-quoted strings to double-quoted strings safely
    s = s.replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, '"$1"');

    // Remove trailing commas before } or ]
    s = s.replace(/,\s*(?=[}\]])/g, '');

    // Fix common JSON issues
    s = s.replace(/,\s*,/g, ','); // Remove double commas
    s = s.replace(/:\s*,/g, ': null,'); // Add null for missing values
    s = s.replace(/,\s*}/g, '}'); // Remove trailing commas before closing braces
    s = s.replace(/,\s*]/g, ']'); // Remove trailing commas before closing brackets

    // Collapse illegal control whitespace
    s = s.replace(/\u0000|\u0001|\u0002|\u0003|\u0004|\u0005|\u0006|\u0007|\u0008|\u000B|\u000C|\u000E|\u000F/g, '');

    return s.trim();
}

// Extract partial data from malformed JSON
function extractPartialJsonData(malformedJson) {
    try {
        const result = {};

        // Extract basic card information using regex
        const cardNameMatch = malformedJson.match(/"card_name"\s*:\s*"([^"]+)"/);
        if (cardNameMatch) result.card_name = cardNameMatch[1];

        const issuerMatch = malformedJson.match(/"issuer"\s*:\s*"([^"]+)"/);
        if (issuerMatch) result.issuer = issuerMatch[1];

        const cardCategoryMatch = malformedJson.match(/"card_category"\s*:\s*"([^"]+)"/);
        if (cardCategoryMatch) result.card_category = cardCategoryMatch[1];

        const cardTypeMatch = malformedJson.match(/"card_type"\s*:\s*"([^"]+)"/);
        if (cardTypeMatch) result.card_type = cardTypeMatch[1];

        // Extract fees and charges
        const feesMatch = malformedJson.match(/"fees_and_charges"\s*:\s*\{([^}]+)\}/);
        if (feesMatch) {
            result.fees_and_charges = {};
            const feesContent = feesMatch[1];

            const annualFeeMatch = feesContent.match(/"annual_fee"\s*:\s*"([^"]+)"/);
            if (annualFeeMatch) result.fees_and_charges.annual_fee = annualFeeMatch[1];

            const renewalFeeMatch = feesContent.match(/"renewal_fee"\s*:\s*"([^"]+)"/);
            if (renewalFeeMatch) result.fees_and_charges.renewal_fee = renewalFeeMatch[1];

            const foreignMarkupMatch = feesContent.match(/"foreign_markup"\s*:\s*"([^"]+)"/);
            if (foreignMarkupMatch) result.fees_and_charges.foreign_markup = foreignMarkupMatch[1];
        }

        // Extract offers array
        const offersMatch = malformedJson.match(/"offers"\s*:\s*\[([^\]]+)\]/);
        if (offersMatch) {
            result.offers = [];
            // Try to extract individual offer objects
            const offersContent = offersMatch[1];
            const offerMatches = offersContent.match(/\{[^}]*"title"[^}]*\}/g);
            if (offerMatches) {
                offerMatches.forEach(offerStr => {
                    try {
                        const offer = JSON.parse(offerStr);
                        result.offers.push(offer);
                    } catch (e) {
                        // Skip malformed individual offers
                    }
                });
            }
        }

        // Set default values for missing fields
        if (!result.offers) result.offers = [];
        if (!result.fees_and_charges) result.fees_and_charges = {};
        if (!result.eligibility_criteria) result.eligibility_criteria = {};
        if (!result.credit_details) result.credit_details = {};
        if (!result.rewards_program) result.rewards_program = {};
        if (!result.travel_benefits) result.travel_benefits = {};
        if (!result.terms_and_conditions) result.terms_and_conditions = {};

        return result;
    } catch (error) {
        console.warn("Partial JSON extraction failed:", error.message);
        return null;
    }
}

async function processSingleChunk(content) {
    const maxRetries = 3;
    let lastError;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            console.log(`Calling OpenAI API... (attempt ${attempt}/${maxRetries})`);

            const completion = await openai.chat.completions.create({
                model: "gpt-4o-mini",
                messages: [{
                        role: "system",
                        content: cardSchema
                    },
                    {
                        role: "user",
                        content: `Extract credit card details from this content:\n\n${content}`
                    }
                ],
                temperature: 0.3,
                max_tokens: 2000
            });

            const response = completion.choices[0]?.message?.content?.trim();
            if (!response) {
                console.warn(`OpenAI returned empty response on attempt ${attempt}`);
                if (attempt < maxRetries) {
                    await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
                    continue;
                }
                return null;
            }

            console.log("OpenAI API response received");

            // Try to clean up the response before parsing
            let cleanResponse = sanitizeToJsonString(response);

            try {
                return JSON.parse(cleanResponse);
            } catch (parseError) {
                console.warn("JSON parsing failed, applying enhanced sanitization...");
                let fixedResponse = sanitizeToJsonString(cleanResponse);

                try {
                    return JSON.parse(fixedResponse);
                } catch (fixError) {
                    console.warn("Enhanced sanitization failed, trying partial extraction...");

                    // Try to extract partial data from malformed JSON
                    try {
                        const partialData = extractPartialJsonData(cleanResponse);
                        if (partialData && Object.keys(partialData).length > 0) {
                            console.log("Successfully extracted partial data from malformed JSON");
                            return partialData;
                        }
                    } catch (partialError) {
                        console.warn("Partial extraction also failed:", partialError.message);
                    }

                    console.error("Could not parse JSON even after all cleanup attempts");
                    console.log("Original response (first 500 chars):", response.substring(0, 500) + "...");
                    return null; // Return null instead of throwing to allow processing to continue
                }
            }

        } catch (e) {
            lastError = e;
            console.warn(`OpenAI API call failed on attempt ${attempt}:`, e.message);

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
                    }
                }
            }

            // If it's an API error, log more details
            if (e.status || e.code) {
                console.error(`OpenAI API Error - Status: ${e.status}, Code: ${e.code}`);
            }

            if (attempt < maxRetries) {
                console.log(`Retrying in ${1000 * attempt}ms...`);
                await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
            }
        }
    }

    console.error(`Failed to process chunk after ${maxRetries} attempts:`, lastError ?.message);
    return null;
}



async function processMultipleChunks(chunks) {
    // Process fewer chunks to avoid API overload
    const chunksToProcess = chunks.slice(0, 3); // Reduced to 3 chunks
    console.log(` Processing first ${chunksToProcess.length} chunks out of ${chunks.length} total`);

    // Run OpenAI calls in parallel to reduce overall latency
    const settled = await Promise.allSettled(
        chunksToProcess.map((c, idx) => {
            console.log(`Queueing chunk ${idx + 1}/${chunksToProcess.length}`);
            return processSingleChunk(c);
        })
    );

    const results = settled
        .filter(r => r.status === 'fulfilled' && r.value)
        .map(r => r.value);

    if (results.length === 0) return null;
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

        // Use small chunks for OpenAI
        const chunks = splitContent(rawText, 400);

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
            const smallerChunks = splitContent(rawText, 300); // Even smaller chunks for retry
            return await processMultipleChunks(smallerChunks);
        }

        return null;
    }
}

// Brand-keyed offer extraction
const brandOfferSchema = `You extract specific merchant/brand offers from credit card content and return ONLY valid JSON.

CRITICAL: Create separate entries for EACH specific brand/merchant mentioned. Do NOT group everything under "HDFC Bank".

Return ONLY valid JSON with this exact structure:
{
  "Swiggy": {
    "validity": "validity period",
    "offer description": "specific Swiggy offer details",
    "t&c": "Swiggy-specific terms"
  },
  "BookMyShow": {
    "validity": "validity period", 
    "offer description": "specific BookMyShow offer details",
    "t&c": "BookMyShow-specific terms"
  },
  "Adidas": {
    "validity": "validity period",
    "offer description": "specific Adidas offer details", 
    "t&c": "Adidas-specific terms"
  }
}

RULES:
- Extract ONLY specific merchant/brand offers (Swiggy, Zomato, BookMyShow, Adidas, Fortis, Marriott, Decathlon, etc.)
- Create separate JSON entries for each brand
- Do NOT create generic entries like "HDFC Bank" or "Diners Club" 
- Focus on merchant-specific offers, discounts, cashback, rewards
- If no specific brand offers found, return empty object {}
- Include spending requirements, discount percentages, validity periods
- Extract terms specific to each merchant
`;

// Extract partial brand data from malformed JSON
function extractPartialBrandData(malformedJson) {
    try {
        const result = {};

        // Look for brand objects in the malformed JSON
        const brandMatches = malformedJson.match(/"([^"]+)"\s*:\s*\{[^}]*"validity"[^}]*\}/g);
        if (brandMatches) {
            brandMatches.forEach(brandStr => {
                try {
                    // Extract brand name
                    const brandNameMatch = brandStr.match(/"([^"]+)"\s*:\s*\{/);
                    if (brandNameMatch) {
                        const brandName = brandNameMatch[1];

                        // Extract validity
                        const validityMatch = brandStr.match(/"validity"\s*:\s*"([^"]+)"/);
                        const validity = validityMatch ? validityMatch[1] : "";

                        // Extract offer description
                        const descMatch = brandStr.match(/"offer description"\s*:\s*"([^"]+)"/);
                        const description = descMatch ? descMatch[1] : "";

                        // Extract terms
                        const termsMatch = brandStr.match(/"t&c"\s*:\s*"([^"]+)"/);
                        const terms = termsMatch ? termsMatch[1] : "";

                        result[brandName] = {
                            "validity": validity,
                            "offer description": description,
                            "t&c": terms
                        };
                    }
                } catch (e) {
                    // Skip malformed brand entries
                }
            });
        }

        return result;
    } catch (error) {
        console.warn("Partial brand extraction failed:", error.message);
        return null;
    }
}

async function processSingleBrandChunk(content) {
    const maxRetries = 3;
    let lastError;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            console.log(`Calling OpenAI API for brand extraction... (attempt ${attempt}/${maxRetries})`);

            const completion = await openai.chat.completions.create({
                model: "gpt-4o-mini",
                messages: [{
                        role: "system",
                        content: brandOfferSchema
                    },
                    {
                        role: "user",
                        content: `Build the brand-keyed offers JSON from this content. Respond with ONLY JSON.\n\n${content}`
                    }
                ],
                temperature: 0.3,
                max_tokens: 1000
            });

            const response = completion.choices[0]?.message?.content?.trim();
            if (!response) {
                console.warn(`OpenAI returned empty response for brand extraction on attempt ${attempt}`);
                if (attempt < maxRetries) {
                    await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
                    continue;
                }
                return null;
            }

            const clean = sanitizeToJsonString(response);

            try {
                return JSON.parse(clean);
            } catch (parseError) {
                console.warn("Brand extraction JSON parsing failed, trying partial extraction...");
                // For brand extraction, try to extract any valid brand objects
                try {
                    const partialBrands = extractPartialBrandData(clean);
                    if (partialBrands && Object.keys(partialBrands).length > 0) {
                        return partialBrands;
                    }
                } catch (partialError) {
                    console.warn("Partial brand extraction failed:", partialError.message);
                }
                return null;
            }

        } catch (e) {
            lastError = e;
            console.warn(`Brand-offer chunk extraction failed on attempt ${attempt}:`, e.message);

            if (attempt < maxRetries) {
                console.log(`Retrying brand extraction in ${1000 * attempt}ms...`);
                await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
            }
        }
    }

    console.error(`Failed to process brand chunk after ${maxRetries} attempts:`,lastError?.message);
    return null;
}

function mergeBrandMaps(maps) {
    const merged = {};
    for (const m of maps) {
        if (!m || typeof m !== 'object') continue;
        for (const [brandKey, val] of Object.entries(m)) {
            const brand = String(brandKey).trim();
            const validity = String(val ?.["validity"] || "").trim();
            const desc = String(val ?.["offer description"] || "").trim();
            const terms = String(val ?.["t&c"] || "").trim();

            if (!merged[brand]) {
                merged[brand] = {
                    "validity": validity,
                    "offer description": desc,
                    "t&c": terms
                };
            } else {
                const join = (a, b) => [a, b].filter(Boolean).join(" | ");
                merged[brand]["validity"] = join(merged[brand]["validity"], validity);
                merged[brand]["offer description"] = join(merged[brand]["offer description"], desc);
                merged[brand]["t&c"] = join(merged[brand]["t&c"], terms);
            }
        }
    }
    return merged;
}

export async function extractBrandOffers(rawText) {
    try {
        const chunks = splitContent(rawText, 400); // Small chunks for brand extraction
        const chunksToProcess = chunks.slice(0, 3); // Reduced to 3 chunks

        // Process chunks sequentially with early termination
        const maps = [];
        for (let i = 0; i < chunksToProcess.length; i++) {
            console.log(`Processing brand chunk ${i + 1}/${chunksToProcess.length}`);
            const result = await processSingleBrandChunk(chunksToProcess[i]);
            if (result) {
                maps.push(result);

                // Early termination: if we have 5+ brands, we likely have enough
                const merged = mergeBrandMaps(maps);
                if (Object.keys(merged).length >= 5) {
                    console.log(`Early termination: Found ${Object.keys(merged).length} brands`);
                    return merged;
                }
            }
        }

        if (maps.length === 0) return null;
        return mergeBrandMaps(maps);
    } catch (e) {
        console.warn(" extractBrandOffers failed:", e.message);
        return null;
    }
}
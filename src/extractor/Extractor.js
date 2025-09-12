// src/extractor/Extractor.js
import {
    openai,
    cardSchema
} from "../config/ai.js";

export async function extractCardDetails(rawText) {
    try {
        const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            temperature: 0,
            messages: [{
                    role: "system",
                    content: cardSchema
                },
                {
                    role: "user",
                    content: "Extract and summarize details for the HDFC Diners Club Privilege Credit Card from the following content. Keep only this card if multiple are present.\n\n" +
                        rawText,
                },
            ],
        });

        const output = response.choices && response.choices[0] && response.choices[0].message && response.choices[0].message.content
            ? response.choices[0].message.content
            : "";

        // Try parsing JSON
        try {
            return JSON.parse(output);
        } catch (e) {
            console.warn("⚠️ Model did not return valid JSON, raw output:", output);
            return null;
        }
    } catch (err) {
        console.error("❌ OpenAI extraction failed:", err.message);
        return null;
    }
}
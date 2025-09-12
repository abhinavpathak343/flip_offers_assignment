// src/config/ai.js
import OpenAI from "openai";
import "dotenv/config";

export const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// schema you want for extraction
export const cardSchema = `
You are an assistant that extracts structured details from messy credit card descriptions.
Return ONLY valid JSON in this exact format:
{
  "card_name": string,
  "joining_fee": string,
  "annual_fee": string,
  "eligibility": string,
  "rewards": string[],
  "other_benefits": string[],
  "terms_conditions_summary": string,
  "summary": string,
  "offers": [
    {
      "issuer": string,
      "card_applicability": string[],
      "title": string,
      "description": string,
      "validity": string
    }
  ]
}
`;
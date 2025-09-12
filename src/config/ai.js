// src/config/ai.js - Fixed encoding issue and improved schema
import OpenAI from "openai";
import "dotenv/config";

export const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Enhanced schema for better extraction
export const cardSchema = `
You are an assistant that extracts structured details from credit card descriptions and web content.
Extract information specifically about the HDFC Diners Club Privilege Credit Card.
Return ONLY valid JSON in this exact format:

{
  "card_name": "HDFC Diners Club Privilege",
  "issuer": "HDFC Bank",
  "joining_fee": "amount with currency",
  "annual_fee": "amount with currency", 
  "renewal_fee": "amount with currency or waiver conditions",
  "eligibility": "eligibility criteria",
  "foreign_markup": "percentage",
  "credit_limit": "range or criteria",
  "rewards": [
    "reward point structure",
    "bonus categories",
    "redemption options"
  ],
  "welcome_benefits": [
    "sign-up bonuses",
    "complimentary memberships",
    "welcome offers"
  ],
  "milestone_benefits": [
    "quarterly spend rewards",
    "annual spend rewards"
  ],
  "other_benefits": [
    "lounge access details",
    "insurance coverage", 
    "concierge services",
    "dining benefits"
  ],
  "terms_conditions_summary": "key terms and conditions",
  "summary": "brief card overview",
  "offers": [
    {
      "issuer": "HDFC Bank",
      "card_applicability": ["Diners Club Privilege"],
      "offer_id": "unique_identifier",
      "title": "offer_title", 
      "description": "detailed_description",
      "category": "dining|travel|shopping|entertainment|cashback|rewards",
      "offer_type": "discount|cashback|reward_points|bogo|waiver",
      "discount_value": "percentage_or_amount",
      "minimum_spend": "minimum_amount_if_applicable",
      "maximum_benefit": "maximum_cap_if_applicable", 
      "validity": "validity_period",
      "merchant": "merchant_name",
      "applicable_days": "specific_days_if_applicable",
      "usage_limit": "monthly_or_annual_limits",
      "terms_conditions": [
        "key_condition_1",
        "key_condition_2"
      ]
    }
  ]
}

Focus on extracting:
1. BookMyShow Buy 1 Get 1 Free offers
2. 5X reward points on Swiggy/Zomato  
3. Welcome benefits (Swiggy One, Times Prime memberships)
4. Milestone rewards (₹1,500 vouchers on quarterly spend)
5. Airport lounge access details
6. Insurance coverage amounts
7. Reward point earning and redemption rates
8. Annual fee waiver conditions
9. Any merchant-specific offers
10. Terms and conditions for each offer

Ensure all monetary amounts include currency symbols (₹ for Indian Rupees).
`;
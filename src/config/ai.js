// src/config/ai.js - Fixed encoding issue and improved schema
import OpenAI from "openai";
import "dotenv/config";

export const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Enhanced schema for better extraction with detailed headings
export const cardSchema = `
You are an assistant that extracts structured details from credit card descriptions and web content.
Extract information specifically about the HDFC Diners Club Privilege Credit Card.
Return ONLY valid JSON in this exact format:

{
  "card_name": "HDFC Diners Club Privilege",
  "issuer": "HDFC Bank",
  "card_category": "Premium Credit Card",
  "card_type": "Diners Club",
  "fees_and_charges": {
    "joining_fee": "amount with currency",
    "annual_fee": "amount with currency", 
    "renewal_fee": "amount with currency or waiver conditions",
    "foreign_markup": "percentage",
    "late_payment_fee": "amount if mentioned",
    "overlimit_fee": "amount if mentioned"
  },
  "eligibility_criteria": {
    "salaried": {
      "age_range": "age criteria",
      "minimum_income": "monthly income requirement",
      "other_requirements": ["additional criteria"]
    },
    "self_employed": {
      "age_range": "age criteria", 
      "minimum_income": "annual income requirement",
      "other_requirements": ["additional criteria"]
    }
  },
  "credit_details": {
    "credit_limit": "range or criteria",
    "interest_free_period": "number of days",
    "revolving_credit": "availability and rate"
  },
  "rewards_program": {
    "earning_structure": [
      "reward point structure for general spends",
      "bonus categories and rates",
      "special earning opportunities"
    ],
    "redemption_options": [
      "flight bookings",
      "hotel bookings", 
      "dining redemptions",
      "cashback options",
      "gift vouchers"
    ],
    "redemption_rates": {
      "smartbuy": "rate per point",
      "dining_catalogue": "rate per point", 
      "cashback": "rate per point",
      "exclusive_catalogue": "rate per point"
    }
  },
  "welcome_benefits": [
    {
      "benefit_name": "benefit title",
      "description": "detailed description",
      "conditions": "spending requirements or conditions",
      "validity": "time period"
    }
  ],
  "milestone_benefits": [
    {
      "milestone_name": "benefit title",
      "description": "detailed description", 
      "spending_requirement": "amount to spend",
      "reward_value": "value of reward",
      "validity_period": "quarterly/annual"
    }
  ],
  "travel_benefits": {
    "lounge_access": {
      "domestic": "details about domestic lounge access",
      "international": "details about international lounge access",
      "frequency": "how often available"
    },
    "travel_insurance": {
      "air_accident_cover": "coverage amount",
      "overseas_hospitalization": "coverage amount", 
      "baggage_delay": "coverage amount",
      "credit_liability": "coverage amount"
    },
    "concierge_services": "details about concierge services"
  },
  "dining_entertainment_benefits": [
    {
      "benefit_name": "benefit title",
      "description": "detailed description",
      "merchant": "partner merchant",
      "discount_value": "discount percentage or amount",
      "conditions": "terms and conditions",
      "validity": "time period"
    }
  ],
  "other_benefits": [
    "contactless_payment": "details about contactless payment",
    "smart_emi": "details about EMI conversion",
    "exclusive_offers": "details about exclusive offers",
    "customer_care": "contact details and support"
  ],
  "terms_and_conditions": {
    "general_terms": "key general terms and conditions",
    "offer_terms": "terms specific to offers",
    "fee_terms": "terms related to fees and charges",
    "reward_terms": "terms related to rewards program"
  },
  "summary": "comprehensive card overview highlighting key features",
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
1. BookMyShow Buy 1 Get 1 Free offers with detailed terms
2. 5X reward points on Swiggy/Zomato with caps and conditions
3. Welcome benefits (Swiggy One, Times Prime memberships) with spending requirements
4. Milestone rewards (₹1,500 vouchers on quarterly spend) with specific details
5. Airport lounge access details (domestic/international)
6. Insurance coverage amounts (all types mentioned)
7. Reward point earning and redemption rates (all categories)
8. Annual fee waiver conditions with spending requirements
9. All merchant-specific offers with terms
10. Complete terms and conditions for each offer

Ensure all monetary amounts include currency symbols (₹ for Indian Rupees).
Extract information with proper categorization and detailed descriptions.
`;
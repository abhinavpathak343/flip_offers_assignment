# SBI Offers Scraper

This project scrapes retail offer details from the SBI Card website and saves them as JSON files.

## Features
- Crawls all public SBI Card offer pages
- Extracts offer title, description, validity, terms, and eligible cards
- Saves each offer as a JSON file in `data/sbi-offers/`

## Usage

1. Install dependencies:
   ```bash
   npm install
   ```
2. Run the scraper:
   ```bash
   node src/index.js
   ```

Scraped data will be available in the `data/sbi-offers/` directory.

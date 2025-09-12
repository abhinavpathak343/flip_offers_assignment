## flip_assignment

Minimal scraper that crawls HDFC credit card pages, discovers/reads PDFs in-memory, and extracts structured details via OpenAI.



### Setup
1. Install deps:
```
npm install
```
2. Configure environment:
```
echo OPENAI_API_KEY=your_key_here > .env
```

### Run
- Default URL (HDFC Diners Privilege):
```
node src/index.js
```
- Custom URL:
```
node src/index.js <url>
```

### Output
- Raw combined text: `data/output.txt`
- Extracted JSON: `data/<issuer>/<n>.json` (incremental filenames)

### Notes
- PDFs are not saved to disk; they are downloaded, parsed, and discarded.
- Logs show green ticks for key milestones (crawl, PDF downloaded/parsed, extraction, saves).

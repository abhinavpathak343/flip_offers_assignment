// test-connectivity.js - Quick test script
import axios from "axios";
import * as cheerio from "cheerio";
      import fs from 'fs';
async function testConnectivity() {
    const url = "https://www.hdfcbank.com/personal/pay/cards/credit-cards/diners-privilege";

    console.log("🔍 Testing connectivity to:", url);

    try {
        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5',
                'Accept-Encoding': 'gzip, deflate, br',
                'Connection': 'keep-alive',
                'Upgrade-Insecure-Requests': '1'
            },
            timeout: 30000,
            maxRedirects: 10
        });

        console.log(`✅ Response received - Status: ${response.status}`);
        console.log(`📏 Content length: ${response.data.length} characters`);

        const $ = cheerio.load(response.data);
        const title = $('title').text();
        console.log(`📄 Page title: "${title}"`);

        // Look for key content
        const bodyText = $('body').text().replace(/\s+/g, ' ').trim();
        console.log(`📝 Body text length: ${bodyText.length} characters`);

        if (bodyText.includes('Diners Club Privilege')) {
            console.log("✅ Found 'Diners Club Privilege' content");
        } else {
            console.log("⚠️ 'Diners Club Privilege' content not found");
        }

        // Look for PDFs
        const pdfLinks = [];
        $('a[href*=".pdf"], a[href*="PDF"]').each((_, el) => {
            const href = $(el).attr('href');
            if (href) pdfLinks.push(href);
        });

        console.log(`📄 Found ${pdfLinks.length} PDF links`);
        pdfLinks.forEach(link => console.log(`  - ${link}`));

        // Save a sample for inspection
  
        if (!fs.existsSync('./debug')) {
            fs.mkdirSync('./debug');
        }
        fs.writeFileSync('./debug/sample-page.html', response.data);
        fs.writeFileSync('./debug/sample-text.txt', bodyText);
        console.log("💾 Saved sample HTML and text to ./debug/ folder");

    } catch (error) {
        console.error("❌ Connection failed:", error.message);
        if (error.code === 'ECONNABORTED') {
            console.log("⏰ Request timed out - try increasing timeout or check network");
        } else if (error.response) {
            console.log(`📊 Response status: ${error.response.status}`);
            console.log(`📋 Response headers:`, error.response.headers);
        }
    }
}

testConnectivity();
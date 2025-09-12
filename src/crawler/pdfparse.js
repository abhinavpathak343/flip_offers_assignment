// src/crawler/pdfparse.js
import axios from "axios";
import pdfjsLib from "pdfjs-dist/legacy/build/pdf.js";


export async function parsePdf(url, referer = undefined) {
    try {
        console.log(`📄 Downloading PDF: ${url}`);

        const headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
            Accept: "application/pdf,application/octet-stream;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
            Referer: referer || url,
        };

        let lastError;
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                const response = await axios.get(url, {
                    responseType: "arraybuffer",
                    maxRedirects: 5,
                    headers,
                    // Some servers return 206/302 etc. Allow them and handle manually
                    validateStatus: (s) => s >= 200 && s < 400,
                });
                const dataBuffer = new Uint8Array(response.data);

                const pdfDoc = await pdfjsLib
                    .getDocument({
                        data: dataBuffer,
                        useWorkerFetch: false,
                        isEvalSupported: false,
                    })
                    .promise;

                let textContent = "";
                for (let i = 1; i <= pdfDoc.numPages; i++) {
                    const page = await pdfDoc.getPage(i);
                    const content = await page.getTextContent();
                    const pageText = content.items
                        .map((item) => item.str)
                        .join(" ");
                    textContent += `\n\n${pageText}`;
                }

                return textContent.trim();
            } catch (e) {
                lastError = e;
                const waitMs = 300 * attempt;
                await new Promise((r) => setTimeout(r, waitMs));
            }
        }
        throw lastError || new Error("Unknown PDF download error");
    } catch (err) {
        console.error(`❌ Failed to parse PDF ${url}:`, err.message);
        return "";
    }
}
import axios from "axios";
import pdfjsLib from "pdfjs-dist/legacy/build/pdf.js";

export async function parsePdf(url, referer = undefined) {
    try {
        console.log(`📄 Downloading PDF: ${url}`);

        const headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            "Accept": "application/pdf,application/octet-stream;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
            "Accept-Encoding": "gzip, deflate, br",
            "Connection": "keep-alive"
        };

        if (referer) {
            headers.Referer = referer;
        }

        let lastError;
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                console.log(`📥 PDF download attempt ${attempt}/3: ${url}`);

                const response = await axios.get(url, {
                    responseType: "arraybuffer",
                    maxRedirects: 5,
                    timeout: 30000, // 30 second timeout for PDFs
                    headers,
                    validateStatus: (s) => s >= 200 && s < 400,
                });

                console.log(`✅ PDF downloaded (${response.data.byteLength} bytes)`);
                const dataBuffer = new Uint8Array(response.data);

                const pdfDoc = await pdfjsLib
                    .getDocument({
                        data: dataBuffer,
                        useWorkerFetch: false,
                        isEvalSupported: false,
                        verbosity: 0 // Reduce PDF.js logging
                    })
                    .promise;

                console.log(`📖 PDF has ${pdfDoc.numPages} pages`);
                let textContent = "";

                // Limit to first 20 pages to avoid excessive processing
                const maxPages = Math.min(pdfDoc.numPages, 20);

                for (let i = 1; i <= maxPages; i++) {
                    try {
                        const page = await pdfDoc.getPage(i);
                        const content = await page.getTextContent();
                        const pageText = content.items
                            .map((item) => item.str)
                            .join(" ");
                        textContent += `\n\n[PAGE ${i}]\n${pageText}`;

                        if (i % 5 === 0) {
                            console.log(`📄 Processed ${i}/${maxPages} pages...`);
                        }
                    } catch (pageError) {
                        console.warn(`⚠️ Error processing page ${i}:`, pageError.message);
                        continue;
                    }
                }

                console.log(`✅ PDF processed: ${textContent.length} characters extracted`);
                return textContent.trim();

            } catch (e) {
                lastError = e;

                if (e.code === 'ECONNABORTED' || e.message.includes('timeout')) {
                    console.log(`⏰ PDF download timeout on attempt ${attempt}/3`);
                } else {
                    console.log(`⚠️ PDF download error on attempt ${attempt}/3: ${e.message}`);
                }

                if (attempt < 3) {
                    const waitMs = 2000 * attempt;
                    console.log(`⏳ Waiting ${waitMs}ms before retry...`);
                    await new Promise((r) => setTimeout(r, waitMs));
                }
            }
        }

        throw lastError || new Error("Unknown PDF download error");
    } catch (err) {
        console.error(`❌ Failed to parse PDF ${url}:`, err.message);
        return "";
    }
}
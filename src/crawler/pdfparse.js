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
            "Connection": "keep-alive",
            "Sec-Fetch-Dest": "document",
            "Sec-Fetch-Mode": "navigate",
            "Sec-Fetch-Site": "same-origin"
        };

        if (referer) {
            headers.Referer = referer;
        }
        try {
            const uForOrigin = new URL(url);
            headers.Origin = uForOrigin.origin;
            if (!headers.Referer) headers.Referer = uForOrigin.origin;
        } catch {}

        function buildLowercaseUrl(originalUrl) {
            const u = new URL(originalUrl);
            const loweredPath = u.pathname.toLowerCase();
            return new URL(u.origin + loweredPath + (u.search || ""));
        }

        function buildLowercaseDirsUrl(originalUrl) {
            const u = new URL(originalUrl);
            const parts = u.pathname.split('/');
            const file = parts.pop();
            const loweredDirs = parts.map(p => p.toLowerCase());
            const newPath = loweredDirs.join('/') + '/' + file;
            return new URL(u.origin + newPath + (u.search || ""));
        }

        function buildSlugifiedUrl(originalUrl) {
            const u = new URL(originalUrl);
            const decoded = decodeURIComponent(u.pathname);
            const parts = decoded.split('/').map(part => part
                .replace(/\s+/g, '-')
                .replace(/_/g, '-')
                .toLowerCase());
            const slugPath = parts.join('/');
            const finalPath = encodeURI(slugPath);
            return new URL(u.origin + finalPath + (u.search || ""));
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
                } else if (e.response && e.response.status === 404) {
                    // Final fallback: try lower-casing the path (HDFC often serves lowercase paths)
                    try {
                        const lowered = buildLowercaseUrl(url);
                        if (lowered.href !== url) {
                            console.log(`🔁 Retrying with lowercase path: ${lowered.href}`);
                            const resp2 = await axios.get(lowered.href, {
                                responseType: "arraybuffer",
                                maxRedirects: 5,
                                timeout: 30000,
                                headers,
                                validateStatus: (s) => s >= 200 && s < 400,
                            });
                            console.log(`✅ PDF downloaded (${resp2.data.byteLength} bytes) [lowercase path]`);
                            const dataBuffer2 = new Uint8Array(resp2.data);
                            const pdfDoc2 = await pdfjsLib.getDocument({
                                data: dataBuffer2,
                                useWorkerFetch: false,
                                isEvalSupported: false,
                                verbosity: 0
                            }).promise;
                            console.log(`📖 PDF has ${pdfDoc2.numPages} pages`);
                            let textContent2 = "";
                            const maxPages2 = Math.min(pdfDoc2.numPages, 20);
                            for (let i = 1; i <= maxPages2; i++) {
                                try {
                                    const page = await pdfDoc2.getPage(i);
                                    const content = await page.getTextContent();
                                    const pageText = content.items.map((item) => item.str).join(" ");
                                    textContent2 += `\n\n[PAGE ${i}]\n${pageText}`;
                                    if (i % 5 === 0) {
                                        console.log(`📄 Processed ${i}/${maxPages2} pages...`);
                                    }
                                } catch (pageError) {
                                    console.warn(`⚠️ Error processing page ${i}:`, pageError.message);
                                    continue;
                                }
                            }
                            console.log(`✅ PDF processed: ${textContent2.length} characters extracted`);
                            return textContent2.trim();
                        }
                    } catch (fallbackErr) {
                        console.log(`⚠️ Lowercase-path fallback failed: ${fallbackErr.message}`);
                    }

                    // Fallback: lowercase only directory segments, preserve filename case
                    try {
                        const loweredDirsOnly = buildLowercaseDirsUrl(url);
                        if (loweredDirsOnly.href !== url) {
                            console.log(`🔁 Retrying with lowercase directories: ${loweredDirsOnly.href}`);
                            const resp2b = await axios.get(loweredDirsOnly.href, {
                                responseType: "arraybuffer",
                                maxRedirects: 5,
                                timeout: 30000,
                                headers,
                                validateStatus: (s) => s >= 200 && s < 400,
                            });
                            console.log(`✅ PDF downloaded (${resp2b.data.byteLength} bytes) [lowercase dirs]`);
                            const dataBuffer2b = new Uint8Array(resp2b.data);
                            const pdfDoc2b = await pdfjsLib.getDocument({
                                data: dataBuffer2b,
                                useWorkerFetch: false,
                                isEvalSupported: false,
                                verbosity: 0
                            }).promise;
                            console.log(`📖 PDF has ${pdfDoc2b.numPages} pages`);
                            let textContent2b = "";
                            const maxPages2b = Math.min(pdfDoc2b.numPages, 20);
                            for (let i = 1; i <= maxPages2b; i++) {
                                try {
                                    const page = await pdfDoc2b.getPage(i);
                                    const content = await page.getTextContent();
                                    const pageText = content.items.map((item) => item.str).join(" ");
                                    textContent2b += `\n\n[PAGE ${i}]\n${pageText}`;
                                    if (i % 5 === 0) {
                                        console.log(`📄 Processed ${i}/${maxPages2b} pages...`);
                                    }
                                } catch (pageError) {
                                    console.warn(`⚠️ Error processing page ${i}:`, pageError.message);
                                    continue;
                                }
                            }
                            console.log(`✅ PDF processed: ${textContent2b.length} characters extracted`);
                            return textContent2b.trim();
                        }
                    } catch (fallbackErrB) {
                        console.log(`⚠️ Lowercase-directories fallback failed: ${fallbackErrB.message}`);
                    }

                    // Additional fallback: slugify path segments (spaces->hyphens, lowercase)
                    try {
                        const slugged = buildSlugifiedUrl(url);
                        if (slugged.href !== url) {
                            console.log(`🔁 Retrying with slugified path: ${slugged.href}`);
                            const resp3 = await axios.get(slugged.href, {
                                responseType: "arraybuffer",
                                maxRedirects: 5,
                                timeout: 30000,
                                headers,
                                validateStatus: (s) => s >= 200 && s < 400,
                            });
                            console.log(`✅ PDF downloaded (${resp3.data.byteLength} bytes) [slugified path]`);
                            const dataBuffer3 = new Uint8Array(resp3.data);
                            const pdfDoc3 = await pdfjsLib.getDocument({
                                data: dataBuffer3,
                                useWorkerFetch: false,
                                isEvalSupported: false,
                                verbosity: 0
                            }).promise;
                            console.log(`📖 PDF has ${pdfDoc3.numPages} pages`);
                            let textContent3 = "";
                            const maxPages3 = Math.min(pdfDoc3.numPages, 20);
                            for (let i = 1; i <= maxPages3; i++) {
                                try {
                                    const page = await pdfDoc3.getPage(i);
                                    const content = await page.getTextContent();
                                    const pageText = content.items.map((item) => item.str).join(" ");
                                    textContent3 += `\n\n[PAGE ${i}]\n${pageText}`;
                                    if (i % 5 === 0) {
                                        console.log(`📄 Processed ${i}/${maxPages3} pages...`);
                                    }
                                } catch (pageError) {
                                    console.warn(`⚠️ Error processing page ${i}:`, pageError.message);
                                    continue;
                                }
                            }
                            console.log(`✅ PDF processed: ${textContent3.length} characters extracted`);
                            return textContent3.trim();
                        }
                    } catch (fallbackErr2) {
                        console.log(`⚠️ Slugified-path fallback failed: ${fallbackErr2.message}`);
                    }
                }
            }
        }

        throw lastError || new Error("Unknown PDF download error");
    } catch (err) {
        console.error(`❌ Failed to parse PDF ${url}:`, err.message);
        return "";
    }
}
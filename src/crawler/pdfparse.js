import axios from "axios";
import pdfjsLib from "pdfjs-dist/legacy/build/pdf.js";

// Extract PDF processing logic to avoid repetition
async function processPdfData(dataBuffer) {
    const pdfDoc = await pdfjsLib
        .getDocument({
            data: new Uint8Array(dataBuffer),
            useWorkerFetch: false,
            isEvalSupported: false,
            verbosity: 0 // Reduce PDF.js logging
        })
        .promise;

    console.log(`✅ PDF pages: ${pdfDoc.numPages}`);
    let textContent = "";

    // Limit to first 10 pages to avoid excessive processing
    const maxPages = Math.min(pdfDoc.numPages, 10);

    for (let i = 1; i <= maxPages; i++) {
        try {
            const page = await pdfDoc.getPage(i);
            const content = await page.getTextContent();
            const pageText = content.items
                .map((item) => item.str)
                .join(" ");
            textContent += `\n\n[PAGE ${i}]\n${pageText}`;

            if (i % 5 === 0) {
                console.log(`Processed ${i}/${maxPages} pages...`);
            }
        } catch (pageError) {
            console.warn(`Error processing page ${i}:`, pageError.message);
            continue;
        }
    }

    console.log(`✅ PDF text extracted: ${textContent.length} chars`);
    return textContent.trim();
}

export async function parsePdf(url, referer = undefined) {
    try {
        console.log(`Downloading PDF: ${url}`);

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

        // Handle HDFC repository URLs specially
        function handleRepositoryUrl(originalUrl) {
            try {
                const u = new URL(originalUrl);
                if (u.pathname.includes('/content/bbp/repositories/')) {
                    // This is already a repository URL, use it directly (no conversion needed)
                    return null; // Let it use the original URL
                }

                // If it's a relative path that might need to be converted to repository URL
                if (originalUrl.startsWith('/Personal/Pay/Cards/')) {
                    // Convert to repository URL format with proper encoding
                    const encodedPath = encodeURIComponent(originalUrl);
                    const repoUrl = `https://www.hdfcbank.com/content/bbp/repositories/723fb80a-2dde-42a3-9793-7ae1be57c87f/?path=${encodedPath}`;
                    return new URL(repoUrl);
                }
            } catch (error) {
                // If URL parsing fails, it might be a relative path
                if (originalUrl.startsWith('/Personal/Pay/Cards/')) {
                    const encodedPath = encodeURIComponent(originalUrl);
                    const repoUrl = `https://www.hdfcbank.com/content/bbp/repositories/723fb80a-2dde-42a3-9793-7ae1be57c87f/?path=${encodedPath}`;
                    return new URL(repoUrl);
                }
                console.warn(`Error handling repository URL: ${error.message}`);
            }
            return null;
        }

        let lastError;

        // First, clean up the URL and handle repository URLs
        let actualUrl = url;

        // Fix double encoding issues (e.g., %2520 -> %20)
        actualUrl = actualUrl.replace(/%2520/g, '%20').replace(/%252F/g, '%2F');

        // Only convert to repository URL if it's a relative path
        const repositoryUrl = handleRepositoryUrl(actualUrl);
        if (repositoryUrl) {
            console.log(`Converting to repository URL: ${repositoryUrl.href}`);
            actualUrl = repositoryUrl.href;
        }

        try {
            const response = await axios.get(actualUrl, {
                responseType: "arraybuffer",
                maxRedirects: 5,
                timeout: 15000, // 15 sec timeout
                headers,
                validateStatus: (s) => s >= 200 && s < 400,
            });

            console.log(`✅ PDF downloaded (${response.data.byteLength} bytes)`);
            return await processPdfData(response.data);

        } catch (e) {
            console.log(`❌ PDF download error: ${e.message}`);

            if (e.response && e.response.status === 404) {
                // Try repository URL conversion for HDFC relative paths
                if (url.includes('/Personal/Pay/Cards/') && !url.includes('/content/bbp/repositories/')) {
                    let path = url.replace('https://www.hdfcbank.com', '');
                    try {
                        path = decodeURIComponent(path);
                    } catch {
                        console.warn(`Could not decode path: ${path}`);
                    }

                    const encodedPath = encodeURIComponent(path);
                    const repoUrl = `https://www.hdfcbank.com/content/bbp/repositories/723fb80a-2dde-42a3-9793-7ae1be57c87f/?path=${encodedPath}`;
                    console.log(`🔁 Trying repository URL conversion: ${repoUrl}`);

                    try {
                        const repoResp = await axios.get(repoUrl, {
                            responseType: "arraybuffer",
                            maxRedirects: 5,
                            timeout: 15000,
                            headers,
                            validateStatus: (s) => s >= 200 && s < 400,
                        });
                        console.log(`✅ PDF downloaded via repository URL (${repoResp.data.byteLength} bytes)`);
                        return await processPdfData(repoResp.data);
                    } catch (repoErr) {
                        console.log(`❌ Repository URL failed: ${repoErr.message}`);
                    }
                }

                // fallback lowercase/slugified logic here (same as before)
            }
        }


        throw lastError || new Error("Unknown PDF download error");
    } catch (err) {
        console.error(` Failed to parse PDF ${url}:`, err.message);
        return "";
    }
}
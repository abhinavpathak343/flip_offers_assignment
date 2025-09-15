import {
    Worker
} from 'worker_threads';
import axios from 'axios';
import path from 'path';
import {
    fileURLToPath
} from 'url';

const __filename = fileURLToPath(
    import.meta.url);
const __dirname = path.dirname(__filename);

// Download PDF data in main thread (non-blocking for I/O)
async function downloadPdfData(url, referer = undefined) {
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

        // Handle HDFC repository URLs specially
        function handleRepositoryUrl(originalUrl) {
            try {
                const u = new URL(originalUrl);
                if (u.pathname.includes('/content/bbp/repositories/')) {
                    return null; // Let it use the original URL
                }

                if (originalUrl.startsWith('/Personal/Pay/Cards/')) {
                    const encodedPath = encodeURIComponent(originalUrl);
                    const repoUrl = `https://www.hdfcbank.com/content/bbp/repositories/723fb80a-2dde-42a3-9793-7ae1be57c87f/?path=${encodedPath}`;
                    return new URL(repoUrl);
                }
            } catch (error) {
                if (originalUrl.startsWith('/Personal/Pay/Cards/')) {
                    const encodedPath = encodeURIComponent(originalUrl);
                    const repoUrl = `https://www.hdfcbank.com/content/bbp/repositories/723fb80a-2dde-42a3-9793-7ae1be57c87f/?path=${encodedPath}`;
                    return new URL(repoUrl);
                }
                console.warn(`Error handling repository URL: ${error.message}`);
            }
            return null;
        }

        let actualUrl = url;

        // Fix double encoding issues
        actualUrl = actualUrl.replace(/%2520/g, '%20').replace(/%252F/g, '%2F');

        // Convert to repository URL if needed
        const repositoryUrl = handleRepositoryUrl(actualUrl);
        if (repositoryUrl) {
            console.log(`Converting to repository URL: ${repositoryUrl.href}`);
            actualUrl = repositoryUrl.href;
        }

        try {
            const response = await axios.get(actualUrl, {
                responseType: "arraybuffer",
                maxRedirects: 5,
                timeout: 15000,
                headers,
                validateStatus: (s) => s >= 200 && s < 400,
            });

            console.log(`✅ PDF downloaded (${response.data.byteLength} bytes)`);
            return response.data;

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
                        return repoResp.data;
                    } catch (repoErr) {
                        console.log(`❌ Repository URL failed: ${repoErr.message}`);
                    }
                }
            }

            throw e;
        }

    } catch (err) {
        console.error(`Failed to download PDF ${url}:`, err.message);
        throw err;
    }
}

// Parse PDF in a worker thread
export async function parsePdfInWorker(url, referer = undefined) {
    return new Promise(async (resolve, reject) => {
        try {
            // Download PDF data in main thread
            const dataBuffer = await downloadPdfData(url, referer);

            // Create worker
            const workerPath = path.join(__dirname, 'pdfWorker.js');
            const worker = new Worker(workerPath, {
                workerData: {
                    url,
                    referer,
                    dataBuffer: Array.from(dataBuffer) // Convert ArrayBuffer to regular array for worker
                }
            });

            // Handle worker messages
            worker.on('message', (result) => {
                if (result.success) {
                    console.log(`✅ Worker completed PDF parsing for: ${result.url}`);
                    resolve(result.textContent);
                } else {
                    console.error(`❌ Worker failed PDF parsing for: ${result.url} - ${result.error}`);
                    reject(new Error(`PDF parsing failed: ${result.error}`));
                }
            });

            // Handle worker errors
            worker.on('error', (error) => {
                console.error(`Worker error for ${url}:`, error);
                reject(error);
            });

            // Handle worker exit
            worker.on('exit', (code) => {
                if (code !== 0) {
                    console.error(`Worker exited with code ${code} for ${url}`);
                    reject(new Error(`Worker exited with code ${code}`));
                }
            });

            // Set timeout for worker
            const timeout = setTimeout(() => {
                console.warn(`Worker timeout for ${url}, terminating...`);
                worker.terminate();
                reject(new Error(`PDF parsing timeout for ${url}`));
            }, 30000); // 30 second timeout

            // Clear timeout on successful completion
            worker.on('message', () => {
                clearTimeout(timeout);
            });

        } catch (error) {
            reject(error);
        }
    });
}

// Process multiple PDFs in parallel using workers
export async function parseMultiplePdfsInWorkers(pdfLinks, concurrency = 3) {
    console.log(`Processing ${pdfLinks.length} PDFs with ${concurrency} concurrent workers...`);

    const results = [];

    // Process in batches to control concurrency
    for (let i = 0; i < pdfLinks.length; i += concurrency) {
        const batch = pdfLinks.slice(i, i + concurrency);

        console.log(`Processing batch ${Math.floor(i / concurrency) + 1}/${Math.ceil(pdfLinks.length / concurrency)} (${batch.length} PDFs)`);

        const batchPromises = batch.map(async (link, index) => {
            const globalIndex = i + index;
            console.log(`Starting PDF ${globalIndex + 1}/${pdfLinks.length}: ${link.url}`);

            try {
                const textContent = await parsePdfInWorker(link.url, link.referer);
                return {
                    success: true,
                    url: link.url,
                    textContent,
                    index: globalIndex
                };
            } catch (error) {
                console.error(`Failed to process PDF ${globalIndex + 1}: ${error.message}`);
                return {
                    success: false,
                    url: link.url,
                    error: error.message,
                    index: globalIndex
                };
            }
        });

        const batchResults = await Promise.allSettled(batchPromises);

        // Process batch results
        batchResults.forEach((result, batchIndex) => {
            if (result.status === 'fulfilled') {
                results[result.value.index] = result.value;
            } else {
                const globalIndex = i + batchIndex;
                results[globalIndex] = {
                    success: false,
                    url: batch[batchIndex].url,
                    error: result.reason?.message || 'Unknown error',
                    index: globalIndex
                };
            }
        });

        // Small delay between batches to prevent overwhelming the system
        if (i + concurrency < pdfLinks.length) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    }

    const successful = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);

    console.log(`PDF processing complete: ${successful.length} successful, ${failed.length} failed`);

    return {
        results,
        successful,
        failed
    };
}
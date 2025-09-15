import {
    parentPort,
    workerData
} from 'worker_threads';
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

// Worker main function
async function workerMain() {
    try {
        const {
            url,
            referer,
            dataBuffer
        } = workerData;

        if (!dataBuffer) {
            throw new Error('No PDF data provided to worker');
        }

        console.log(`Worker processing PDF: ${url}`);

        // Process the PDF data
        const textContent = await processPdfData(dataBuffer);

        // Send success result back to parent
        parentPort.postMessage({
            success: true,
            url,
            textContent
        });

    } catch (error) {
        console.error(`Worker PDF processing failed:`, error.message);

        // Send error result back to parent
        parentPort.postMessage({
            success: false,
            url: workerData.url,
            error: error.message
        });
    }
}

// Start the worker
workerMain();
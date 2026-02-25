let isRunning = false;
let usedPrompts = new Set();

// Helper to send logs to the popup window
function sendLog(message, type = 'info') {
    console.log(`[Auto-Gen] ${message}`);
    // Use try/catch because if the popup is closed, sendMessage will fail silently
    try {
        chrome.runtime.sendMessage({ action: "LOG", message: message, type: type }).catch(() => {});
    } catch (e) {}
}

function updateCountdownUI(text) {
    try {
        chrome.runtime.sendMessage({ action: "UPDATE_COUNTDOWN", text: text }).catch(() => {});
    } catch (e) {}
}

// Helper to generate a dark blue 16:9 fallback image containing the error message
function createErrorImage(prefix, folder, promptText, gptMessage) {
    const canvas = document.createElement('canvas');
    canvas.width = 1920;
    canvas.height = 1080;
    const ctx = canvas.getContext('2d');

    // Background (Dark Blue)
    ctx.fillStyle = '#0f172a'; // Tailwind slate-900
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.textBaseline = 'top';
    
    // Wrap text helper
    const wrapText = (text, x, y, maxWidth, lineHeight, font, color) => {
        ctx.font = font;
        ctx.fillStyle = color;
        const words = text.split(' ');
        let line = '';
        let currentY = y;
        for (let n = 0; n < words.length; n++) {
            const testLine = line + words[n] + ' ';
            const metrics = ctx.measureText(testLine);
            const testWidth = metrics.width;
            if (testWidth > maxWidth && n > 0) {
                ctx.fillText(line.trim(), x, currentY);
                line = words[n] + ' ';
                currentY += lineHeight;
            } else {
                line = testLine;
            }
        }
        ctx.fillText(line.trim(), x, currentY);
        return currentY + lineHeight;
    };

    let currentY = 80;
    
    // Title
    currentY = wrapText(`Failed to generate image [${prefix}] of project [${folder}]`, 80, currentY, 1760, 60, 'bold 48px sans-serif', '#ef4444');
    currentY += 40;
    
    // Prompt
    currentY = wrapText(`Prompt: '${promptText}'`, 80, currentY, 1760, 50, '36px monospace', '#e2e8f0');
    currentY += 40;
    
    // Truncate GPT message if it's absurdly long
    let safeMessage = gptMessage.length > 1500 ? gptMessage.substring(0, 1500) + "... [Truncated]" : gptMessage;
    
    // GPT Message
    wrapText(`GPT Message: ${safeMessage}`, 80, currentY, 1760, 50, '36px sans-serif', '#94a3b8');

    return canvas.toDataURL('image/png');
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "START_AUTOMATION") {
        if (isRunning) {
            sendLog("Automation is already running! Ignoring duplicate request.", "warn");
            return;
        }
        isRunning = true;
        usedPrompts.clear();
        processPrompts(request.prompts, request.generateAgainText, request.waitTime);
    }
});

async function processPrompts(promptsText, generateAgainText, waitTimeSeconds) {
    const lines = promptsText.split(/\r?\n/);
    let currentPrefix = "00001";
    let currentFolder = "AI_Images";
    let isVariation = false;
    let totalPrompts = lines.filter(l => l.trim() && !l.trim().startsWith('#####')).length;
    let currentPromptIndex = 0;

    sendLog(`Starting automation. Found ${totalPrompts} prompts to process. Wait time is ${waitTimeSeconds}s.`, "info");

    for (let i = 0; i < lines.length; i++) {
        let line = lines[i].trim();
        if (!line) continue;
        if (!isRunning) {
            sendLog("Automation forcefully stopped.", "warn");
            break;
        }

        // Parse Configuration Line
        const configMatch = line.match(/^#####\s+(Variation\s+)?(\d+)\s+"([^"]*)"/i);
        if (configMatch) {
            isVariation = !!configMatch[1];
            currentPrefix = configMatch[2];
            currentFolder = configMatch[3];
            sendLog(`Config Updated: Next file will be saved to '${currentFolder}' with prefix '${currentPrefix}'. Variation mode: ${isVariation}`, "info");
            continue;
        }

        // It's a prompt line
        currentPromptIndex++;
        let finalPrompt = line;
        
        if (usedPrompts.has(line)) {
            finalPrompt += generateAgainText;
            sendLog(`Duplicate prompt detected. Appending 'Generate Again' suffix.`, "warn");
        }
        usedPrompts.add(line);

        sendLog(`[${currentPromptIndex}/${totalPrompts}] Sending prompt to ChatGPT...`, "info");
        
        // Track the current number of assistant responses before we send the new prompt
        let initialTurnCount = document.querySelectorAll('article[data-turn="assistant"]').length;
        
        try {
            await sendPromptToChatGPT(finalPrompt);
        } catch (error) {
            sendLog(`Failed to send prompt: ${error.message}`, "error");
            continue; // Skip to next if UI interaction fails
        }
        
        sendLog("Waiting for ChatGPT to finish generating (Timeout: 20 mins)...", "info");
        const result = await waitForGenerationAndGetImage(initialTurnCount);

        if (result && result.status === 'success') {
            sendLog(`Image generation complete. Triggering download...`, "success");
            // Variation is purposefully left out of the file name per request
            const filename = `${currentFolder}/${currentPrefix}.png`;
            
            // Send to background to download
            chrome.runtime.sendMessage({
                action: "DOWNLOAD_IMAGE",
                url: result.url,
                filename: filename
            });
        } else {
            const errorMsg = result ? result.message : "Unknown error or timeout.";
            sendLog(`Generation failed. Creating fallback error image...`, "error");

            // Generate Fallback Error Image
            const errorImageBase64 = createErrorImage(currentPrefix, currentFolder, finalPrompt, errorMsg);
            const filenameImg = `${currentFolder}/${currentPrefix}-ERROR.png`;
            chrome.runtime.sendMessage({ 
                action: "DOWNLOAD_IMAGE", 
                url: errorImageBase64, 
                filename: filenameImg 
            });

            // Generate Error Log Text File
            const logContent = `Failed to generate image [${currentPrefix}] of project [${currentFolder}]\nPrompt: '${finalPrompt}'\nGPT Message: ${errorMsg}`;
            const logDataUrl = 'data:text/plain;charset=utf-8,' + encodeURIComponent(logContent);
            const filenameLog = `${currentFolder}/${currentPrefix}-ERROR-log.txt`;
            chrome.runtime.sendMessage({ 
                action: "DOWNLOAD_IMAGE", 
                url: logDataUrl, 
                filename: filenameLog 
            });
        }

        // Always auto-increment the prefix for the next image
        currentPrefix = String(parseInt(currentPrefix) + 1).padStart(5, '0');

        // Check if there are more valid prompts left to process before initiating the wait timer
        const hasMorePrompts = lines.slice(i + 1).some(l => l.trim() && !l.trim().startsWith('#####'));

        if (hasMorePrompts) {
            if (waitTimeSeconds > 0) {
                sendLog(`Waiting ${waitTimeSeconds} seconds before sending the next prompt...`, "info");
                for (let w = waitTimeSeconds; w > 0; w--) {
                    if (!isRunning) break;
                    updateCountdownUI(`Next in: ${w}s`);
                    await new Promise(r => setTimeout(r, 1000));
                }
                updateCountdownUI(""); // Clear UI after countdown
            } else {
                // If wait time is 0, just do a tiny safety buffer
                await new Promise(r => setTimeout(r, 2000));
            }
        }
    }

    isRunning = false;
    updateCountdownUI("");
    sendLog("Automation routine finished completely.", "success");
    alert("Image Auto-Generation Complete!");
}

async function sendPromptToChatGPT(text) {
    const textarea = document.getElementById('prompt-textarea');
    if (!textarea) throw new Error("Could not find the ChatGPT input area. Did the UI change?");

    textarea.focus();
    
    // Paste mechanism for React contenteditable support
    const dataTransfer = new DataTransfer();
    dataTransfer.setData('text/plain', text);
    const pasteEvent = new ClipboardEvent('paste', {
        clipboardData: dataTransfer,
        bubbles: true,
        cancelable: true
    });
    textarea.dispatchEvent(pasteEvent);

    await new Promise(r => setTimeout(r, 600));

    const sendBtn = document.querySelector('button[data-testid="send-button"]');
    if (sendBtn && !sendBtn.disabled) {
        sendBtn.click();
    } else {
        throw new Error("Send button not found or is disabled.");
    }
}

async function waitForGenerationAndGetImage(initialTurnCount) {
    return new Promise((resolve) => {
        let checkInterval;
        let timeout;
        let finishedTime = null;
        let loggedWait = false;

        const cleanup = () => {
            clearInterval(checkInterval);
            clearTimeout(timeout);
        };

        // Hard timeout properly set to 20 minutes (1,200,000 milliseconds)
        timeout = setTimeout(() => {
            cleanup();
            resolve({ status: 'error', message: 'Hard timeout of 20 minutes reached.' });
        }, 20 * 60 * 1000);

        checkInterval = setInterval(() => {
            const assistantTurns = document.querySelectorAll('article[data-turn="assistant"]');
            
            // Keep waiting if the new turn hasn't appeared yet
            if (assistantTurns.length <= initialTurnCount) {
                return;
            }

            const lastTurn = assistantTurns[assistantTurns.length - 1];
            
            // 1. Check for the image FIRST, regardless of copy button
            const allImages = Array.from(lastTurn.querySelectorAll('img'));
            const generatedImages = allImages.filter(img => {
                const src = (img.src || '').toLowerCase();
                const alt = (img.alt || '').toLowerCase();
                
                // Robust DALL-E / Estuary image checking including localized text
                if (src.includes('oaiusercontent.com') || src.includes('dall-e') || src.includes('estuary')) return true;
                if (alt.includes('generated') || alt.includes('dall·e') || alt.includes('gerada') || alt.includes('criada')) return true;
                
                // Fallback: If it's a large image and not an avatar/UI icon
                if (img.width >= 200 && !src.includes('profile') && !src.includes('avatar') && !src.includes('favicon')) {
                    return true;
                }
                return false;
            });

            if (generatedImages.length > 0) {
                // Image found! Give the browser 1 second to fully process the src URL internally, then resolve
                cleanup();
                setTimeout(() => {
                    resolve({ status: 'success', url: generatedImages[generatedImages.length - 1].src });
                }, 1000);
                return;
            }

            // 2. If no image is found yet, check if ChatGPT says generation is "finished"
            const copyBtn = lastTurn.querySelector('button[data-testid="copy-turn-action-button"]');
            const stopBtn = document.querySelector('button[data-testid="stop-button"]');
            
            const isFinished = copyBtn && !stopBtn;

            if (isFinished) {
                if (!finishedTime) {
                    // Start the 15-second grace period timer
                    finishedTime = Date.now();
                } else {
                    const elapsed = Date.now() - finishedTime;
                    
                    if (!loggedWait && elapsed > 2000) {
                        sendLog("Text finished, waiting up to 15s for image to render...", "info");
                        loggedWait = true;
                    }

                    if (elapsed > 15000) {
                        // We waited 15 seconds after the UI said it was finished, but no image ever rendered.
                        // It was likely a text-only response or a rate limit message.
                        cleanup();
                        let gptTextMsg = lastTurn.innerText.trim();
                        if (!gptTextMsg) gptTextMsg = "Empty response or unknown error.";
                        
                        resolve({ status: 'error', message: gptTextMsg });
                    }
                }
            } else {
                // If it starts generating again, reset the timer
                finishedTime = null;
                loggedWait = false;
            }
        }, 1000); // Check every 1 second
    });
}
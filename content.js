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
        
        try {
            await sendPromptToChatGPT(finalPrompt);
        } catch (error) {
            sendLog(`Failed to send prompt: ${error.message}`, "error");
            continue; // Skip to next if UI interaction fails
        }
        
        sendLog("Waiting for ChatGPT to finish generating...", "info");
        const imageUrl = await waitForGenerationAndGetImage();

        if (imageUrl) {
            sendLog(`Image generation complete. Triggering download...`, "success");
            const filename = `${currentFolder}/${currentPrefix}${isVariation ? '_Variation' : ''}.png`;
            
            // Send to background to download
            chrome.runtime.sendMessage({
                action: "DOWNLOAD_IMAGE",
                url: imageUrl,
                filename: filename
            });
            
            // Prefix auto-increment removed here as requested. 
            // It will remain the same until a new ##### config line is encountered.
        } else {
            sendLog("Timeout or failed to find the generated image. Proceeding to next prompt.", "error");
        }

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

async function waitForGenerationAndGetImage() {
    return new Promise((resolve) => {
        let checkInterval;
        let timeout;

        const cleanup = () => {
            clearInterval(checkInterval);
            clearTimeout(timeout);
        };

        // Timeout after 3.5 minutes
        timeout = setTimeout(() => {
            cleanup();
            resolve(null);
        }, 3.5 * 60 * 1000);

        checkInterval = setInterval(() => {
            const sendBtn = document.querySelector('button[data-testid="send-button"]');
            const stopBtn = document.querySelector('button[data-testid="stop-button"]');
            
            // When send button is enabled and stop generating button is gone
            if (sendBtn && !sendBtn.disabled && !stopBtn) {
                cleanup();
                
                // Allow a small buffer for image rendering in the DOM
                setTimeout(() => {
                    const allImages = Array.from(document.querySelectorAll('main img'));
                    const generatedImages = allImages.filter(img => 
                        img.alt.includes("Generated image") || 
                        (img.width > 200 && !img.src.includes('profile'))
                    );

                    if (generatedImages.length > 0) {
                        resolve(generatedImages[generatedImages.length - 1].src);
                    } else {
                        resolve(null);
                    }
                }, 1500); 
            }
        }, 1500);
    });
}
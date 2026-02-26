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

// Helper to calculate the wait time in ms until 10 minutes AFTER the absolute rate limit time (14:54)
function getWaitTimeForRateLimit(timeStr) {
    const now = new Date();
    let hours = 0, minutes = 0;
    const match = timeStr.match(/(\d{1,2}):(\d{2})(?:\s?([aApP][mM]))?/i);
    
    if (!match) return 15 * 60 * 1000; // Fallback to 15 mins if parsing fails
    
    hours = parseInt(match[1], 10);
    minutes = parseInt(match[2], 10);
    const ampm = match[3] ? match[3].toLowerCase() : null;

    if (ampm === 'pm' && hours < 12) hours += 12;
    if (ampm === 'am' && hours === 12) hours = 0;

    let targetTime = new Date(now);
    targetTime.setHours(hours, minutes, 0, 0);

    // If target time is more than 12 hours in the past, it probably refers to tomorrow
    if (targetTime.getTime() - now.getTime() < -12 * 60 * 60 * 1000) {
        targetTime.setDate(targetTime.getDate() + 1);
    }
    
    // Add 10 minutes buffer after the limit time
    targetTime.setMinutes(targetTime.getMinutes() + 10);
    
    let waitMs = targetTime.getTime() - now.getTime();
    
    // If the calculated time is already in the past, just wait a brief moment
    if (waitMs <= 0) {
        return 30 * 1000; // 30 seconds fallback
    }
    
    // Safety cap: max 24 hours
    if (waitMs > 24 * 60 * 60 * 1000) {
        return 15 * 60 * 1000;
    }
    
    return waitMs;
}

// Helper to parse relative time durations directly from the ChatGPT text response
function parseWaitDurationFromText(text) {
    let hours = 0;
    let minutes = 0;
    let found = false;
    
    // Strip markdown bold asterisks to clean the string
    const cleanText = text.replace(/\*/g, '');

    // Safety: Exclude explicit absolute times (e.g. "after 14:54", "após 14:54") 
    // to prevent treating 14:54 as 14 hours and 54 minutes.
    if (/(?:após|after|at|às|until)\s*\d{1,2}:\d{2}/i.test(cleanText)) {
        return null;
    }

    // Format 1: "X hours and Y minutes" / "X horas e Y minutos"
    const hrMinMatch = cleanText.match(/(\d+)\s*(?:hours?|horas?)\s*(?:and|e)?\s*(\d+)\s*(?:minutes?|minutos?|mins?)/i);
    if (hrMinMatch) {
        hours = parseInt(hrMinMatch[1], 10);
        minutes = parseInt(hrMinMatch[2], 10);
        found = true;
    } else {
        // Fallback: Just hours or just minutes
        const hrMatch = cleanText.match(/(\d+)\s*(?:hours?|horas?)/i);
        const minMatch = cleanText.match(/(\d+)\s*(?:minutes?|minutos?|mins?)/i);
        if (hrMatch) { hours = parseInt(hrMatch[1], 10); found = true; }
        if (minMatch) { minutes = parseInt(minMatch[1], 10); found = true; }
    }

    // Format 2: "XhY" or "XhYm" (e.g., "3h50", "01h02m")
    if (!found) {
        const hMatch = cleanText.match(/\b(\d{1,2})h(\d{1,2})m?\b/i);
        if (hMatch) {
            hours = parseInt(hMatch[1], 10);
            minutes = parseInt(hMatch[2], 10);
            found = true;
        }
    }

    // Format 3: "X:Y" as a duration
    // Must have a duration keyword context to separate it from absolute time like 14:54
    if (!found) {
        const colonContextMatch = cleanText.match(/(?:in|faltam|cerca de|restam|em|about|resets? in)\s*(\d{1,2}):(\d{2})\b/i);
        if (colonContextMatch) {
            hours = parseInt(colonContextMatch[1], 10);
            minutes = parseInt(colonContextMatch[2], 10);
            found = true;
        }
    }

    if (found) {
        return (hours * 60 + minutes + 5) * 60 * 1000; // Add the requested 5 mins buffer
    }
    
    return null;
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
        processPrompts(
            request.prompts, 
            request.startIndex || 1,
            request.generateAgainText, 
            request.waitTime, 
            request.retries, 
            request.retryTime
        );
    } else if (request.action === "STOP_AUTOMATION") {
        if (isRunning) {
            sendLog("Stop signal received from UI. Attempting to halt immediately...", "warn");
            isRunning = false; // Breaking loops in processPrompts and waiting intervals
        }
    }
});

async function processPrompts(promptsText, startIndex, generateAgainText, waitTimeSeconds, maxRetries = 3, retryWaitTimeSeconds = 150) {
    const lines = promptsText.split(/\r?\n/);
    let currentPrefix = "00001";
    let currentFolder = "AI_Images";
    let isVariation = false;
    let totalPrompts = lines.filter(l => l.trim() && !l.trim().startsWith('#####')).length;
    let currentPromptIndex = 0;
    let stoppedForcefully = false;

    sendLog(`Starting automation. Found ${totalPrompts} prompts to process. Wait time is ${waitTimeSeconds}s.`, "info");

    for (let i = 0; i < lines.length; i++) {
        let line = lines[i].trim();
        if (!line) continue;
        
        if (!isRunning) {
            stoppedForcefully = true;
            break;
        }

        // Parse Configuration Line
        const configMatch = line.match(/^#####\s+(Variation\s+)?(\d+)\s+"([^"]*)"/i);
        if (configMatch) {
            isVariation = !!configMatch[1];
            currentPrefix = configMatch[2];
            currentFolder = configMatch[3];
            
            // Only log config updates if we are actively processing (or about to process)
            if (currentPromptIndex >= startIndex - 1) {
                sendLog(`Config Updated: Next file will be saved to '${currentFolder}' with prefix '${currentPrefix}'. Variation mode: ${isVariation}`, "info");
            }
            continue;
        }

        // It's a prompt line
        currentPromptIndex++;
        
        // --- Index Skipping Logic ---
        if (currentPromptIndex < startIndex) {
            usedPrompts.add(line);
            currentPrefix = String(parseInt(currentPrefix) + 1).padStart(5, '0');
            continue; 
        }

        let finalPrompt = line;
        
        if (usedPrompts.has(line)) {
            finalPrompt += generateAgainText;
            sendLog(`Duplicate prompt detected. Appending 'Generate Again' suffix.`, "warn");
        }
        usedPrompts.add(line);

        sendLog(`[${currentPromptIndex}/${totalPrompts}] Sending prompt to ChatGPT...`, "info");
        
        let attempt = 0;
        let success = false;
        let lastErrorMsg = "Unknown error";

        // Retry Loop (Handles standard retries + explicit time checks)
        while (!success && isRunning) {
            
            // NEW: After all standard retries fail, actively ask ChatGPT for the limitation time.
            if (attempt > maxRetries) {
                sendLog(`All ${maxRetries} retries failed. Asking ChatGPT for exact wait time...`, "warn");
                let initialTurnCount = document.querySelectorAll('article[data-turn="assistant"]').length;
                try {
                    await sendPromptToChatGPT("How much time for the next image generation? Please tell me in the format DD:HH:MM. If it's not a time limitation, please say 'NO'");
                } catch (error) {
                    sendLog(`Failed to ask for wait time: ${error.message}`, "error");
                    break;
                }
                
                sendLog(`Waiting for response...`, "info");
                const result = await waitForGenerationAndGetImage(initialTurnCount);
                if (!isRunning) break;
                
                let responseText = result.textMsg || result.message || "";
                
                // If ChatGPT responds with exactly 'NO', or mentions it's not a limit, break to fallback
                if (/\bNO\b/i.test(responseText)) {
                    sendLog("ChatGPT responded with 'NO' (no time limitation). Proceeding to error image.", "error");
                    break;
                }
                
                // Parse DD:HH:MM from response
                const match = responseText.match(/(\d{1,2}):(\d{1,2}):(\d{1,2})/);
                if (match) {
                    let d = parseInt(match[1], 10);
                    let h = parseInt(match[2], 10);
                    let m = parseInt(match[3], 10);
                    let waitMs = (((d * 24) + h) * 60 + m + 5) * 60 * 1000; // Add 5 mins safety buffer
                    
                    let waitMins = Math.ceil(waitMs / 60000);
                    sendLog(`Wait timestamp ${match[0]} detected! Pausing for ${waitMins} min (includes 5m buffer)...`, "warn");
                    
                    let wSecs = Math.ceil(waitMs / 1000);
                    for (let w = wSecs; w > 0; w--) {
                        if (!isRunning) break;
                        
                        let displayTime = "";
                        let remD = Math.floor(w / 86400);
                        let remH = Math.floor((w % 86400) / 3600);
                        let remM = Math.floor((w % 3600) / 60);
                        let remS = w % 60;
                        if (remD > 0) displayTime = `${remD}d ${String(remH).padStart(2,'0')}h ${String(remM).padStart(2,'0')}m`;
                        else if (remH > 0) displayTime = `${remH}h ${String(remM).padStart(2,'0')}m ${String(remS).padStart(2,'0')}s`;
                        else displayTime = `${remM}m ${String(remS).padStart(2,'0')}s`;
                        
                        updateCountdownUI(`Limit Pause: ${displayTime}`);
                        await new Promise(r => setTimeout(r, 1000));
                    }
                    updateCountdownUI(""); 
                    
                    if (!isRunning) break;
                    
                    sendLog(`Limit pause complete. Retrying the original prompt...`, "info");
                    attempt = 0; // Reset attempts to try the initial prompt again!
                    continue; 
                } else {
                    sendLog("No timestamp found in response. Proceeding to error image.", "error");
                    break;
                }
            }

            // Standard wait between retries
            if (attempt > 0) {
                sendLog(`Retry ${attempt}/${maxRetries} for prompt [${currentPrefix}] in ${retryWaitTimeSeconds}s...`, "warn");
                for (let w = retryWaitTimeSeconds; w > 0; w--) {
                    if (!isRunning) break;
                    updateCountdownUI(`Retry in: ${w}s`);
                    await new Promise(r => setTimeout(r, 1000));
                }
                updateCountdownUI(""); // Clear UI after countdown
                if (!isRunning) break;
                
                sendLog(`[${currentPromptIndex}/${totalPrompts}] Re-sending prompt to ChatGPT (Retry ${attempt})...`, "info");
            }

            // Track the current number of assistant responses before we send the new prompt
            let initialTurnCount = document.querySelectorAll('article[data-turn="assistant"]').length;
            
            try {
                await sendPromptToChatGPT(finalPrompt);
            } catch (error) {
                sendLog(`Failed to send prompt: ${error.message}`, "error");
                lastErrorMsg = error.message;
                attempt++;
                continue; 
            }
            
            sendLog(`Waiting for ChatGPT to finish generating (Timeout: 20 mins)...`, "info");
            const result = await waitForGenerationAndGetImage(initialTurnCount);

            if (!isRunning) { break; } // Stopped during generation

            if (result && result.status === 'success') {
                sendLog(`Image generation complete. Triggering download...`, "success");
                const filename = `${currentFolder}/${currentPrefix}.png`;
                
                // Send to background to download
                chrome.runtime.sendMessage({
                    action: "DOWNLOAD_IMAGE",
                    url: result.url,
                    filename: filename
                });
                
                success = true; // Break the retry loop
                
            } else if (result && result.status === 'rate_limited_duration') {
                // NEW: Handle explicitly parsed durations directly from the text response
                const waitMins = Math.ceil(result.waitMs / 60000);
                sendLog(`Rate limit text detected! Waiting for ${waitMins} min pause (includes 5m buffer)...`, "warn");
                
                let wSecs = Math.ceil(result.waitMs / 1000);
                for (let w = wSecs; w > 0; w--) {
                    if (!isRunning) break;
                    updateCountdownUI(`Limit Pause: ${Math.floor(w/60)}m ${String(w%60).padStart(2, '0')}s`);
                    await new Promise(r => setTimeout(r, 1000));
                }
                updateCountdownUI(""); 
                
                if (!isRunning) break;
                
                sendLog(`Rate limit pause complete. Retrying the same prompt...`, "info");
                // DO NOT increment attempt. Let the while loop retry it seamlessly.
                continue;

            } else if (result && result.status === 'rate_limited') {
                // EXISTING: Handle absolute time banners/texts
                const timeStr = result.timeStr;
                const waitMs = getWaitTimeForRateLimit(timeStr);
                const waitMins = Math.ceil(waitMs / 60000);
                
                sendLog(`Absolute rate limit reached! Waiting until ~10 minutes after ${timeStr} (${waitMins} min pause)...`, "warn");
                
                let wSecs = Math.ceil(waitMs / 1000);
                for (let w = wSecs; w > 0; w--) {
                    if (!isRunning) break;
                    updateCountdownUI(`Limit Pause: ${Math.floor(w/60)}m ${String(w%60).padStart(2, '0')}s`);
                    await new Promise(r => setTimeout(r, 1000));
                }
                updateCountdownUI(""); 
                
                if (!isRunning) break;
                
                sendLog(`Rate limit pause complete. Retrying the same prompt...`, "info");
                // DO NOT increment attempt. Let the while loop retry it seamlessly.
                continue;
                
            } else {
                lastErrorMsg = result ? result.message : "Unknown error or timeout.";
                sendLog(`Generation failed on attempt ${attempt + 1}: ${lastErrorMsg}`, "warn");
                attempt++;
            }
        }
        
        if (!isRunning) {
            stoppedForcefully = true;
            break;
        }

        // If it still failed after all retries
        if (!success) {
            sendLog(`All ${maxRetries} retries failed. Creating fallback error image...`, "error");

            // Generate Fallback Error Image
            const errorImageBase64 = createErrorImage(currentPrefix, currentFolder, finalPrompt, lastErrorMsg);
            const filenameImg = `${currentFolder}/${currentPrefix}-ERROR.png`;
            chrome.runtime.sendMessage({ 
                action: "DOWNLOAD_IMAGE", 
                url: errorImageBase64, 
                filename: filenameImg 
            });

            // Generate Error Log Text File
            const logContent = `Failed to generate image [${currentPrefix}] of project [${currentFolder}]\nPrompt: '${finalPrompt}'\nGPT Message: ${lastErrorMsg}`;
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

        // Notify UI to advance the Index input
        try {
            chrome.runtime.sendMessage({ action: "UPDATE_INDEX", index: currentPromptIndex + 1 }).catch(() => {});
        } catch (e) {}

        // Check if there are more valid prompts left to process before initiating the regular wait timer
        const hasMorePrompts = lines.slice(i + 1).some(l => l.trim() && !l.trim().startsWith('#####'));

        if (hasMorePrompts && isRunning) {
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
    
    // Log the actual state when terminating
    if (stoppedForcefully) {
        sendLog("Generation really stopped.", "error");
        try {
            chrome.runtime.sendMessage({ action: "AUTOMATION_ENDED", finishedCompletely: false }).catch(() => {});
        } catch (e) {}
    } else {
        sendLog("Automation routine finished completely.", "success");
        alert("Image Auto-Generation Complete!");
        try {
            chrome.runtime.sendMessage({ action: "AUTOMATION_ENDED", finishedCompletely: true }).catch(() => {});
        } catch (e) {}
    }
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
        let lastRateLimitTimeStr = null;

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
            // Abort immediately if Stop was pressed during the waiting cycle
            if (!isRunning) {
                cleanup();
                resolve({ status: 'error', message: 'Automation halted by user.' });
                return;
            }

            // Check absolute Rate Limit Banner UI
            const limitEl = Array.from(document.querySelectorAll('.text-token-text-secondary, .text-message')).find(el => {
                const txt = (el.innerText || el.textContent || '').toLowerCase();
                return (txt.includes('limit') || txt.includes('limite')) && /\d{1,2}:\d{2}/.test(txt);
            });

            if (limitEl) {
                const timeMatch = (limitEl.innerText || limitEl.textContent || '').match(/(\d{1,2}:\d{2}(?:\s?[aApP][mM])?)/);
                if (timeMatch) {
                    lastRateLimitTimeStr = timeMatch[1];
                    const closeBtn = limitEl.closest('aside')?.querySelector('button[data-testid="close-button"], button[aria-label="Fechar"], button[aria-label="Close"]');
                    if (closeBtn) closeBtn.click(); // Dismiss the banner immediately
                    
                    // If it hasn't generated a new turn yet, abort waiting and resolve immediately to start wait pause
                    if (document.querySelectorAll('article[data-turn="assistant"]').length <= initialTurnCount) {
                        cleanup();
                        resolve({ status: 'rate_limited', timeStr: lastRateLimitTimeStr });
                        return;
                    }
                }
            }
            
            const assistantTurns = document.querySelectorAll('article[data-turn="assistant"]');
            
            // Keep waiting if the new turn hasn't appeared yet
            if (assistantTurns.length <= initialTurnCount) {
                return;
            }

            const lastTurn = assistantTurns[assistantTurns.length - 1];
            
            // Handle A/B Image Choice (Paragen Multi-Gen)
            const multiGenContainer = lastTurn.querySelector('[data-testid="image-paragen-multigen"]');
            if (multiGenContainer) {
                if (!multiGenContainer.dataset.autoHandled) {
                    multiGenContainer.dataset.autoHandled = "true";
                    const choiceBtns = multiGenContainer.querySelectorAll('button.btn-secondary');
                    const skipBtn = multiGenContainer.querySelector('button.text-token-text-tertiary');
                    
                    if (choiceBtns && choiceBtns.length >= 2) {
                        const choiceIndex = Math.random() < 0.5 ? 0 : 1;
                        sendLog(`Image choice prompt detected! Randomly selecting Option ${choiceIndex + 1}...`, "info");
                        choiceBtns[choiceIndex].click();
                    } else if (skipBtn) {
                        sendLog(`Image choice prompt detected, but options not found. Clicking Skip...`, "warn");
                        skipBtn.click();
                    } else {
                        sendLog(`Image choice prompt detected, but no buttons found to click!`, "error");
                    }
                    finishedTime = null; // Reset extraction timer to wait for the final choice UI
                }
                return; // Skip standard processing while in choice mode
            }

            const copyBtn = lastTurn.querySelector('button[data-testid="copy-turn-action-button"]');
            const stopBtn = document.querySelector('button[data-testid="stop-button"]');
            
            // Only begin evaluating images AFTER ChatGPT says generation is "finished"
            const isFinished = copyBtn && !stopBtn;

            if (isFinished) {
                if (!finishedTime) {
                    finishedTime = Date.now();
                    sendLog("Response complete. Waiting 4s for image transitions and overlays to clear...", "info");
                }

                const elapsed = Date.now() - finishedTime;

                // Force a 4-second grace period for the white overlay to vanish and the high-res image to load
                if (elapsed >= 4000) {
                    cleanup();
                    
                    const allImages = Array.from(lastTurn.querySelectorAll('img'));
                    let bestImgUrl = null;

                    for (let img of allImages) {
                        const src = (img.src || '').toLowerCase();
                        const alt = (img.alt || '').toLowerCase();
                        
                        // Skip small avatars and UI icons
                        if (src.includes('profile') || src.includes('avatar') || src.includes('favicon') || img.width < 100) continue;
                        
                        // CRITICAL FIX: Skip the blurred background elements
                        if (img.closest('.blur-2xl')) continue;

                        // CRITICAL FIX: Skip hidden crossfade elements (opacity 0.01)
                        if (img.style.opacity === '0.01' || img.style.opacity === '0') continue;

                        // Must match generated image signatures
                        if (src.includes('oaiusercontent.com') || src.includes('dall-e') || src.includes('estuary') || 
                            alt.includes('generated') || alt.includes('dall·e') || alt.includes('gerada') || alt.includes('criada')) {
                            bestImgUrl = img.src; 
                        }
                    }

                    if (bestImgUrl) {
                        resolve({ status: 'success', url: bestImgUrl });
                    } else {
                        // Text-only fallback parsing
                        let gptTextMsg = (lastTurn.innerText || lastTurn.textContent || '').trim();
                        if (!gptTextMsg) gptTextMsg = "Empty response or unknown error.";

                        // 1. Text duration parsing (e.g., "3 hours and 51 minutes", "3h50", "in 3:50")
                        const durationWaitMs = parseWaitDurationFromText(gptTextMsg);
                        
                        // 2. Text absolute time parsing fallback (e.g., "limit... 14:54")
                        const absoluteLimitMatch = gptTextMsg.match(/(?:limit|limite).*?(\d{1,2}:\d{2}(?:\s?[aApP][mM])?)/i);

                        if (durationWaitMs !== null) {
                            resolve({ status: 'rate_limited_duration', waitMs: durationWaitMs, textMsg: gptTextMsg });
                        } else if (absoluteLimitMatch) {
                            resolve({ status: 'rate_limited', timeStr: absoluteLimitMatch[1] });
                        } else if (lastRateLimitTimeStr) {
                            resolve({ status: 'rate_limited', timeStr: lastRateLimitTimeStr });
                        } else {
                            resolve({ status: 'error', message: gptTextMsg });
                        }
                    }
                }
            } else {
                // If it starts generating again (e.g., multi-step process), reset the stabilization timer
                finishedTime = null;
            }
        }, 1000); // Check every 1 second
    });
}
document.addEventListener('DOMContentLoaded', () => {
    const imagePrompts = document.getElementById('imagePrompts');
    const startNumber = document.getElementById('startNumber');
    const outputFolder = document.getElementById('outputFolder');
    const isVariation = document.getElementById('isVariation');
    const generateAgainPrompt = document.getElementById('generateAgainPrompt');
    const waitTime = document.getElementById('waitTime');
    const retries = document.getElementById('retries');
    const retryTime = document.getElementById('retryTime');
    const dropZone = document.getElementById('dropZone');
    const dragOverlay = document.getElementById('dragOverlay');
    const logArea = document.getElementById('logArea');
    const countdownDisplay = document.getElementById('countdownDisplay');
    const wordWrapCheck = document.getElementById('wordWrapCheck');
    
    // Main execution buttons
    const startAutomationBtn = document.getElementById('startAutomationBtn');
    const stopAutomationBtn = document.getElementById('stopAutomationBtn');

    // Logging utility
    function addLog(message, type = 'info') {
        const entry = document.createElement('div');
        entry.className = `log-entry log-${type}`;
        const time = new Date().toLocaleTimeString();
        entry.textContent = `[${time}] ${message}`;
        logArea.appendChild(entry);
        logArea.scrollTop = logArea.scrollHeight; // Auto-scroll to bottom
    }
    
    // Updates UI Button states
    function setAutomationRunning(isRunning) {
        startAutomationBtn.disabled = isRunning;
        stopAutomationBtn.disabled = !isRunning;
    }

    // Listen for log messages and UI updates from background or content scripts
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === "LOG") {
            addLog(request.message, request.type);
        } else if (request.action === "UPDATE_COUNTDOWN") {
            if (request.text) {
                countdownDisplay.textContent = request.text;
                countdownDisplay.style.display = 'inline';
            } else {
                countdownDisplay.style.display = 'none';
            }
        } else if (request.action === "AUTOMATION_ENDED") {
            setAutomationRunning(false); // Reset buttons safely when content.js terminates
        }
    });

    document.getElementById('clearLogsBtn').addEventListener('click', () => {
        logArea.innerHTML = '';
        addLog("Logs cleared.", "info");
    });

    // --- Export Logs Button ---
    document.getElementById('exportLogsBtn').addEventListener('click', () => {
        const logEntries = Array.from(logArea.querySelectorAll('.log-entry')).map(entry => entry.textContent);
        if (logEntries.length === 0) {
            addLog("No logs to export.", "warn");
            return;
        }
        
        const logText = logEntries.join('\n');
        const blob = new Blob([logText], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        a.download = `chatgpt-auto-gen-logs-${timestamp}.txt`;
        document.body.appendChild(a);
        a.click();
        
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        addLog("Logs exported successfully.", "success");
    });

    // Load saved state
    chrome.storage.local.get(['savedPrompts', 'savedFolder', 'savedGenAgain', 'savedWaitTime', 'savedWordWrap', 'savedRetries', 'savedRetryTime'], (data) => {
        if (data.savedPrompts) imagePrompts.value = data.savedPrompts;
        if (data.savedFolder) outputFolder.value = data.savedFolder;
        if (data.savedGenAgain) generateAgainPrompt.value = data.savedGenAgain;
        if (data.savedWaitTime !== undefined) waitTime.value = data.savedWaitTime;
        if (data.savedRetries !== undefined) retries.value = data.savedRetries;
        if (data.savedRetryTime !== undefined) retryTime.value = data.savedRetryTime;
        
        if (data.savedWordWrap !== undefined) {
            wordWrapCheck.checked = data.savedWordWrap;
        }
        
        // Apply wrap state on load
        imagePrompts.style.whiteSpace = wordWrapCheck.checked ? 'pre-wrap' : 'pre';
        imagePrompts.style.overflowX = wordWrapCheck.checked ? 'hidden' : 'auto';
        
        addLog("Ready. Awaiting commands.", "info");
    });

    // Save state on input
    const saveState = () => {
        chrome.storage.local.set({
            savedPrompts: imagePrompts.value,
            savedFolder: outputFolder.value,
            savedGenAgain: generateAgainPrompt.value,
            savedWaitTime: waitTime.value,
            savedRetries: retries.value,
            savedRetryTime: retryTime.value,
            savedWordWrap: wordWrapCheck.checked
        });
    };
    
    imagePrompts.addEventListener('input', saveState);
    outputFolder.addEventListener('input', saveState);
    generateAgainPrompt.addEventListener('input', saveState);
    waitTime.addEventListener('input', saveState);
    retries.addEventListener('input', saveState);
    retryTime.addEventListener('input', saveState);
    
    // Toggle Word Wrap
    wordWrapCheck.addEventListener('change', () => {
        imagePrompts.style.whiteSpace = wordWrapCheck.checked ? 'pre-wrap' : 'pre';
        imagePrompts.style.overflowX = wordWrapCheck.checked ? 'hidden' : 'auto';
        saveState();
    });

    // Auto-format pasted paths to be relative to Downloads
    outputFolder.addEventListener('paste', (e) => {
        let pastedText = (e.clipboardData || window.clipboardData).getData('text');
        const downloadsLower = 'downloads';
        const idx = pastedText.toLowerCase().indexOf(downloadsLower);
        
        if (idx !== -1) {
            e.preventDefault();
            
            // Extract everything after 'downloads'
            let relativePath = pastedText.substring(idx + downloadsLower.length);
            
            // Remove leading slashes/backslashes
            relativePath = relativePath.replace(/^[\\/]+/, '');
            
            // Normalize remaining backslashes to forward slashes
            relativePath = relativePath.replace(/\\/g, '/');
            
            const start = outputFolder.selectionStart;
            const end = outputFolder.selectionEnd;
            outputFolder.value = outputFolder.value.substring(0, start) + relativePath + outputFolder.value.substring(end);
            outputFolder.selectionStart = outputFolder.selectionEnd = start + relativePath.length;
            
            saveState();
            addLog(`Pasted path auto-formatted to relative folder: "${relativePath || 'Root'}"`, "info");
        }
    });

    // --- Folder Picker Button ---
    document.getElementById('browseFolderBtn').addEventListener('click', async () => {
        try {
            const dirHandle = await window.showDirectoryPicker({ startIn: 'downloads' });
            let suggestedPath = dirHandle.name;
            
            if (outputFolder.value && outputFolder.value.includes('/')) {
                const parentDir = outputFolder.value.substring(0, outputFolder.value.lastIndexOf('/') + 1);
                suggestedPath = parentDir + dirHandle.name;
            }

            const relativePath = prompt(
                `Browser security hides the full folder path. We can only see the folder name: "${dirHandle.name}".\n\nIf this is inside a subfolder, please confirm/adjust the full relative path below (e.g., "1kv/${dirHandle.name}"):`, 
                suggestedPath
            );

            if (relativePath !== null && relativePath.trim() !== '') {
                outputFolder.value = relativePath.trim();
                saveState();
                addLog(`Selected folder path: "${outputFolder.value}". Note: Images will be saved inside 'Downloads/${outputFolder.value}' due to browser security restrictions.`, "info");
            }
        } catch (error) {
            if (error.name !== 'AbortError') {
                addLog(`Folder picker error: ${error.message}`, "error");
            }
        }
    });

    // --- Drag and Drop File Parsing ---
    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dragOverlay.style.display = 'flex';
    });
    dropZone.addEventListener('dragleave', (e) => {
        e.preventDefault();
        dragOverlay.style.display = 'none';
    });
    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dragOverlay.style.display = 'none';
        
        const file = e.dataTransfer.files[0];
        if (!file || (!file.name.endsWith('.txt') && !file.name.endsWith('.md'))) {
            addLog(`Invalid file type dropped: ${file?.name}. Only .txt and .md supported.`, "warn");
            return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            const content = e.target.result;
            const parsedText = parseFileContent(content);
            imagePrompts.value += (imagePrompts.value ? '\n' : '') + parsedText + '\n';
            saveState();
            addLog(`Successfully loaded content from ${file.name}`, "success");
        };
        reader.readAsText(file);
    });

    function parseFileContent(content) {
        const lines = content.split(/\r?\n/);
        let capturing = false;
        let foundImageTag = false;
        let capturedText = [];

        for (let line of lines) {
            if (line.trim().toLowerCase() === '--- image') {
                foundImageTag = true;
                capturing = true;
                continue;
            }
            if (capturing && line.trim().startsWith('---')) {
                capturing = false;
                break;
            }
            if (capturing) {
                capturedText.push(line);
            }
        }
        return foundImageTag ? capturedText.join('\n').trim() : content.trim();
    }

    // --- Add to List Button ---
    document.getElementById('addToListBtn').addEventListener('click', () => {
        const num = String(startNumber.value).padStart(5, '0');
        const folder = outputFolder.value || 'Downloads';
        const varText = isVariation.checked ? 'Variation ' : '';
        
        const configLine = `##### ${varText}${num} "${folder}"\n`;
        
        if (imagePrompts.value.length > 0 && !imagePrompts.value.endsWith('\n')) {
            imagePrompts.value += '\n';
        }
        imagePrompts.value += configLine;
        
        saveState();
        addLog(`Added config header: ${configLine.trim()}`, "info");
    });

    // --- Clear List Button ---
    document.getElementById('clearListBtn').addEventListener('click', () => {
        if(confirm('Are you sure you want to clear the list?')) {
            imagePrompts.value = '';
            saveState();
            addLog("Prompt list cleared.", "warn");
        }
    });

    // --- Start Automation ---
    startAutomationBtn.addEventListener('click', () => {
        if (!imagePrompts.value.trim()) {
            addLog("Prompt list is empty. Nothing to generate.", "warn");
            return;
        }

        // Search for any open ChatGPT tab instead of the current window 
        chrome.tabs.query({url: "*://chatgpt.com/*"}, (tabs) => {
            if (!tabs || tabs.length === 0) {
                addLog("Error: Could not find an open ChatGPT tab. Please open chatgpt.com.", "error");
                alert("Please open ChatGPT (chatgpt.com) to run the automation.");
                return;
            }
            
            const targetTab = tabs[0];
            addLog("Initializing automation on ChatGPT...", "info");
            
            setAutomationRunning(true);
            
            chrome.tabs.sendMessage(targetTab.id, {
                action: "START_AUTOMATION",
                prompts: imagePrompts.value,
                generateAgainText: generateAgainPrompt.value,
                waitTime: parseInt(waitTime.value, 10) || 0,
                retries: parseInt(retries.value, 10) || 0,
                retryTime: parseInt(retryTime.value, 10) || 0
            }).catch((err) => {
                addLog("Connection failed. Please REFRESH your ChatGPT tab and try again.", "error");
                console.error("Message send error:", err);
                setAutomationRunning(false);
            });
        });
    });

    // --- Stop Automation ---
    stopAutomationBtn.addEventListener('click', () => {
        addLog("Stop button pressed. Sending stop signal to ChatGPT...", "warn");
        
        chrome.tabs.query({url: "*://chatgpt.com/*"}, (tabs) => {
            if (tabs && tabs.length > 0) {
                chrome.tabs.sendMessage(tabs[0].id, { action: "STOP_AUTOMATION" }).catch(() => {});
            }
        });
    });
});
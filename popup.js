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
    const lineNumbers = document.getElementById('lineNumbers');
    const startIndexInput = document.getElementById('startIndex'); // New Input
    
    // Main execution buttons
    const startAutomationBtn = document.getElementById('startAutomationBtn');
    const stopAutomationBtn = document.getElementById('stopAutomationBtn');

    // Track text length to detect deletion
    let previousTextLength = 0;

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
        startIndexInput.disabled = isRunning;
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
        } else if (request.action === "UPDATE_INDEX") {
            startIndexInput.value = request.index;
            saveState();
        } else if (request.action === "AUTOMATION_ENDED") {
            setAutomationRunning(false);
            if (request.finishedCompletely) {
                startIndexInput.value = 1;
                saveState();
            }
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
    chrome.storage.local.get(['savedPrompts', 'savedFolder', 'savedGenAgain', 'savedWaitTime', 'savedWordWrap', 'savedRetries', 'savedRetryTime', 'savedStartIndex'], (data) => {
        if (data.savedPrompts) {
            imagePrompts.value = data.savedPrompts;
            previousTextLength = imagePrompts.value.length;
        }
        if (data.savedFolder) outputFolder.value = data.savedFolder;
        if (data.savedGenAgain) generateAgainPrompt.value = data.savedGenAgain;
        if (data.savedWaitTime !== undefined) waitTime.value = data.savedWaitTime;
        if (data.savedRetries !== undefined) retries.value = data.savedRetries;
        if (data.savedRetryTime !== undefined) retryTime.value = data.savedRetryTime;
        if (data.savedStartIndex !== undefined) startIndexInput.value = data.savedStartIndex;
        
        if (data.savedWordWrap !== undefined) {
            wordWrapCheck.checked = data.savedWordWrap;
        }
        
        // Apply wrap state on load
        imagePrompts.style.whiteSpace = wordWrapCheck.checked ? 'pre-wrap' : 'pre';
        imagePrompts.style.overflowX = wordWrapCheck.checked ? 'hidden' : 'auto';
        
        updateLineNumbers();
        
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
            savedWordWrap: wordWrapCheck.checked,
            savedStartIndex: startIndexInput.value
        });
    };
    
    imagePrompts.addEventListener('input', () => {
        const currentLength = imagePrompts.value.length;
        // Detect text deletion -> Reset Index to 1
        if (currentLength < previousTextLength) {
            startIndexInput.value = 1;
        }
        previousTextLength = currentLength;
        
        saveState();
        updateLineNumbers();
    });

    startIndexInput.addEventListener('input', saveState);
    
    // Sync scrolling of line numbers with textarea
    imagePrompts.addEventListener('scroll', () => {
        lineNumbers.scrollTop = imagePrompts.scrollTop;
    });

    // Recalculate wrapping sizes on window resize
    window.addEventListener('resize', updateLineNumbers);
    
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
        updateLineNumbers();
    });

    // --- Line Number Generation ---
    function updateLineNumbers() {
        const lines = imagePrompts.value.split('\n');
        let html = '';
        let promptIndex = 1;
        
        // Ensure mirror exists for wrap height calculation
        let mirror = document.getElementById('textarea-mirror');
        if (!mirror) {
            mirror = document.createElement('div');
            mirror.id = 'textarea-mirror';
            document.body.appendChild(mirror);
            
            // Sync styles perfectly with textarea
            const styles = window.getComputedStyle(imagePrompts);
            mirror.style.fontFamily = styles.fontFamily;
            mirror.style.fontSize = styles.fontSize;
            mirror.style.lineHeight = '20px'; // Matching explicit CSS
            mirror.style.padding = '0'; // measuring inner height
            mirror.style.border = 'none';
            mirror.style.boxSizing = 'border-box';
            mirror.style.whiteSpace = 'pre-wrap';
            mirror.style.wordWrap = 'break-word';
            mirror.style.visibility = 'hidden';
            mirror.style.position = 'absolute';
            mirror.style.top = '-9999px';
            mirror.style.left = '-9999px';
        }
        
        // Match the inner width of textarea (excludes vertical scrollbar)
        const paddingLeft = parseFloat(window.getComputedStyle(imagePrompts).paddingLeft) || 0;
        const paddingRight = parseFloat(window.getComputedStyle(imagePrompts).paddingRight) || 0;
        const innerWidth = imagePrompts.clientWidth - paddingLeft - paddingRight;
        
        if (innerWidth > 0) {
            mirror.style.width = innerWidth + 'px';
        }

        const isWrap = wordWrapCheck.checked && innerWidth > 0;
        const defaultLineHeight = 20;

        for (let i = 0; i < lines.length; i++) {
            let line = lines[i];
            let numStr = '';
            
            // Only index lines that are not metadata and not completely empty
            if (line.trim().startsWith('#####')) {
                numStr = '';
            } else if (line.trim() !== '') {
                numStr = promptIndex++;
            }

            let heightStr = `height: ${defaultLineHeight}px;`;
            if (isWrap) {
                // measure height for wrapped lines
                mirror.textContent = line || ' '; // fallback to space so it has 1 line height
                let h = mirror.offsetHeight;
                if (h > 0) {
                    heightStr = `height: ${h}px;`;
                }
            }

            html += `<div style="${heightStr} display: flex; align-items: flex-start; justify-content: flex-end;">${numStr}</div>`;
        }
        
        lineNumbers.innerHTML = html;
    }

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
            previousTextLength = imagePrompts.value.length;
            
            saveState();
            updateLineNumbers();
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
        previousTextLength = imagePrompts.value.length;
        
        saveState();
        updateLineNumbers();
        addLog(`Added config header: ${configLine.trim()}`, "info");
    });

    // --- Clear List Button ---
    document.getElementById('clearListBtn').addEventListener('click', () => {
        if(confirm('Are you sure you want to clear the list?')) {
            imagePrompts.value = '';
            previousTextLength = 0;
            startIndexInput.value = 1;
            
            saveState();
            updateLineNumbers();
            addLog("Prompt list cleared. Index reset to 1.", "warn");
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
            const activeIndex = parseInt(startIndexInput.value, 10) || 1;
            
            addLog(`Initializing automation on ChatGPT... (Starting from Index: ${activeIndex})`, "info");
            
            setAutomationRunning(true);
            
            chrome.tabs.sendMessage(targetTab.id, {
                action: "START_AUTOMATION",
                prompts: imagePrompts.value,
                startIndex: activeIndex,
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
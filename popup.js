document.addEventListener('DOMContentLoaded', () => {
    const imagePrompts = document.getElementById('imagePrompts');
    const startNumber = document.getElementById('startNumber');
    const outputFolder = document.getElementById('outputFolder');
    const isVariation = document.getElementById('isVariation');
    const generateAgainPrompt = document.getElementById('generateAgainPrompt');
    const dropZone = document.getElementById('dropZone');
    const dragOverlay = document.getElementById('dragOverlay');
    const logArea = document.getElementById('logArea');

    // Logging utility
    function addLog(message, type = 'info') {
        const entry = document.createElement('div');
        entry.className = `log-entry log-${type}`;
        const time = new Date().toLocaleTimeString();
        entry.textContent = `[${time}] ${message}`;
        logArea.appendChild(entry);
        logArea.scrollTop = logArea.scrollHeight; // Auto-scroll to bottom
    }

    // Listen for log messages from background or content scripts
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === "LOG") {
            addLog(request.message, request.type);
        }
    });

    document.getElementById('clearLogsBtn').addEventListener('click', () => {
        logArea.innerHTML = '';
        addLog("Logs cleared.", "info");
    });

    // Load saved state
    chrome.storage.local.get(['savedPrompts', 'savedFolder', 'savedGenAgain'], (data) => {
        if (data.savedPrompts) imagePrompts.value = data.savedPrompts;
        if (data.savedFolder) outputFolder.value = data.savedFolder;
        if (data.savedGenAgain) generateAgainPrompt.value = data.savedGenAgain;
        addLog("Ready. Awaiting commands.", "info");
    });

    // Save state on input
    const saveState = () => {
        chrome.storage.local.set({
            savedPrompts: imagePrompts.value,
            savedFolder: outputFolder.value,
            savedGenAgain: generateAgainPrompt.value
        });
    };
    imagePrompts.addEventListener('input', saveState);
    outputFolder.addEventListener('input', saveState);
    
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

    generateAgainPrompt.addEventListener('input', saveState);

    // --- Folder Picker Button ---
    document.getElementById('browseFolderBtn').addEventListener('click', async () => {
        try {
            // Request user to select a directory starting in downloads
            const dirHandle = await window.showDirectoryPicker({ startIn: 'downloads' });
            
            // Browser security prevents extensions from reading the absolute or relative path.
            // We only get the leaf folder name (e.g., 'br').
            let suggestedPath = dirHandle.name;
            
            // If the user already typed a parent path (like '1kv/'), append the new folder to it
            if (outputFolder.value && outputFolder.value.includes('/')) {
                const parentDir = outputFolder.value.substring(0, outputFolder.value.lastIndexOf('/') + 1);
                suggestedPath = parentDir + dirHandle.name;
            }

            // Ask the user to confirm or adjust the relative path due to browser limitations
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
            // Ignore AbortError (user clicked cancel)
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
        
        // Append to the bottom of the list
        if (imagePrompts.value.length > 0 && !imagePrompts.value.endsWith('\n')) {
            imagePrompts.value += '\n';
        }
        imagePrompts.value += configLine;
        
        startNumber.value = parseInt(startNumber.value) + 1;
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
    document.getElementById('startAutomationBtn').addEventListener('click', () => {
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
            
            const targetTab = tabs[0]; // Target the first found ChatGPT tab
            addLog("Initializing automation on ChatGPT...", "info");
            
            chrome.tabs.sendMessage(targetTab.id, {
                action: "START_AUTOMATION",
                prompts: imagePrompts.value,
                generateAgainText: generateAgainPrompt.value
            }).catch((err) => {
                // This catches the "Receiving end does not exist" error
                addLog("Connection failed. Please REFRESH your ChatGPT tab and try again.", "error");
                console.error("Message send error:", err);
            });
        });
    });
});
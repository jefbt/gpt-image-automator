chrome.action.onClicked.addListener((tab) => {
    // Open the popup.html in a standalone popup window instead of default dropdown
    chrome.windows.create({
        url: chrome.runtime.getURL("popup.html"),
        type: "popup",
        width: 500,
        height: 750
    });
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "DOWNLOAD_IMAGE") {
        // Remove leading slashes if any to prevent absolute path errors in downloads
        const safeFilename = request.filename.replace(/^\/+/, '');
        
        chrome.downloads.download({
            url: request.url,
            filename: safeFilename,
            saveAs: false // Download automatically without prompting
        }, (downloadId) => {
            if (chrome.runtime.lastError) {
                console.error("Download failed: ", chrome.runtime.lastError);
                // Send log to UI
                chrome.runtime.sendMessage({ 
                    action: "LOG", 
                    message: `Download failed: ${chrome.runtime.lastError.message}`, 
                    type: "error" 
                }).catch(() => {});
            } else {
                console.log(`Successfully started download ID: ${downloadId} for ${safeFilename}`);
                // Send log to UI
                chrome.runtime.sendMessage({ 
                    action: "LOG", 
                    message: `Saved locally as: ${safeFilename}`, 
                    type: "success" 
                }).catch(() => {});
            }
        });
    }
});
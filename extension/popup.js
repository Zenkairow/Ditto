document.getElementById('syncBtn').addEventListener('click', async () => {
    const btn = document.getElementById('syncBtn');
    if (btn.disabled) return;
    const statusEl = document.getElementById('status');
    const btnText = btn.querySelector('.btn-text');

    btn.disabled = true;
    btn.classList.add('loading');
    statusEl.textContent = 'Auto-scrolling to load full chat history...';
    statusEl.style.color = 'var(--text-secondary)';

    // Reset layout for long errors
    statusEl.style.height = 'auto';
    statusEl.style.lineHeight = '1.4';
    statusEl.style.marginTop = '16px';

    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        
        let scrapeResult = {};
        
        if (tab.url.includes("chatgpt.com/c/")) {
            const chatId = tab.url.split('/c/')[1].split('?')[0];

            // 1. Fetch Session Token
            statusEl.textContent = 'Authenticating with ChatGPT...';
            const sessionRes = await fetch("https://chatgpt.com/api/auth/session").catch(() => {
                throw new Error("Network error while trying to reach ChatGPT API. Are you offline?");
            });
            
            if (!sessionRes.ok) {
                if (sessionRes.status === 401 || sessionRes.status === 403) {
                    throw new Error("Session expired. Please log in to ChatGPT and try again.");
                }
                throw new Error(`Failed to get ChatGPT session (HTTP ${sessionRes.status}).`);
            }
            
            const sessionData = await sessionRes.json();
            const accessToken = sessionData.accessToken;
            
            if (!accessToken) {
                throw new Error("No access token found. Please log in to ChatGPT.");
            }

            statusEl.textContent = 'Fetching complete chat history silently...';

            // 2. Fetch Internal Chat Data with Bearer Token
            const chatRes = await fetch(`https://chatgpt.com/backend-api/conversation/${chatId}`, {
                headers: {
                    "Authorization": `Bearer ${accessToken}`
                }
            }).catch(() => {
                throw new Error("Network error while fetching conversation. Check your connection.");
            });
            
            if (!chatRes.ok) {
                if (chatRes.status === 404) {
                    throw new Error("Chat not found. It may have been deleted.");
                }
                throw new Error(`Failed to fetch internal chat data (HTTP ${chatRes.status}).`);
            }
            const chatData = await chatRes.json();

            // 3. Traverse the mapping tree chronologically
            let currentNodeId = chatData.current_node;
            const messages = [];
            
            while (currentNodeId) {
                const node = chatData.mapping[currentNodeId];
                if (node.message && node.message.content && node.message.content.parts) {
                    const role = node.message.author.role;
                    if (role === 'user' || role === 'assistant') {
                        // Filter out some non-text parts if any
                        const textParts = node.message.content.parts.filter(p => typeof p === 'string');
                        if (textParts.length > 0) {
                            const text = textParts.join('\n');
                            messages.unshift({
                                role: role === 'assistant' ? 'ai' : 'user',
                                content: text,
                                timestamp: Math.floor((node.message.create_time || Date.now()) * 1000)
                            });
                        }
                    }
                }
                currentNodeId = node.parent;
            }

            if (messages.length === 0) {
                throw new Error("No text messages found in this conversation.");
            }

            scrapeResult = { 
                payload: { 
                    chat_id: chatId, 
                    chat_title: chatData.title || chatId,
                    messages: messages,
                    url: tab.url
                } 
            };
        } else {
            statusEl.textContent = 'Universal Mode: Scraping visible text...';
            
            // Generic fallback via content script injection
            const results = await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: () => {
                    const main = document.querySelector('main') || document.body;
                    return {
                        text: main.innerText,
                        title: document.title
                    };
                }
            }).catch((err) => {
                if (err.message.includes("Cannot access contents of url")) {
                    throw new Error("Cannot extract text from this specific page (browser restriction). Try on a normal webpage.");
                }
                throw err;
            });
            
            if (!results || !results[0] || !results[0].result || !results[0].result.text) {
                throw new Error("Failed to extract text from this webpage.");
            }
            
            const rawText = results[0].result.text;
            const docTitle = results[0].result.title;
            // Generate a synthetic chat ID using domain and timestamp
            const domain = new URL(tab.url).hostname.replace('www.', '');
            const chatId = `universal-${domain}-${Date.now()}`;
            
            scrapeResult = {
                payload: {
                    chat_id: chatId,
                    chat_title: docTitle || "Universal Extraction",
                    raw_text: rawText,
                    url: tab.url
                }
            };
        }

        statusEl.textContent = 'Syncing and parsing with Extension Brain...';

        const response = await chrome.runtime.sendMessage({ type: "SYNC_CHAT", payload: scrapeResult.payload });

        if (!response || response.status === "error") {
            throw new Error(response ? response.error : "Background worker failed to respond. Please reload the extension.");
        }

        const data = response.result;

        // Robust Clipboard Copy Fallback
        if (data.bootstrap_payload) {
            try {
                // Try modern API first
                await navigator.clipboard.writeText(data.bootstrap_payload);
            } catch (clipboardErr) {
                // Fallback for "Document is not focused" or async timeout errors
                const textArea = document.createElement("textarea");
                textArea.value = data.bootstrap_payload;
                // Avoid scrolling to bottom
                textArea.style.top = "0";
                textArea.style.left = "0";
                textArea.style.position = "fixed";
                document.body.appendChild(textArea);
                textArea.focus();
                textArea.select();
                try {
                    document.execCommand('copy');
                } catch (fallbackErr) {
                    throw new Error("Clipboard copy blocked. You can still manually copy it from the Local Dashboard!");
                }
                document.body.removeChild(textArea);
            }
        }

        btn.classList.remove('loading');
        btn.classList.add('success');
        btnText.textContent = "Copied to Clipboard!";
        statusEl.textContent = "Synced and Copied to Clipboard.";
        statusEl.style.color = "var(--success-color)";
        
        setTimeout(() => {
            btn.classList.remove('success');
            btn.disabled = false;
            btnText.textContent = "Sync Active Chat";
            statusEl.textContent = "";
        }, 3000);

    } catch (err) {
        btn.disabled = false;
        btn.classList.remove('loading');
        
        // Granular Error Display
        if (err.message && err.message.includes("Gemini API Key is not set")) {
            statusEl.innerHTML = "API Key missing.<br>Please set it in the Dashboard.";
        } else {
            // Show the specific error thrown from background.js or locally
            statusEl.textContent = err.message || "An unexpected error occurred.";
        }
        statusEl.style.color = "#ef4444"; // Red color
        
        // Do NOT auto-clear errors so the user has time to read them
    }
});

document.getElementById('dashboardBtn')?.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") });
});

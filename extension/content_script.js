function scrapeChatGPT() {
    try {
        // 1. Extract Chat ID from URL (e.g. chatgpt.com/c/12345678-abcd)
        const pathParts = window.location.pathname.split('/');
        let chatId = "unknown_chat";
        if (pathParts.length >= 3 && pathParts[1] === 'c') {
            chatId = pathParts[2];
        }

        // 2. Scrape Messages
        const messageNodes = document.querySelectorAll('[data-message-author-role]');
        const messages = [];

        messageNodes.forEach((node, index) => {
            const role = node.getAttribute('data-message-author-role');
            let content = "";
            
            // Reconstruct text but preserve code blocks
            const contentNode = node.querySelector('.markdown') || node;
            
            // A simple heuristic for markdown preservation:
            const blocks = contentNode.childNodes;
            blocks.forEach(block => {
                if (block.tagName === 'PRE') {
                    // Extract code content and language if available
                    const codeNode = block.querySelector('code');
                    const langMatch = codeNode ? codeNode.className.match(/language-(\w+)/) : null;
                    const lang = langMatch ? langMatch[1] : '';
                    const codeText = codeNode ? codeNode.innerText : block.innerText;
                    content += `\n\`\`\`${lang}\n${codeText}\n\`\`\`\n`;
                } else if (block.innerText) {
                    content += block.innerText + "\n";
                } else if (block.textContent) {
                    content += block.textContent + "\n";
                }
            });

            messages.push({
                role: role,
                content: content.trim(),
                timestamp: Date.now() + index // Simple unique sequential timestamp for ordering
            });
        });

        if (messages.length === 0) {
            return { status: 'error', error: "No messages found on this page." };
        }

        // 3. Return Payload to Popup
        const payload = {
            chat_id: chatId,
            messages: messages
        };

        return { status: 'success', payload: payload };

    } catch (e) {
        return { status: 'error', error: e.message };
    }
}

async function autoScrollAndScrape() {
    try {
        // Find ChatGPT scroll container (the container holding the messages)
        const scrollContainer = document.querySelector('div[class*="overflow-y-auto"]') || document.documentElement;
        const originalScroll = scrollContainer.scrollTop;
        
        // Scroll to the absolute top to force ChatGPT to render older lazy-loaded messages into the DOM
        scrollContainer.scrollTo(0, 0);
        
        // Wait 1.5 seconds for React to fetch and render the older messages
        await new Promise(resolve => setTimeout(resolve, 1500));
        
        // Now run the scraping logic on the fully loaded DOM
        const result = scrapeChatGPT();
        
        // Restore user's original scroll position
        scrollContainer.scrollTo(0, originalScroll);
        
        return result;
    } catch (e) {
        return { status: 'error', error: "Auto-scroll failed: " + e.message };
    }
}

// Return the Promise directly to executeScript
autoScrollAndScrape();

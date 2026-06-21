let currentPayload = "";
let currentChatId = null;

// [FIX C1] DOM Sanitization Utility
// Prevents XSS attacks from maliciously crafted chat titles or message contents.
function sanitizeHTML(str) {
    if (!str) return '';
    return str.toString()
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

async function loadSessions() {
    try {
        const storageData = await chrome.storage.local.get(null);
        const sessions = [];
        
        for (const [key, value] of Object.entries(storageData)) {
            if (key.startsWith('session_')) {
                sessions.push(value);
            }
        }
        
        sessions.sort((a, b) => b.timestamp - a.timestamp);
        
        const list = document.getElementById('sessionList');
        list.innerHTML = '';
        
        sessions.forEach(s => {
            const el = document.createElement('div');
            el.className = 'session-item glass bg-black bg-opacity-20 p-4 rounded-xl cursor-pointer group relative';
            
            // [FIX C1] Sanitize chat title before injecting via innerHTML
            const safeTitle = sanitizeHTML(s.chat_title || s.chat_id);
            const dateStr = new Date(s.timestamp).toLocaleString(undefined, {month:'short', day:'numeric', hour:'2-digit', minute:'2-digit'});
            
            el.innerHTML = `
                <div class="pr-8">
                    <div class="font-semibold text-gray-200 truncate tracking-wide text-[15px] mb-1">${safeTitle}</div>
                    <div class="flex items-center text-xs text-indigo-300/70 font-medium">
                        <svg class="w-3.5 h-3.5 mr-1.5 opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                        ${dateStr}
                    </div>
                </div>
                <button class="delete-btn absolute top-1/2 -translate-y-1/2 right-3 text-red-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition duration-200 p-2 rounded-lg hover:bg-white hover:bg-opacity-5" data-id="${s.chat_id}">
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                </button>
            `;
            el.onclick = (e) => {
                if (!e.target.closest('.delete-btn')) {
                    loadSessionDetail(s.chat_id);
                }
            };
            
            const deleteBtn = el.querySelector('.delete-btn');
            deleteBtn.onclick = (e) => deleteSession(s.chat_id, e);
            
            list.appendChild(el);
        });
    } catch (e) { console.error("Ditto: Error loading sessions", e); }
}

async function loadSessionDetail(chatId) {
    try {
        currentChatId = chatId;
        const storageData = await chrome.storage.local.get(`session_${chatId}`);
        const data = storageData[`session_${chatId}`];
        
        if (!data) return;
        
        const emptyState = document.getElementById('emptyState');
        emptyState.style.opacity = '0';
        setTimeout(() => emptyState.classList.add('hidden'), 300);
        
        document.getElementById('diffView').classList.remove('hidden');
        
        // [FIX C1] Use textContent for the main view title
        document.getElementById('viewTitle').textContent = data.chat_title || data.chat_id;
        
        let rawText = "";
        if(data.raw && data.raw.messages && data.raw.messages.length > 0) {
            data.raw.messages.forEach(m => { 
                const roleColor = m.role === 'user' ? 'text-indigo-400' : 'text-purple-400';
                // [FIX C1] Sanitize role and content
                const safeRole = sanitizeHTML(m.role).toUpperCase();
                const safeContent = sanitizeHTML(m.content);
                rawText += `<span class="${roleColor} font-bold">[${safeRole}]</span>:\n${safeContent}\n\n---\n\n`; 
            });
        } else if(data.raw && data.raw.raw_text) {
            // [FIX C1] Sanitize universal text extraction
            rawText = `<span class="text-indigo-400 font-bold">[UNIVERSAL EXTRACTION]</span>:\n` + sanitizeHTML(data.raw.raw_text);
        }
        
        // Convert newlines to breaks after sanitization
        document.getElementById('rawContent').innerHTML = rawText.replace(/\n/g, '<br>');
        
        // [FIX C1] textContent is naturally safe from XSS
        document.getElementById('payloadContent').textContent = data.bootstrap_payload;
        currentPayload = data.bootstrap_payload;
    } catch (e) { console.error("Ditto: Error loading session details", e); }
}

document.getElementById('copyBtn').onclick = () => {
    if(currentPayload) {
        navigator.clipboard.writeText(currentPayload).catch(err => {
            console.error("Ditto: Clipboard copy failed", err);
            alert("Clipboard copy blocked by browser. Please manually select and copy the text.");
        });
        const btn = document.getElementById('copyBtn');
        const origHTML = btn.innerHTML;
        btn.innerHTML = `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg> Copied!`;
        btn.classList.add('btn-success');
        btn.classList.remove('btn-primary');
        setTimeout(() => { 
            btn.innerHTML = origHTML; 
            btn.classList.remove('btn-success'); 
            btn.classList.add('btn-primary');
        }, 2000);
    }
};

function toggleSettings() { 
    const modal = document.getElementById('settingsModal');
    if (modal.classList.contains('hidden')) {
        chrome.storage.local.get('GEMINI_API_KEY', (data) => {
            document.getElementById('apiKeyInput').value = data.GEMINI_API_KEY || '';
            modal.classList.remove('hidden');
            setTimeout(() => modal.style.opacity = '1', 10);
        });
    } else {
        modal.style.opacity = '0';
        setTimeout(() => modal.classList.add('hidden'), 300);
    }
}

async function saveSettings() {
    const key = document.getElementById('apiKeyInput').value.trim();
    if(!key) return alert("Please enter a valid API key.");
    try {
        await chrome.storage.local.set({ 'GEMINI_API_KEY': key });
        toggleSettings(); 
        alert("Configuration saved successfully. Ditto is ready to sync.");
    } catch(e) { 
        console.error("Ditto: Failed to save API key", e);
        alert("Failed to save configuration. Browser storage might be unavailable."); 
    }
}

async function deleteSession(chatId, event) {
    event.stopPropagation();
    if(!confirm("Are you sure you want to permanently delete this chat?")) return;
    try {
        await chrome.storage.local.remove(`session_${chatId}`);
        if(currentChatId === chatId) {
            document.getElementById('diffView').classList.add('hidden');
            const emptyState = document.getElementById('emptyState');
            emptyState.classList.remove('hidden');
            setTimeout(() => emptyState.style.opacity = '1', 10);
            currentChatId = null;
        }
        loadSessions();
    } catch(e) { 
        console.error("Ditto: Failed to delete session", e);
        alert("Failed to delete chat."); 
    }
}

document.getElementById('settingsBtn').onclick = toggleSettings;
document.getElementById('closeSettingsBtn').onclick = toggleSettings;
document.getElementById('saveSettingsBtn').onclick = saveSettings;

loadSessions();

// background.js — Ditto v1.0.1 (Hardened)

// ============================================================
// SYNC LOCK: Prevents race conditions on concurrent syncs
// Keyed by chat_id so different chats can sync in parallel,
// but the same chat cannot be synced twice simultaneously.
// ============================================================
const syncLocks = new Map();

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === "SYNC_CHAT") {
        const chatId = request.payload?.chat_id;

        // [FIX C4] Race condition guard
        if (chatId && syncLocks.has(chatId)) {
            sendResponse({ status: "error", error: "A sync for this chat is already in progress. Please wait." });
            return true;
        }

        if (chatId) syncLocks.set(chatId, true);

        syncChat(request.payload)
            .then(result => sendResponse({ status: "success", result }))
            .catch(error => sendResponse({ status: "error", error: error.message }))
            .finally(() => { if (chatId) syncLocks.delete(chatId); });

        return true; // Indicates asynchronous response
    }
});

// ============================================================
// FETCH WITH TIMEOUT + RETRY (Fixes C2, C3)
// - AbortSignal.timeout for 90-second hard cutoff
// - Exponential backoff retry on 429, 500, 502, 503
// ============================================================
async function fetchWithRetry(url, options, maxRetries = 3) {
    const retryableStatuses = [429, 500, 502, 503];

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            // [FIX C2] 90-second timeout to prevent infinite hangs
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 90000);

            const response = await fetch(url, {
                ...options,
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            // [FIX C3] Retry on transient server errors
            if (retryableStatuses.includes(response.status) && attempt < maxRetries) {
                const delay = Math.pow(2, attempt + 1) * 1000; // 2s, 4s, 8s
                console.warn(`Ditto: Gemini returned ${response.status}. Retrying in ${delay / 1000}s... (attempt ${attempt + 1}/${maxRetries})`);
                await new Promise(resolve => setTimeout(resolve, delay));
                continue;
            }

            return response;
        } catch (err) {
            if (err.name === 'AbortError') {
                throw new Error("Gemini API timed out after 90 seconds. The chat may be too large, or Google's servers may be busy. Please try again.");
            }
            // Network-level errors (offline, DNS failure)
            if (attempt < maxRetries) {
                const delay = Math.pow(2, attempt + 1) * 1000;
                console.warn(`Ditto: Network error. Retrying in ${delay / 1000}s...`, err.message);
                await new Promise(resolve => setTimeout(resolve, delay));
                continue;
            }
            throw new Error("Network error: Unable to reach Google's Gemini API. Check your internet connection.");
        }
    }
}

// ============================================================
// HARDENED JSON PARSER (Fixes D2, D3)
// Multi-stage fallback to handle any LLM output format.
// ============================================================
function hardenedJsonParse(responseText) {
    // Stage 1: Try extracting from ```json ... ``` markdown wrappers
    const jsonMatch = responseText.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
    let jsonString = jsonMatch ? jsonMatch[1] : responseText;

    // Stage 2: Strip <thinking> blocks if present
    jsonString = jsonString.replace(/<thinking>[\s\S]*?<\/thinking>/g, '').trim();

    // Stage 3: Strip BOM and any leading prose before the first `{`
    jsonString = jsonString.replace(/^\uFEFF/, ''); // Remove BOM
    const firstBrace = jsonString.indexOf('{');
    const lastBrace = jsonString.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        jsonString = jsonString.substring(firstBrace, lastBrace + 1);
    }

    // Stage 4: Parse
    let parsed;
    try {
        parsed = JSON.parse(jsonString);
    } catch (e) {
        // Stage 5: Aggressive cleanup — remove control characters
        const cleaned = jsonString
            .replace(/[\x00-\x1F\x7F]/g, ' ')  // Remove control chars
            .replace(/,\s*}/g, '}')              // Remove trailing commas
            .replace(/,\s*]/g, ']');             // Remove trailing commas in arrays
        try {
            parsed = JSON.parse(cleaned);
        } catch (e2) {
            console.error("Ditto: All JSON parsing stages failed. Raw:", jsonString.substring(0, 500));
            throw new Error("Failed to parse Gemini's response. The model may have returned malformed JSON. Try syncing again.");
        }
    }

    // [FIX D3] Normalize pillar keys: lowercase, replace hyphens with underscores
    const normalized = {};
    const VALID_PILLARS = ['north_star', 'behavioral_matrix', 'environment_constraints', 'knowledge_graph', 'decision_ledger', 'the_graveyard', 'the_handoff'];

    for (const [key, value] of Object.entries(parsed)) {
        const normalizedKey = key.toLowerCase().replace(/-/g, '_').replace(/ /g, '_');
        if (VALID_PILLARS.includes(normalizedKey)) {
            // Ensure value is always an array of strings
            normalized[normalizedKey] = Array.isArray(value) ? value.map(String) : [String(value)];
        } else if (key === 'chat_title') {
            normalized.chat_title = value; // Preserve metadata keys
        } else {
            console.warn(`Ditto: Unknown pillar key "${key}" returned by Gemini. Storing under normalized key.`);
            normalized[normalizedKey] = Array.isArray(value) ? value.map(String) : [String(value)];
        }
    }

    // Ensure all 7 pillars exist (default to empty array)
    for (const pillar of VALID_PILLARS) {
        if (!normalized[pillar]) {
            normalized[pillar] = [];
        }
    }

    return normalized;
}

// ============================================================
// ROLE-WEIGHTED SCRUBBER (Fix D1)
// Only strips actual HTML block/inline tags, preserves
// angle-bracket text in code discussions.
// ============================================================
function scrubContent(content, isAiResponse) {
    if (!isAiResponse) return content;

    // Redact code blocks (preserve the fact they existed)
    content = content.replace(/```[\s\S]*?```/g, '[CODE BLOCK REDACTED]');

    // Redact markdown tables
    content = content.replace(/^\|.*\|$/gm, '[TABLE REDACTED]');
    content = content.replace(/(\[TABLE REDACTED\]\n?)+/g, '[TABLE REDACTED]\n');

    // [FIX D1] Only strip actual HTML tags (known tag names), not arbitrary angle brackets
    // This preserves user discussions about <script>, <div> etc. in coding prompts
    const htmlTagPattern = /<\/?\s*(div|span|p|br|hr|img|a|ul|ol|li|table|tr|td|th|thead|tbody|h[1-6]|pre|code|blockquote|strong|em|b|i|u|section|article|nav|header|footer|form|input|button|select|option|textarea|label|style|link|meta|head|body|html)(\s[^>]*)?\/?>/gi;
    content = content.replace(htmlTagPattern, '');

    // Collapse excessive whitespace
    content = content.replace(/\n{3,}/g, '\n\n');
    content = content.replace(/ {3,}/g, '  ');

    // Truncate very long AI responses to conserve tokens
    if (content.length > 1500) {
        content = content.substring(0, 1500) + "\n...[TRUNCATED]";
    }

    return content;
}

// ============================================================
// MAIN SYNC FUNCTION
// ============================================================
async function syncChat(payload) {
    const { chat_id, chat_title, messages, raw_text } = payload;

    // 1. Get API Key and previous session state
    const storageData = await chrome.storage.local.get(['GEMINI_API_KEY', `session_${chat_id}`]);
    const apiKey = storageData.GEMINI_API_KEY;

    if (!apiKey) {
        throw new Error("Gemini API Key is not set. Please set it in the Dashboard Settings.");
    }

    // Basic API key format validation
    if (apiKey.length < 10) {
        throw new Error("Invalid Gemini API Key. Please check your key in Dashboard Settings.");
    }

    const previousSession = storageData[`session_${chat_id}`] || null;
    const previous_raw_msgs = previousSession?.raw?.messages || [];
    const previous_head = previousSession?.payload || null;

    // 2. Delta Engine Configuration
    let is_incremental = false;
    let delta_msgs = [];
    let old_summary = "";
    let msgs_to_summarize = [];

    if (messages && messages.length > 0) {
        if (previous_raw_msgs && previous_head && messages.length > previous_raw_msgs.length) {
            let is_append_only = true;
            for (let i = 0; i < previous_raw_msgs.length; i++) {
                if (previous_raw_msgs[i].content !== messages[i].content) {
                    is_append_only = false;
                    break;
                }
            }

            if (is_append_only) {
                const start_idx = previous_raw_msgs.length;
                if (start_idx < messages.length) {
                    delta_msgs = messages.slice(start_idx);
                    old_summary = previous_head;
                    if (old_summary && Object.keys(old_summary).length > 0) {
                        is_incremental = true;
                    }
                }
            }
        }
        msgs_to_summarize = is_incremental ? delta_msgs : messages;
    } else {
        if (previous_head && Object.keys(previous_head).length > 0) {
            old_summary = previous_head;
            is_incremental = true;
        }
    }

    // 3. Role-Weighted & Universal Scrubbing
    let middle_text = "";

    if (messages && messages.length > 0) {
        let scrubbed_msgs = [];
        for (let m of msgs_to_summarize) {
            let content = scrubContent(m.content, m.role !== 'user');
            let role_label = m.role === 'user' ? "[USER]" : "[AI]";
            scrubbed_msgs.push(`${role_label}: ${content.trim()}`);
        }
        middle_text = scrubbed_msgs.join("\n\n");
    } else if (raw_text) {
        let content = raw_text;
        content = content.replace(/```[\s\S]*?```/g, '[CODE BLOCK REDACTED]');
        content = content.replace(/\n{3,}/g, '\n\n');
        content = content.replace(/ {3,}/g, '  ');
        if (content.length > 100000) {
            content = content.substring(content.length - 100000);
        }
        middle_text = content;
    } else {
        return { message: "No content to sync" };
    }

    // 4. Construct Prompt
    const schemaInstructions = `
Output strictly valid JSON matching this exact 7-Pillar structure where values are ARRAYS of strings:
{
  "north_star": ["Strategic Objective", "Overarching Goal"],
  "behavioral_matrix": ["Exact Implicit Persona definition", "Tone guidelines"],
  "environment_constraints": ["Fixed parameters", "User constraints", "Tech stack"],
  "knowledge_graph": ["Core Entities", "Formulas", "Algorithms", "Specialized Terminology"],
  "decision_ledger": ["Agreed decisions", "Finalized concepts", "Timeline milestones"],
  "the_graveyard": ["Discarded directions", "Failed concepts", "What to avoid"],
  "the_handoff": ["Last active topic", "Current pending challenge"]
}

CRITICAL RULE: Explicitly use the \`knowledge_graph\` section to capture high-density data, raw formulas, specialized terminology, and algorithmic details without summarizing them.`;

    let prompt = "";
    if (is_incremental) {
        prompt = `You are an Advanced Universal Semantic Compiler maintaining a live session document. 
You are provided with an EXISTING BLUEPRINT (in JSON format) and a DELTA of new conversation messages or raw unstructured text. 
Integrate the new developments from the DELTA into the EXISTING BLUEPRINT. 
Do not drop previously established decisions unless explicitly overridden. 
Before outputting JSON, you MUST open a <thinking> block to reason step-by-step about the domain, the Implicit Persona/Tone of the AI, and the exact constraints and terminology. 
DENSE PRESERVATION DIRECTIVE: Do not generalize technical concepts. Preserve exact algorithms, jargon, formulas, and constraints.
${schemaInstructions}

EXISTING BLUEPRINT:
${JSON.stringify(old_summary, null, 2)}

NEW CONVERSATION DELTA / RAW TEXT:
${middle_text}`;
    } else {
        prompt = `You are an Advanced Universal Semantic Compiler. Analyze the following conversation or raw unstructured text segment. 
Extract the fundamental truths of this session through a domain-agnostic lens. 
Before outputting JSON, you MUST open a <thinking> block to reason step-by-step about the domain, the Implicit Persona/Tone of the AI, and the exact constraints and terminology. 
DENSE PRESERVATION DIRECTIVE: Do not generalize technical concepts. Preserve exact algorithms, jargon, formulas, and constraints.
${schemaInstructions}

CONVERSATION SEGMENT / RAW TEXT:
${middle_text}`;
    }

    // 5. Call Gemini API (with timeout + retry)
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

    const apiResponse = await fetchWithRetry(geminiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
                temperature: 0.2,
                responseMimeType: "application/json"
            }
        })
    });

    if (!apiResponse.ok) {
        const errText = await apiResponse.text();
        // Classify API errors for better user messaging
        if (apiResponse.status === 400) {
            throw new Error("Invalid API Key or malformed request. Please verify your Gemini key in Settings.");
        } else if (apiResponse.status === 403) {
            throw new Error("API Key forbidden. Your key may be revoked or restricted. Check Google AI Studio.");
        } else if (apiResponse.status === 429) {
            throw new Error("Rate limit exceeded. You've made too many requests. Please wait a minute and try again.");
        }
        throw new Error(`Gemini API Error: ${apiResponse.status} - ${errText.substring(0, 200)}`);
    }

    const apiData = await apiResponse.json();
    const responseText = apiData.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!responseText) {
        // Check for safety blocks
        const blockReason = apiData.candidates?.[0]?.finishReason;
        if (blockReason === 'SAFETY') {
            throw new Error("Gemini blocked this content due to safety filters. Try syncing a shorter portion of the chat.");
        }
        throw new Error("Empty response from Gemini. The model may be overloaded. Please try again.");
    }

    // 6. Hardened Universal Parser
    let parsedPayload = hardenedJsonParse(responseText);
    parsedPayload.chat_title = chat_title || chat_id;

    // 7. Compile Bootstrap String
    const pillars = [
        { key: 'north_star', title: '1. NORTH STAR (Strategic Objective)' },
        { key: 'behavioral_matrix', title: '2. BEHAVIORAL MATRIX (Implicit Persona & Tone)' },
        { key: 'environment_constraints', title: '3. ENVIRONMENT & CONSTRAINTS (Tech Stack & Rules)' },
        { key: 'knowledge_graph', title: '4. KNOWLEDGE GRAPH (Core Entities, Formulas, Algorithms)' },
        { key: 'decision_ledger', title: '5. DECISION LEDGER (Finalized Concepts & Milestones)' },
        { key: 'the_graveyard', title: '6. THE GRAVEYARD (Rejected & Deprecated Paths)' },
        { key: 'the_handoff', title: '7. THE HANDOFF (Pending Execution)' }
    ];

    const pillarSections = pillars.map(p => {
        const items = (parsedPayload[p.key] || []).map(x => `- ${x}`).join('\n');
        return `### ${p.title}\n${items}`;
    }).join('\n\n');

    const bootstrap_payload = `[SYSTEM INITIALIZATION: DEEP CONTEXT RECOVERY INITIATED]
You are stepping into an ongoing semantic architecture. Do not introduce yourself. Do not summarize this payload.
Assimilate the following 7-Pillar state machine and wait for the user's next command.

${pillarSections}

[STRICT BEHAVIORAL LOCK]
Do not attempt to solve the challenge or summarize this payload. Await the next user prompt.
Reply ONLY with: "🟢 CONTEXT SYNCED. WAITING FOR INSTRUCTIONS."`;

    // 8. Save to chrome.storage.local
    // [FIX D5] Wrap in try/catch to surface storage failures
    const currentTimestamp = Date.now();
    const sessionData = {
        chat_id: chat_id,
        chat_title: parsedPayload.chat_title,
        timestamp: currentTimestamp,
        raw: {
            messages: messages || [],
            raw_text: raw_text || ""
        },
        payload: parsedPayload,
        bootstrap_payload: bootstrap_payload
    };

    try {
        await chrome.storage.local.set({ [`session_${chat_id}`]: sessionData });
    } catch (storageErr) {
        console.error("Ditto: Storage write failed:", storageErr);
        throw new Error("Failed to save session data. Browser storage may be full. Try deleting old sessions from the Dashboard.");
    }

    return {
        commit_hash: String(currentTimestamp),
        payload: parsedPayload,
        bootstrap_payload: bootstrap_payload
    };
}

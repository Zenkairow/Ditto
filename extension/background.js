// background.js

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === "SYNC_CHAT") {
        syncChat(request.payload)
            .then(result => sendResponse({ status: "success", result }))
            .catch(error => sendResponse({ status: "error", error: error.message }));
        return true; // Indicates asynchronous response
    }
});

async function syncChat(payload) {
    const { chat_id, chat_title, messages, raw_text } = payload;
    
    // 1. Get API Key and previous session state
    const storageData = await chrome.storage.local.get(['GEMINI_API_KEY', `session_${chat_id}`]);
    const apiKey = storageData.GEMINI_API_KEY;
    
    if (!apiKey) {
        throw new Error("Gemini API Key is not set. Please set it in the Dashboard Settings.");
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
            let content = m.content;
            let role_label = m.role === 'user' ? "[USER]" : "[AI]";
            
            if (m.role !== 'user') {
                content = content.replace(/```[\s\S]*?```/g, '[CODE BLOCK REDACTED]');
                content = content.replace(/^\|.*\|$/gm, '[TABLE REDACTED]');
                content = content.replace(/(\[TABLE REDACTED\]\n?)+/g, '[TABLE REDACTED]\n');
                content = content.replace(/<[^>]+>/g, '');
                content = content.replace(/\n{3,}/g, '\n\n');
                content = content.replace(/ {3,}/g, '  ');
                if (content.length > 1500) {
                    content = content.substring(0, 1500) + "\n...[TRUNCATED]";
                }
            }
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

    // 5. Call Gemini API
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
    
    const apiResponse = await fetch(geminiUrl, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
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
        throw new Error(`Gemini API Error: ${apiResponse.status} - ${errText}`);
    }
    
    const apiData = await apiResponse.json();
    const responseText = apiData.candidates?.[0]?.content?.parts?.[0]?.text;
    
    if (!responseText) {
        throw new Error("Empty response from Gemini.");
    }
    
    // 6. Universal Parser
    const jsonMatch = responseText.match(/```(?:json)?\n([\s\S]*?)\n```/);
    let jsonString = jsonMatch ? jsonMatch[1] : responseText;
    
    let parsedPayload;
    try {
        parsedPayload = JSON.parse(jsonString);
    } catch (e) {
        const stripped = jsonString.replace(/<thinking>[\s\S]*?<\/thinking>/g, '').trim();
        try {
            parsedPayload = JSON.parse(stripped);
        } catch (e2) {
            console.error("Failed to parse JSON:", stripped);
            throw new Error("Failed to parse the JSON returned by Gemini.");
        }
    }
    
    parsedPayload.chat_title = chat_title || chat_id;
    
    // 7. Compile Bootstrap String
    const north_star = (parsedPayload.north_star || []).map(x => `- ${x}`).join('\n');
    const behavioral_matrix = (parsedPayload.behavioral_matrix || []).map(x => `- ${x}`).join('\n');
    const environment_constraints = (parsedPayload.environment_constraints || []).map(x => `- ${x}`).join('\n');
    const knowledge_graph = (parsedPayload.knowledge_graph || []).map(x => `- ${x}`).join('\n');
    const decision_ledger = (parsedPayload.decision_ledger || []).map(x => `- ${x}`).join('\n');
    const the_graveyard = (parsedPayload.the_graveyard || []).map(x => `- ${x}`).join('\n');
    const the_handoff = (parsedPayload.the_handoff || []).map(x => `- ${x}`).join('\n');
    
    const bootstrap_payload = `[SYSTEM INITIALIZATION: DEEP CONTEXT RECOVERY INITIATED]
You are stepping into an ongoing semantic architecture. Do not introduce yourself. Do not summarize this payload.
Assimilate the following 7-Pillar state machine and wait for the user's next command.

### 1. NORTH STAR (Strategic Objective)
${north_star}

### 2. BEHAVIORAL MATRIX (Implicit Persona & Tone)
${behavioral_matrix}

### 3. ENVIRONMENT & CONSTRAINTS (Tech Stack & Rules)
${environment_constraints}

### 4. KNOWLEDGE GRAPH (Core Entities, Formulas, Algorithms)
${knowledge_graph}

### 5. DECISION LEDGER (Finalized Concepts & Milestones)
${decision_ledger}

### 6. THE GRAVEYARD (Rejected & Deprecated Paths)
${the_graveyard}

### 7. THE HANDOFF (Pending Execution)
${the_handoff}

[STRICT BEHAVIORAL LOCK]
Do not attempt to solve the challenge or summarize this payload. Await the next user prompt.
Reply ONLY with: "🟢 CONTEXT SYNCED. WAITING FOR INSTRUCTIONS."`;

    // 8. Save to chrome.storage.local
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
    
    await chrome.storage.local.set({ [`session_${chat_id}`]: sessionData });
    
    return {
        commit_hash: String(currentTimestamp),
        payload: parsedPayload
    };
}

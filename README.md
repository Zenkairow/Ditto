# Ditto 🧠🕸️
**Duplicate Your AI's Brain — Universal LLM Semantic Sync**

Ditto is an open-source, serverless Chrome extension that solves "Context Collapse." Instead of endlessly copy-pasting massive text files into new LLM windows, Ditto extracts, scrubs, and compresses your chaotic AI chats into a structured, 7-Pillar Semantic Blueprint stored locally in your browser.

## 🚀 The Problem
When you move a massive, highly technical thread from ChatGPT to Claude (or just start a new session), the new model suffers from "Cold Boot Syndrome." If you paste raw transcripts, you waste 80,000+ tokens on formatting, redundant code, and conversational noise, often confusing the new AI.

## 💡 The Solution: The 7-Pillar Architecture
Ditto doesn't just copy text—it uses a local Chain-of-Thought extraction engine (via your Gemini API key) to distill unstructured chat into absolute truth. The engine outputs a dense Markdown payload organized into:
1. **The North Star:** The ultimate strategic objective.
2. **The Behavioral Matrix:** The exact implicit persona the AI was using.
3. **Environment & Constraints:** Tech stack, budgets, and strict rules.
4. **The Knowledge Graph:** Deep context, raw math formulas, and architecture diagrams.
5. **Decision Ledger:** A chronological timeline of agreed milestones.
6. **The Graveyard:** Ideas explicitly discarded (so the new AI doesn't suggest them again).
7. **The Handoff:** The exact immediate next step.

## ✨ Core Features
*   **Universal Ingestion Protocol:** Works on ChatGPT, Claude, DeepSeek, or any raw text on the web.
*   **Role-Weighted Scrubber:** Automatically strips out massive AI code blocks, markdown tables, and redundant HTML *before* processing, reducing token footprints by up to 50%.
*   **Local-First Privacy:** Powered by `chrome.storage.local`. Your chat histories never touch an external database.
*   **Zero-Server Setup:** 100% serverless. Just plug in your Gemini API key and go.

## 📦 Installation (Developer Preview)
1. Download or clone this repository.
2. Open Chrome and navigate to `chrome://extensions`.
3. Toggle on **Developer mode** in the top right.
4. Click **Load unpacked** and select the `extension/` directory.
5. Click the extension icon, enter your Gemini API key in Settings, and hit Sync!

## 🤝 Contributing
Pull requests are welcome! We are currently looking for contributors to help build out Multi-Modal (Vision) extraction.

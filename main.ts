// @ts-ignore
import { moment, requestUrl } from 'obsidian';
import { App, Plugin, PluginSettingTab, Setting, WorkspaceLeaf, Notice, Menu, MenuItem, SuggestModal, TFile, TFolder } from 'obsidian';
import { LocalLLMSettingTab } from './src/settings/SettingsTab';
import { ReviewWidget } from './src/ui/ReviewWidget';
import { LlmClient, Message } from './src/core/LlmClient';
import { VectorStore } from './src/core/VectorStore';
import { ChatView, VIEW_TYPE_CHAT } from './src/ui/ChatView';
import { VaultIndexer } from './src/core/VaultIndexer';

export interface RequestMessage {
    role: "user" | "assistant" | "system";
    content: string;
}

export interface MessageNode {
    id: string;
    role: "user" | "assistant" | "system" | "tool";
    content: string | null;
    parentId: string | null;
    childrenIds: string[];
    tool_calls?: any[];
    tool_call_id?: string;
    createdAt: number;
    attachments?: { file: string; content: string }[];
    images?: string[]; // Base64 images
    model?: string;
    contextSources?: string[]; // List of filenames used for RAG
}

export interface Project {
    id: string;
    name: string;
    folderPath: string;
}

export interface Conversation {
    id: string;
    title: string;
    // New Tree Structure
    messageMap?: { [id: string]: MessageNode };
    currentLeafId?: string;
    projectId?: string;
    timestamp: number;

    // Legacy mapping (optional now)
    messages?: Message[];
}

export interface CustomCommand {
    id: string;
    name: string;
    prompt: string;
    strategy: 'replace' | 'append' | 'prepend' | 'new-note' | 'extract' | 'daily-note';
    hidden?: boolean;
    pinned?: boolean;
}

export interface LocalLLMSettings {
    modelUrl: string;
    apiKey: string;
    // Providers
    openaiApiKey: string;
    anthropicApiKey: string;
    geminiApiKey: string;
    grokApiKey: string;
    openRouterApiKey: string;
    history: Conversation[];
    projects: Project[]; // New: List of projects
    commands: CustomCommand[];
    dailyNoteFolder: string;
    enterToSend: boolean;
    systemPrompt: string;
    braveApiKey: string;
    contextWindow: number;
    maxContextChunks: number;
    showContextMetrics: boolean;
    chatModel: string;
    embeddingModel: string;
    showSourcesInChat: boolean;
    enableSmartMemory: boolean;
    autoUnloadOnChatSwitch: boolean;
    enableBackgroundIndexing: boolean;
    confirmAIChanges: boolean;
    downloadExternalImages: boolean;
}

const DEFAULT_SETTINGS: LocalLLMSettings = {
    modelUrl: 'http://localhost:1234/v1',
    apiKey: 'lm-studio',
    openaiApiKey: '',
    anthropicApiKey: '',
    geminiApiKey: '',
    grokApiKey: '',
    openRouterApiKey: '',
    history: [],
    projects: [], // Default empty
    dailyNoteFolder: '/',
    enterToSend: true,
    systemPrompt: 'You are a helpful AI assistant. You have access to various tools. When tools are available, you should use them to answer user questions accurately. Do not output raw tool codes or JSON formats directly to the user; instead, rely on the system to execute them and then interpret the results.',
    braveApiKey: '',
    contextWindow: 4096,
    maxContextChunks: 3, // Default limit
    showContextMetrics: false,
    chatModel: 'llama3:8b',
    embeddingModel: 'local-model',
    showSourcesInChat: false,
    enableSmartMemory: false,
    autoUnloadOnChatSwitch: false,
    enableBackgroundIndexing: true,
    confirmAIChanges: true,
    downloadExternalImages: false,

    commands: [
        {
            id: 'default-1',
            name: 'Summarize Selection',
            prompt: 'You are a helpful assistant. Summarize the user\'s text concisely.',
            strategy: 'append',
            hidden: false,
            pinned: true
        },
        {
            id: 'default-2',
            name: 'Improve Writing',
            prompt: 'You are an expert editor. Rewrite the text to improve grammar, clarity, and flow. Output ONLY the rewritten text.',
            strategy: 'replace',
            hidden: false,
            pinned: true
        },
        {
            id: 'default-3',
            name: 'Add Section Header',
            prompt: 'You are a technical writer. Create a concise, relevant Markdown header (## Title) and a 1-sentence intro for the following text. Output ONLY the header and intro.',
            strategy: 'prepend',
            hidden: false,
            pinned: false
        },
        {
            id: 'default-4',
            name: 'Draft New Note',
            prompt: 'You are a content creator. Draft a full note based on this concept. The first line MUST be a suggestion for the filename (no extension, just text). Then provide the content.',
            strategy: 'new-note',
            hidden: false,
            pinned: false
        },
        {
            id: 'default-5',
            name: 'Extract to Note',
            prompt: 'You are an archivist. Extract the core information from this text into a standalone note. The first line MUST be the filename. Then provide the content.',
            strategy: 'extract',
            hidden: false,
            pinned: false
        },
        {
            id: 'default-6',
            name: 'Log to Daily',
            prompt: 'You are a personal assistant. Format this selection as a concise log entry or task for my daily journal.',
            strategy: 'daily-note',
            hidden: false,
            pinned: false
        }
    ]
}

// --- Suggest Modal for "Search All" ---
class CommandSuggestModal extends SuggestModal<CustomCommand> {
    plugin: LocalLLMPlugin;
    editor: any;

    constructor(app: App, plugin: LocalLLMPlugin, editor: any) {
        super(app);
        this.plugin = plugin;
        this.editor = editor;
        this.setPlaceholder("Search AI Actions...");
    }

    getSuggestions(query: string): CustomCommand[] {
        const lowerQuery = query.toLowerCase();
        return this.plugin.settings.commands.filter(cmd =>
            !cmd.hidden &&
            cmd.name.toLowerCase().includes(lowerQuery)
        );
    }

    renderSuggestion(cmd: CustomCommand, el: HTMLElement) {
        el.createEl("div", { text: cmd.name });
        el.createEl("small", { text: cmd.strategy, cls: "resolve-cmd-strategy" });
    }

    onChooseSuggestion(cmd: CustomCommand, evt: MouseEvent | KeyboardEvent) {
        this.plugin.runAiEdit(this.editor, cmd);
    }
}

export default class LocalLLMPlugin extends Plugin {
    settings!: LocalLLMSettings;
    llmClient!: LlmClient;
    vectorStore!: VectorStore;
    indexer!: VaultIndexer;
    private debounceTimers: { [path: string]: any } = {};

    async onload() {
        await this.loadSettings();

        // Migration: Defaults
        if (!this.settings.commands || this.settings.commands.length === 0) {
            this.settings.commands = [...DEFAULT_SETTINGS.commands];
            await this.saveSettings();
        } else {
            // Migration: Ensure 'pinned' property exists
            let changed = false;
            this.settings.commands.forEach(cmd => {
                if (cmd.pinned === undefined) {
                    cmd.pinned = (cmd.name === 'Summarize Selection' || cmd.name === 'Improve Writing');
                    changed = true;
                }
            });
            if (this.settings.maxContextChunks === undefined) {
                this.settings.maxContextChunks = DEFAULT_SETTINGS.maxContextChunks;
                changed = true;
            }
            if (changed) await this.saveSettings();
        }

        // Migration: Projects
        if (!this.settings.projects) {
            this.settings.projects = [];
            await this.saveSettings();
        }

        // Initialize Core Components
        this.llmClient = new LlmClient(this.settings);
        this.vectorStore = new VectorStore(this.app.vault.adapter);
        await this.vectorStore.load(); // Load index from disk

        // Initialize Indexer
        this.indexer = new VaultIndexer(this.app.vault, this.app.metadataCache, this.vectorStore, this.llmClient);

        // Register Views
        this.registerView(
            VIEW_TYPE_CHAT,
            (leaf) => new ChatView(leaf, this)
        );

        // Add Ribbon Icon to open chat
        this.addRibbonIcon('message-square', 'Open LazyBrain Chat', () => {
            this.activateView();
        });

        // Command: Index Vault
        this.addCommand({
            id: 'index-vault',
            name: 'Index Vault for AI Search',
            callback: async () => {
                new Notice('Starting Vault Indexing...');
                await this.indexer.indexVault((processed, total) => {
                    if (processed % 10 === 0) new Notice(`Indexing: ${processed}/${total}`);
                });
                new Notice('Vault Indexing Complete!');
            }
        });

        // Command: Refresh Context & Models
        this.addCommand({
            id: 'refresh-context-models',
            name: 'Refresh Context & Models',
            callback: async () => {
                new Notice("Refreshing LazyBrain Context...");
                try {
                    await this.indexer.syncUpdates();
                    await this.llmClient.listModels(); // Force re-fetch
                    new Notice("Context Refreshed: Vault & Models synced.");
                } catch (e: any) {
                    new Notice("Refresh Failed: " + e.message);
                }
            }
        });

        // --- Auto-Indexing (Smart Watcher) ---
        // 1. Modify (Existing logic - kept for debounce edits)
        this.registerEvent(
            this.app.vault.on('modify', (file) => {
                if (!(file instanceof TFile) || file.extension !== 'md') return;

                // Debounce: Wait 2s after last edit to avoid flooding
                if (this.debounceTimers[file.path]) clearTimeout(this.debounceTimers[file.path]);

                this.debounceTimers[file.path] = setTimeout(async () => {
                    await this.indexer.indexFile(file);
                    await this.vectorStore.save();
                    delete this.debounceTimers[file.path];
                }, 2000);
            })
        );

        // 2. Create (Instant)
        this.registerEvent(
            this.app.vault.on('create', async (file) => {
                if (!(file instanceof TFile) || file.extension !== 'md') return;
                // console.log(`Auto-Index (Create): ${file.path}`);
                await this.indexer.indexFile(file);
                await this.vectorStore.save();
            })
        );

        // 3. Delete (Instant)
        this.registerEvent(
            this.app.vault.on('delete', async (file) => {
                if (!(file instanceof TFile) || file.extension !== 'md') return;
                // console.log(`Auto-Index (Delete): ${file.path}`);
                await this.indexer.deleteFile(file.path);
            })
        );

        // 4. Rename (Delete Old + Index New)
        this.registerEvent(
            this.app.vault.on('rename', async (file, oldPath) => {
                if (!(file instanceof TFile) || file.extension !== 'md') return;
                // console.log(`Auto-Index (Rename): ${oldPath} -> ${file.path}`);
                await this.indexer.deleteFile(oldPath);
                await this.indexer.indexFile(file);
                await this.vectorStore.save();
            })
        );

        // --- Startup Smart Sync ---
        // Only run if index exists
        this.app.workspace.onLayoutReady(async () => {
            // Run quietly in background
            await this.indexer.syncUpdates();
        });

        // ... (rest of methods) ...

        // --- Dynamic Command Registration (Command Palette) ---
        this.settings.commands.forEach(cmd => {
            if (!cmd.hidden) {
                this.addCommand({
                    id: `llm-custom-${cmd.id}`,
                    name: `AI Action: ${cmd.name}`,
                    editorCallback: (editor) => this.runAiEdit(editor, cmd)
                });
            }
        });

        // --- Context Menu Registration ---
        this.registerEvent(
            this.app.workspace.on("editor-menu", (menu, editor, view) => {
                const selection = editor.getSelection();
                if (!selection) return;

                // 1. PINNED COMMANDS (Top Level)
                this.settings.commands.forEach(cmd => {
                    if (cmd.pinned && !cmd.hidden) {
                        menu.addItem((item: any) => {
                            item
                                .setTitle(cmd.name)
                                .setIcon("pin")
                                .onClick(() => this.runAiEdit(editor, cmd));
                        });
                    }
                });

                menu.addSeparator();

                // 2. SEARCH ALL (Fuzzy Finder)
                menu.addItem((item: any) => {
                    item
                        .setTitle("Search All AI Actions...")
                        .setIcon("search")
                        .onClick(() => {
                            new CommandSuggestModal(this.app, this, editor).open();
                        });
                });

                // Removed legacy submenu as requested
            })
        );

        // Add Settings Tab
        this.addSettingTab(new LocalLLMSettingTab(this.app, this));
    }

    onunload() {
    }

    async runAiEdit(editor: any, command: CustomCommand) {
        const selection = editor.getSelection();
        if (!selection && command.strategy !== 'new-note' && command.strategy !== 'daily-note') {
            new Notice("No text selected.");
            return;
        }

        new Notice(`Running: ${command.name}...`);

        // Capture Original State for Undo
        const originalCursor = editor.getCursor();
        const originalSelection = selection;
        const state = {
            selection: originalSelection,
            cursor: originalCursor,
            startPos: editor.getCursor('from')
        };

        // --- IMAGE DETECTION ---
        const images: string[] = [];
        if (selection) {
            // Regex for ![[image.png]] and ![alt](image.png)
            const wikiRegex = /!\[\[(.*\.(?:png|jpg|jpeg|webp|gif))\]\]/gi;
            const mdRegex = /!\[.*?\]\((.*\.(?:png|jpg|jpeg|webp|gif|svg|^http))(\s+.*)?\)/gi; // Expanded logic

            const wikiMatches = Array.from(selection.matchAll(wikiRegex));
            const mdMatches = Array.from(selection.matchAll(mdRegex));

            if (wikiMatches.length > 0 || mdMatches.length > 0) {
                new Notice(`Found ${wikiMatches.length + mdMatches.length} image(s). Analyzing...`);

                const activeFile = this.app.workspace.getActiveFile();
                const sourcePath = activeFile ? activeFile.path : "";

                // 1. Internal Wiki Links
                for (const m of wikiMatches) {
                    const linkText = (m as any)[1];
                    const file = this.app.metadataCache.getFirstLinkpathDest(linkText, sourcePath);
                    if (file instanceof TFile) {
                        try {
                            const arrayBuffer = await this.app.vault.readBinary(file);
                            const base64 = this.arrayBufferToBase64(arrayBuffer);
                            const mime = this.getMimeType(file.extension);
                            images.push(`data:${mime};base64,${base64}`);
                        } catch (e) {
                            console.error(`Failed to read internal image ${linkText}`, e);
                        }
                    }
                }

                // 2. Markdown Links (External or Internal Path)
                for (const m of mdMatches) {
                    const linkUrl = (m as any)[1];
                    if (linkUrl.startsWith('http')) {
                        // Check Setting First
                        if (!this.settings.downloadExternalImages) {
                            // console.log("Skipping external image download (setting disabled):", linkUrl);
                            continue;
                        }

                        // External URL
                        try {
                            // Add headers to avoid 403 from some CDNs
                            const resp = await requestUrl({
                                url: linkUrl,
                                headers: {
                                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                                    'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
                                }
                            });
                            const arrayBuffer = resp.arrayBuffer;
                            const base64 = this.arrayBufferToBase64(arrayBuffer);
                            // Minimal mime guessing from url or response headers if possible, defaulting to jpeg
                            let mime = 'image/jpeg';
                            if (linkUrl.endsWith('.png')) mime = 'image/png';
                            if (linkUrl.endsWith('.webp')) mime = 'image/webp';
                            if (linkUrl.endsWith('.gif')) mime = 'image/gif';

                            images.push(`data:${mime};base64,${base64}`);
                        } catch (e) {
                            console.error(`Failed to fetch external image ${linkUrl}`, e);
                            new Notice(`Failed to download image: ${linkUrl}`);
                        }
                    } else {
                        // Internal Path via Markdown Link
                        const file = this.app.metadataCache.getFirstLinkpathDest(linkUrl, sourcePath);
                        if (file instanceof TFile) {
                            try {
                                const arrayBuffer = await this.app.vault.readBinary(file);
                                const base64 = this.arrayBufferToBase64(arrayBuffer);
                                const mime = this.getMimeType(file.extension);
                                images.push(`data:${mime};base64,${base64}`);
                            } catch (e) {
                                console.error(`Failed to read local image ${linkUrl}`, e);
                            }
                        }
                    }
                }
            }
        }

        try {
            const abortController = new AbortController();
            const stream = this.llmClient.streamChatCompletion({
                messages: [
                    { role: "system", content: command.prompt },
                    { role: "user", content: selection || "" }
                ],
                images: images.length > 0 ? images : undefined,
                signal: abortController.signal
            });

            // 1. ALWAYS STREAM DIRECTLY to Editor
            const generatedText = await this.handleStreamingEdit(editor, selection, stream, command.strategy);

            // 2. If Confirmation Enabled -> Show Widget
            if (this.settings.confirmAIChanges) {
                new ReviewWidget(
                    this.app,
                    () => {
                        // Accept
                        new Notice("Changes accepted.");
                    },
                    () => {
                        // Undo
                        this.undoChange(editor, state, generatedText, command.strategy);
                        new Notice("Changes reverted.");
                    }
                ).updateStatus("Done. Review changes?");
            }

        } catch (err) {
            new Notice(`Error: ${err}`);
            console.error(err);
        }
    }

    arrayBufferToBase64(buffer: ArrayBuffer): string {
        let binary = '';
        const bytes = new Uint8Array(buffer);
        const len = bytes.byteLength;
        for (let i = 0; i < len; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary);
    }

    getMimeType(extension: string): string {
        switch (extension.toLowerCase()) {
            case 'png': return 'image/png';
            case 'jpg':
            case 'jpeg': return 'image/jpeg';
            case 'webp': return 'image/webp';
            case 'gif': return 'image/gif';
            default: return 'application/octet-stream';
        }
    }

    async undoChange(editor: any, originalState: any, generatedText: string, strategy: string) {
        // Simple Undo Logic for 'replace' strategy (most common)
        if (strategy === 'replace') {
            const lines = generatedText.split('\n');
            const lineCount = lines.length - 1;
            const lastLineLen = lines[lines.length - 1].length;

            const startLine = originalState.startPos.line;
            const startCh = originalState.startPos.ch;

            let endLine = startLine + lineCount;
            let endCh = (lineCount === 0 ? startCh : 0) + lastLineLen;

            editor.replaceRange(originalState.selection,
                { line: startLine, ch: startCh },
                { line: endLine, ch: endCh }
            );
        }
        else {
            editor.undo();
        }
    }

    async handleStreamingEdit(editor: any, originalSelection: string, stream: AsyncGenerator<string>, strategy: string): Promise<string> {
        const isEditorStrategy = ['replace', 'append', 'prepend'].includes(strategy);
        let fullGeneratedContent = "";

        if (isEditorStrategy) {
            if (strategy === 'append') editor.replaceSelection(`${originalSelection}\n\n`);
            if (strategy === 'prepend') editor.replaceSelection(`\n\n${originalSelection}`);
            if (strategy === 'replace') editor.replaceSelection("");
        }

        for await (const chunk of stream) {
            fullGeneratedContent += chunk;
            if (isEditorStrategy && (strategy === 'replace' || strategy === 'append' || strategy === 'prepend')) {
                editor.replaceSelection(chunk);
            }
        }

        if (!isEditorStrategy || (strategy !== 'replace' && strategy !== 'append' && strategy !== 'prepend')) {
            if (!isEditorStrategy) {
                await this.handleOutputNetwork(editor, originalSelection, fullGeneratedContent, strategy);
            }
        }

        return fullGeneratedContent;
    }

    async handleOutputNetwork(editor: any, originalSelection: string, response: string, strategy: string) {
        switch (strategy) {
            case 'replace':
                editor.replaceSelection(response);
                break;
            case 'append':
                editor.replaceSelection(`${originalSelection}\n\n${response}`);
                break;
            case 'prepend':
                editor.replaceSelection(`${response}\n\n${originalSelection}`);
                break;
            case 'new-note':
            case 'extract':
                // "First line is filename" logic
                const lines = response.split('\n');
                let title = lines[0].replace(/[\\/:*?"<>|]/g, "").trim().substring(0, 50);
                let content = lines.slice(1).join('\n').trim();

                // Fallback if AI output is weird
                if (!title || lines.length < 2) {
                    title = `AI Note ${Date.now()}`;
                    content = response;
                }

                try {
                    // Try to avoid overwriting?
                    let filename = `${title}.md`;
                    let fileExists = this.app.vault.getAbstractFileByPath(filename);
                    if (fileExists) {
                        filename = `${title} ${Date.now()}.md`;
                    }

                    await this.app.vault.create(filename, content);

                    if (strategy === 'extract') {
                        editor.replaceSelection(`[[${filename.replace('.md', '')}]]`);
                    }
                    new Notice(`Created: ${filename}`);
                } catch (e) {
                    new Notice(`Could not create file: ${e}`);
                }
                break;
            case 'daily-note':
                // @ts-ignore
                const date = window.moment().format('YYYY-MM-DD');

                // Clean folder path: remove trailing slashes, default to empty
                let folderPath = this.settings.dailyNoteFolder ? this.settings.dailyNoteFolder.trim() : "";
                if (folderPath && !folderPath.endsWith('/')) folderPath += '/';
                if (folderPath === '/') folderPath = ""; // Root

                const dailyPath = `${folderPath}${date}.md`;

                console.log(`LLM: Looking for daily note at: ${dailyPath}`);

                let dailyFile = this.app.vault.getAbstractFileByPath(dailyPath);

                // If not found, try to create it
                if (!dailyFile) {
                    try {
                        // Ensure folder exists first
                        if (folderPath) {
                            const folder = this.app.vault.getAbstractFileByPath(folderPath.slice(0, -1)); // Remove trailing slash for check
                            if (!folder) {
                                await this.app.vault.createFolder(folderPath.slice(0, -1));
                                new Notice(`Created folder: ${folderPath}`);
                            }
                        }

                        dailyFile = await this.app.vault.create(dailyPath, "");
                        new Notice(`Created Daily Note: ${dailyPath}`);
                    } catch (e) {
                        new Notice(`Error creating Daily Note at ${dailyPath}: ${e}`);
                        return;
                    }
                }

                if (dailyFile instanceof TFile) {
                    // @ts-ignore
                    await this.app.vault.append(dailyFile, `\n\n## AI Log (${window.moment().format('HH:mm')})\n${response}`);
                }
                break;
        }
    }

    async activateView() {
        const { workspace } = this.app;
        let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(VIEW_TYPE_CHAT)[0];

        if (!leaf) {
            leaf = workspace.getLeaf('tab');
            await leaf.setViewState({ type: VIEW_TYPE_CHAT, active: true });
        }

        if (leaf) workspace.revealLeaf(leaf);
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
        this.triggerSettingsUpdate();
    }

    private settingsUpdateCallbacks: (() => void)[] = [];
    public onSettingsUpdate(callback: () => void) {
        this.settingsUpdateCallbacks.push(callback);
    }
    public triggerSettingsUpdate() {
        this.settingsUpdateCallbacks.forEach(cb => cb());
    }
}

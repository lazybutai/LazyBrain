import { App, PluginSettingTab, Setting, Notice, TextAreaComponent } from 'obsidian';
import LocalLLMPlugin from '../../main';
import { CustomCommand } from '../../main';
import { ConfirmationModal } from "../ui/modals/ConfirmationModal";

export class LocalLLMSettingTab extends PluginSettingTab {
    plugin: LocalLLMPlugin;
    activeTab: 'general' | 'local' | 'providers' | 'commands' = 'general';

    constructor(app: App, plugin: LocalLLMPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        containerEl.createEl('h2', { text: 'LazyBrain Settings' });

        // --- Tab Navigation ---
        const navContainer = containerEl.createDiv();
        navContainer.style.display = 'flex';
        navContainer.style.gap = '10px';
        navContainer.style.marginBottom = '20px';
        navContainer.style.borderBottom = '1px solid var(--background-modifier-border)';
        navContainer.style.paddingBottom = '10px';

        const generalBtn = navContainer.createEl('button', { text: 'General' });
        const localBtn = navContainer.createEl('button', { text: 'Local LLM' });
        const providersBtn = navContainer.createEl('button', { text: 'Providers' });
        const commandsBtn = navContainer.createEl('button', { text: 'Custom Actions' });

        if (this.activeTab === 'general') generalBtn.addClass('mod-cta');
        else if (this.activeTab === 'local') localBtn.addClass('mod-cta');
        else if (this.activeTab === 'providers') providersBtn.addClass('mod-cta');
        else commandsBtn.addClass('mod-cta');

        generalBtn.onclick = () => {
            this.activeTab = 'general';
            this.display();
        };

        localBtn.onclick = () => {
            this.activeTab = 'local';
            this.display();
        };

        providersBtn.onclick = () => {
            this.activeTab = 'providers';
            this.display();
        };

        commandsBtn.onclick = () => {
            this.activeTab = 'commands';
            this.display();
        };

        // --- Render Active Tab ---
        if (this.activeTab === 'general') {
            this.displayGeneral(containerEl);
        } else if (this.activeTab === 'local') {
            this.displayLocalLLM(containerEl);
        } else if (this.activeTab === 'providers') {
            this.displayProviders(containerEl);
        } else {
            this.displayCommands(containerEl);
        }
    }

    displayLocalLLM(containerEl: HTMLElement): void {
        containerEl.createEl('h3', { text: 'Local LLM Settings' });
        containerEl.createEl('p', { text: 'Configure your local server connection. Use a preset or enter a custom URL.' });

        // --- Active Configuration ---
        containerEl.createEl('h4', { text: 'Active Connection' });

        new Setting(containerEl)
            .setName('Model URL')
            .setDesc('Base URL for the Local LLM (e.g. http://localhost:11434/v1)')
            .addText(text => text
                .setPlaceholder('http://localhost:1234/v1')
                .setValue(this.plugin.settings.modelUrl)
                .onChange(async (value) => {
                    this.plugin.settings.modelUrl = value;
                    this.plugin.llmClient.updateConfig(this.plugin.settings);
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Check Connection')
            .setDesc('Test connectivity to the URL above.')
            .addButton(btn => btn
                .setButtonText('Check & Refresh Models')
                .onClick(async () => {
                    await this.checkConnection(btn);
                }));

        // --- Quick Setup (Presets) ---
        containerEl.createEl('hr');
        containerEl.createEl('h3', { text: 'Quick Setup / Presets' });
        const presetContainer = containerEl.createDiv({ cls: 'preset-container' });
        presetContainer.style.display = 'grid';
        presetContainer.style.gridTemplateColumns = '1fr 1fr';
        presetContainer.style.gap = '15px';

        // Ollama Preset
        const ollamaDiv = presetContainer.createDiv({ cls: 'preset-box' });
        ollamaDiv.style.border = '1px solid var(--background-modifier-border)';
        ollamaDiv.style.padding = '15px';
        ollamaDiv.style.borderRadius = '8px';
        const ollamaHeader = ollamaDiv.createEl('h4', { text: 'Ollama' });
        ollamaHeader.style.marginTop = '0';
        const ollamaDesc = ollamaDiv.createEl('p', { text: 'Standard Port: 11434' });
        ollamaDesc.style.fontSize = '0.8em';
        ollamaDesc.style.color = 'var(--text-muted)';
        new Setting(ollamaDiv)
            .addButton(btn => btn
                .setButtonText('Use Ollama')
                .setCta()
                .onClick(async () => {
                    this.plugin.settings.modelUrl = 'http://localhost:11434/v1';
                    // this.plugin.settings.enableSmartMemory = true; // Disabled by default request
                    await this.plugin.saveSettings();
                    this.plugin.llmClient.updateConfig(this.plugin.settings);
                    this.display(); // Refresh UI
                    new Notice('Applied Ollama Preset (Port 11434 + Smart Memory)');
                }));

        // LM Studio Preset
        const lmStudioDiv = presetContainer.createDiv({ cls: 'preset-box' });
        lmStudioDiv.style.border = '1px solid var(--background-modifier-border)';
        lmStudioDiv.style.padding = '15px';
        lmStudioDiv.style.borderRadius = '8px';
        const lmHeader = lmStudioDiv.createEl('h4', { text: 'LM Studio' });
        lmHeader.style.marginTop = '0';
        const lmDesc = lmStudioDiv.createEl('p', { text: 'Standard Port: 1234' });
        lmDesc.style.fontSize = '0.8em';
        lmDesc.style.color = 'var(--text-muted)';

        new Setting(lmStudioDiv)
            .addButton(btn => btn
                .setButtonText('Use LM Studio')
                .setCta()
                .onClick(async () => {
                    this.plugin.settings.modelUrl = 'http://localhost:1234/v1';
                    this.plugin.settings.enableSmartMemory = false; // LM Studio manages memory
                    await this.plugin.saveSettings();
                    this.plugin.llmClient.updateConfig(this.plugin.settings);
                    this.display(); // Refresh UI
                    new Notice('Applied LM Studio Preset (Port 1234)');
                }));


        // --- Advanced ---
        containerEl.createEl('br');
        containerEl.createEl('h3', { text: 'Advanced Settings' });

        new Setting(containerEl)
            .setName('Default Chat Model')
            .setDesc('The model used for chat execution. Note: This model will also be used as the default for Custom Actions.')
            .addDropdown(async (dropdown) => {
                let options: Record<string, string> = { "": "Select a model..." };
                if (this.plugin.settings.chatModel) {
                    options[this.plugin.settings.chatModel] = this.plugin.settings.chatModel;
                }
                try {
                    const models = await this.plugin.llmClient.listModels();
                    const localModels = models.filter(m => m.providerId === 'local');
                    localModels.forEach(m => {
                        // Fix: Correctly handle model IDs with colons
                        const name = m.id.substring(m.id.indexOf(':') + 1);
                        options[name] = name;
                    });
                } catch (e) { }

                dropdown
                    .addOptions(options)
                    .setValue(this.plugin.settings.chatModel)
                    .onChange(async (value) => {
                        this.plugin.settings.chatModel = value;
                        await this.plugin.saveSettings();
                        this.plugin.llmClient.updateConfig(this.plugin.settings);
                    });
            });

        new Setting(containerEl)
            .setName('Embedding Model')
            .setDesc('The model used for RAG embeddings. Must support embeddings.')
            .addDropdown(async (dropdown) => {
                let options: Record<string, string> = { "": "Select a model..." };
                if (this.plugin.settings.embeddingModel) {
                    options[this.plugin.settings.embeddingModel] = this.plugin.settings.embeddingModel;
                }
                try {
                    const models = await this.plugin.llmClient.listModels();
                    const localModels = models.filter(m => m.providerId === 'local');
                    localModels.forEach(m => {
                        const name = m.id.substring(m.id.indexOf(':') + 1);
                        options[name] = name;
                    });
                } catch (e) { }

                dropdown
                    .addOptions(options)
                    .setValue(this.plugin.settings.embeddingModel)
                    .onChange(async (value) => {
                        this.plugin.settings.embeddingModel = value;
                        await this.plugin.saveSettings();
                        this.plugin.llmClient.updateConfig(this.plugin.settings);
                    });
            });

        new Setting(containerEl)
            .setName('Local API Key')
            .setDesc('API Key for Local Server (optional, e.g. "lm-studio")')
            .addText(text => text
                .setPlaceholder('lm-studio')
                .setValue(this.plugin.settings.apiKey)
                .onChange(async (value) => {
                    this.plugin.settings.apiKey = value;
                    this.plugin.llmClient.updateConfig(this.plugin.settings);
                    await this.plugin.saveSettings();
                }));




        // SMART MEMORY & VRAM
        containerEl.createEl('h4', { text: 'Memory Management' });

        new Setting(containerEl)
            .setName('Auto-Unload on Chat Switch')
            .setDesc('When switching chat models, immediately unload the previous model to free VRAM.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.autoUnloadOnChatSwitch)
                .onChange(async (value) => {
                    this.plugin.settings.autoUnloadOnChatSwitch = value;
                    await this.plugin.saveSettings();
                    this.plugin.llmClient.updateConfig(this.plugin.settings);
                }));

        new Setting(containerEl)
            .setName('Smart VRAM Management (Low VRAM Mode)')
            .setDesc('(Advanced) Aggressively unload models to ensure only ONE major model is loaded at a time. Enable this ONLY for Ollama if you have low VRAM (< 8GB).')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.enableSmartMemory)
                .onChange(async (value) => {
                    this.plugin.settings.enableSmartMemory = value;
                    await this.plugin.saveSettings();
                    this.plugin.llmClient.updateConfig(this.plugin.settings);
                }));
    }

    displayProviders(containerEl: HTMLElement): void {
        containerEl.createEl('h3', { text: 'LLM Providers' });
        containerEl.createEl('p', { text: 'Enter API keys for the services you want to use. You can leave others empty.' });

        new Setting(containerEl)
            .setName('OpenAI API Key')
            .setDesc('For GPT-4o, o1-preview, etc.')
            .addText(text => text
                .setPlaceholder('sk-...')
                .setValue(this.plugin.settings.openaiApiKey)
                .onChange(async (value) => {
                    this.plugin.settings.openaiApiKey = value;
                    this.plugin.llmClient.updateConfig(this.plugin.settings);
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Anthropic API Key')
            .setDesc('For Claude 3.5 Sonnet, Opus, etc.')
            .addText(text => text
                .setPlaceholder('sk-ant-...')
                .setValue(this.plugin.settings.anthropicApiKey)
                .onChange(async (value) => {
                    this.plugin.settings.anthropicApiKey = value;
                    this.plugin.llmClient.updateConfig(this.plugin.settings);
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Google Gemini API Key')
            .setDesc('For Gemini 1.5 Pro, Flash, etc.')
            .addText(text => text
                .setPlaceholder('AIza...')
                .setValue(this.plugin.settings.geminiApiKey)
                .onChange(async (value) => {
                    this.plugin.settings.geminiApiKey = value;
                    this.plugin.llmClient.updateConfig(this.plugin.settings);
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Grok (xAI) API Key')
            .setDesc('For Grok Beta')
            .addText(text => text
                .setPlaceholder('key...')
                .setValue(this.plugin.settings.grokApiKey)
                .onChange(async (value) => {
                    this.plugin.settings.grokApiKey = value;
                    this.plugin.llmClient.updateConfig(this.plugin.settings);
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('OpenRouter API Key')
            .setDesc('For various models via OpenRouter')
            .addText(text => text
                .setPlaceholder('sk-or-...')
                .setValue(this.plugin.settings.openRouterApiKey)
                .onChange(async (value) => {
                    this.plugin.settings.openRouterApiKey = value;
                    this.plugin.llmClient.updateConfig(this.plugin.settings);
                    await this.plugin.saveSettings();
                }));
    }

    displayGeneral(containerEl: HTMLElement): void {
        containerEl.createEl('h3', { text: 'General Settings' });

        new Setting(containerEl)
            .setName('Show Context Usage')
            .setDesc('Display the token usage meter in the chat input area.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.showContextMetrics)
                .onChange(async (value) => {
                    this.plugin.settings.showContextMetrics = value;
                    await this.plugin.saveSettings();
                    this.display(); // Refresh to show/hide Context Window setting
                }));

        if (this.plugin.settings.showContextMetrics) {
            new Setting(containerEl)
                .setName('Context Window Size')
                .setDesc('Max tokens (e.g. 4096, 8192). This setting is for visual token usage tracking only and does not configure the model.')
                .addText(text => text
                    .setPlaceholder('4096')
                    .setValue(String(this.plugin.settings.contextWindow || 4096))
                    .onChange(async (value) => {
                        const num = parseInt(value);
                        if (!isNaN(num) && num > 0) {
                            this.plugin.settings.contextWindow = num;
                            await this.plugin.saveSettings();
                        }
                    }));
        }

        new Setting(containerEl)
            .setName('RAG Context Limit')
            .setDesc('Max number of text chunks to retrieve for context. Higher values = more info but slower/more tokens.')
            .addSlider(slider => slider
                .setLimits(1, 20, 1)
                .setValue(this.plugin.settings.maxContextChunks || 3)
                .setDynamicTooltip()
                .onChange(async (value) => {
                    this.plugin.settings.maxContextChunks = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Enable Background Indexing')
            .setDesc('Automatically index notes in the background ("Smart Sync") when files are modified. Disable to save resources; you can still index manually.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.enableBackgroundIndexing)
                .onChange(async (value) => {
                    this.plugin.settings.enableBackgroundIndexing = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Default System Prompt')
            .setDesc('The default system instruction used for new chats.')
            .addTextArea(text => text
                .setPlaceholder('You are a helpful assistant...')
                .setValue(this.plugin.settings.systemPrompt)
                .onChange(async (value) => {
                    this.plugin.settings.systemPrompt = value;
                    await this.plugin.saveSettings();
                }));

        // --- Tools & MCP Settings ---
        containerEl.createEl('h3', { text: 'Tools & Integrations' });

        new Setting(containerEl)
            .setName('Brave Search API Key')
            .setDesc('Required for Web Research. Get one at https://api.search.brave.com/app/keys')
            .addText(text => text
                .setPlaceholder('BSA-...')
                .setValue(this.plugin.settings.braveApiKey)
                .onChange(async (value) => {
                    this.plugin.settings.braveApiKey = value;
                    await this.plugin.saveSettings();
                }));

        // --- Chat Interface Settings ---
        containerEl.createEl('h3', { text: 'Chat Interface' });
        new Setting(containerEl)
            .setName('Enter to Send')
            .setDesc('If enabled, pressing Enter sends the message (Shift+Enter for new line). If disabled, Ctrl+Enter sends (Enter for new line).')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.enterToSend)
                .onChange(async (val) => {
                    this.plugin.settings.enterToSend = val;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Show RAG Sources')
            .setDesc('Display the list of used vault notes (context) above the AI response. (Experimental: May require toggling off/on to appear).')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.showSourcesInChat)
                .onChange(async (value) => {
                    this.plugin.settings.showSourcesInChat = value;
                    await this.plugin.saveSettings();
                }));

        // --- Daily Note Settings ---
        containerEl.createEl('h3', { text: 'Daily Notes' });
        new Setting(containerEl)
            .setName('Daily Note Folder')
            .setDesc('Folder where daily notes are stored (e.g. "Journal" or "Daily Notes"). Leave empty for root.')
            .addText(text => text
                .setPlaceholder('Daily Notes')
                .setValue(this.plugin.settings.dailyNoteFolder || "")
                .onChange(async (value) => {
                    this.plugin.settings.dailyNoteFolder = value;
                    await this.plugin.saveSettings();
                }));
    }

    displayCommands(containerEl: HTMLElement): void {
        containerEl.createEl('p', { text: 'Manage the commands that appear in your right-click menu.' });

        new Setting(containerEl)
            .setName('Review & Confirm Changes')
            .setDesc('Show an "Accept/Undo" widget after AI writes to your note.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.confirmAIChanges)
                .onChange(async (val) => {
                    this.plugin.settings.confirmAIChanges = val;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Auto-Download External Images')
            .setDesc('Allow the AI to download and analyze images from internet URLs in your selection. (WARNING: This makes requests to external servers).')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.downloadExternalImages)
                .onChange(async (value) => {
                    this.plugin.settings.downloadExternalImages = value;
                    await this.plugin.saveSettings();
                }));

        containerEl.createEl('hr');

        // Restore Defaults Button
        new Setting(containerEl)
            .setName('Restore Default Commands')
            .setDesc('Reset all commands to the 6 predefined strategies.')
            .addButton(btn => btn
                .setButtonText("Reset Defaults")
                .setWarning()
                .onClick(async () => {
                    const doReset = async () => {
                        // Defaults with Pinned settings
                        this.plugin.settings.commands = [
                            { id: '1', name: 'Summarize Selection', prompt: 'You are a helpful assistant. Summarize the user\'s text concisely.', strategy: 'append', hidden: false, pinned: true },
                            { id: '2', name: 'Improve Writing', prompt: 'You are an expert editor. Rewrite the text to improve grammar, clarity, and flow.', strategy: 'replace', hidden: false, pinned: true },
                            { id: '3', name: 'Add Section Header', prompt: 'You are a technical writer. Create a concise Markdown header.', strategy: 'prepend', hidden: false, pinned: false },
                            { id: '4', name: 'Draft New Note', prompt: 'Draft a full note. First line is filename.', strategy: 'new-note', hidden: false, pinned: false },
                            { id: '5', name: 'Extract to Note', prompt: 'Extract core info. First line is filename.', strategy: 'extract', hidden: false, pinned: false },
                            { id: '6', name: 'Log to Daily', prompt: 'Format as log entry.', strategy: 'daily-note', hidden: false, pinned: false }
                        ];
                        await this.plugin.saveSettings();
                        this.display();
                    };
                    new ConfirmationModal(this.app, "Reset Commands?", "Are you sure? This will delete any custom commands.", doReset, "Reset").open();
                    new Notice("Default commands restored.");
                }));

        // --- Editable Command List ---
        this.plugin.settings.commands.forEach((cmd, index) => {
            const commandDiv = containerEl.createDiv();
            commandDiv.addClass('local-llm-command-card');
            commandDiv.style.border = "1px solid var(--background-modifier-border)";
            commandDiv.style.padding = "10px";
            commandDiv.style.marginBottom = "10px";
            commandDiv.style.borderRadius = "4px";

            // Header Row: Name + Icons (Pin, Visible, Delete)
            const headerSetting = new Setting(commandDiv)
                .setName('Action Name')
                .addText(text => text
                    .setValue(cmd.name)
                    .onChange(async (val) => {
                        cmd.name = val;
                        await this.plugin.saveSettings();
                    }));

            // Pin Toggle (Custom Icon for flavor)
            headerSetting.addToggle(toggle => {
                toggle.setValue(cmd.pinned || false)
                    .setTooltip('Pin to Quick Menu')
                    .onChange(async (val) => {
                        cmd.pinned = val;
                        await this.plugin.saveSettings();
                    });
            });

            // Visibility Toggle
            headerSetting.addToggle(toggle => toggle
                .setTooltip('Show in Menu')
                .setValue(!cmd.hidden)
                .onChange(async (val) => {
                    cmd.hidden = !val;
                    await this.plugin.saveSettings();
                }));

            // Delete Button
            headerSetting.addButton(btn => btn
                .setIcon('trash')
                .setTooltip('Delete Action')
                .setWarning()
                .onClick(async () => {
                    this.plugin.settings.commands.splice(index, 1);
                    await this.plugin.saveSettings();
                    this.display();
                }));

            // Strategy Dropdown
            new Setting(commandDiv)
                .setName('Output Strategy')
                .addDropdown(dropdown => dropdown
                    .addOption('replace', 'Replace Selection')
                    .addOption('append', 'Append to Selection')
                    .addOption('prepend', 'Prepend to Selection')
                    .addOption('new-note', 'Create New Note')
                    .addOption('extract', 'Extract & Link')
                    .addOption('daily-note', 'Append to Daily Note')
                    .setValue(cmd.strategy)
                    .onChange(async (val) => {
                        cmd.strategy = val as any;
                        await this.plugin.saveSettings();
                    }));

            // Prompt Text Area
            new Setting(commandDiv)
                .setName('System Prompt')
                .addTextArea(text => {
                    text
                        .setValue(cmd.prompt)
                        .onChange(async (val) => {
                            cmd.prompt = val;
                            await this.plugin.saveSettings();
                        });
                    text.inputEl.rows = 3;
                    text.inputEl.style.width = "100%";
                });
        });

        // --- Add New Action ---
        containerEl.createEl('h3', { text: 'Create New Action' });

        new Setting(containerEl)
            .setName('Add Custom Action')
            .addButton(btn => btn
                .setButtonText("Add New")
                .setCta()
                .onClick(async () => {
                    this.plugin.settings.commands.push({
                        id: Date.now().toString(),
                        name: 'New Action',
                        prompt: 'You are a helpful assistant.',
                        strategy: 'append',
                        hidden: false,
                        pinned: false
                    });
                    await this.plugin.saveSettings();
                    this.display();
                }));
    }

    async checkConnection(btn: any) {
        btn.setButtonText('Checking...');
        btn.setDisabled(true);
        try {
            // 1. Update config first (in case URL changed)
            this.plugin.llmClient.updateConfig(this.plugin.settings);

            // 2. List Models
            const models = await this.plugin.llmClient.listModels();
            const localModels = models.filter(m => m.providerId === 'local');

            if (localModels.length > 0) {
                new Notice(`Success! Found ${localModels.length} models.`);

                // 3. Auto-Select if empty - REMOVED to FORCE user selection
                // if (!this.plugin.settings.chatModel) { ... }

                // Just save the valid config if needed, or do nothing.
                // Actually, if we just want to populate the dropdowns, we don't need to save anything here unless we want to clear invalid ones.

                // Let's just notify success. The dropdowns will be repopulated by display()
                // changed = false; 

                // if (changed) { ... }

                // 4. Update UI
                this.display();
            } else {
                new Notice("Connection successful, but NO models found. Please check your LLM provider.");
            }
        } catch (e: any) {
            new Notice(`Connection Failed: ${e.message}`);
        } finally {
            btn.setButtonText('Check & Refresh Models');
            btn.setDisabled(false);
        }
    }
}

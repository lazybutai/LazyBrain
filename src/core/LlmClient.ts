import { LocalLLMSettings } from '../../main';
import { IModelProvider, ChatRequest, ChatResponse, Message } from './llm/IModelProvider';
import { ProviderRegistry } from './llm/ProviderRegistry';
import { OpenAIProvider } from './llm/providers/OpenAIProvider';
import { AnthropicProvider } from './llm/providers/AnthropicProvider';
import { GeminiProvider } from './llm/providers/GeminiProvider';
import { requestUrl, Notice } from 'obsidian';

export class LlmClient {
    private registry: ProviderRegistry;
    private chatModel: string = '';
    private embeddingModel: string = '';
    private enableSmartMemory: boolean = false;
    private autoUnloadOnChatSwitch: boolean = false;
    public enableBackgroundIndexing: boolean = true;
    private modelUrl: string = '';
    private activeOllamaModel: string | null = null;

    constructor(settings: LocalLLMSettings) {
        this.registry = new ProviderRegistry();
        this.updateConfig(settings);
    }

    updateConfig(settings: LocalLLMSettings) {
        this.chatModel = settings.chatModel;
        this.embeddingModel = settings.embeddingModel;
        this.enableSmartMemory = settings.enableSmartMemory;
        this.autoUnloadOnChatSwitch = settings.autoUnloadOnChatSwitch;
        this.enableBackgroundIndexing = settings.enableBackgroundIndexing;
        this.modelUrl = settings.modelUrl;

        // 1. Local Provider (OpenAI Compatible)
        if (settings.modelUrl) {
            this.registry.register(new OpenAIProvider(
                "local",
                "Local LLM",
                settings.apiKey || "lm-studio",
                settings.modelUrl
            ));
        }

        // 2. OpenAI
        if (settings.openaiApiKey) {
            this.registry.register(new OpenAIProvider(
                "openai",
                "OpenAI",
                settings.openaiApiKey,
                "https://api.openai.com/v1"
            ));
        }

        // 3. Anthropic
        if (settings.anthropicApiKey) {
            this.registry.register(new AnthropicProvider(settings.anthropicApiKey));
        }

        // 4. Gemini
        if (settings.geminiApiKey) {
            this.registry.register(new GeminiProvider(settings.geminiApiKey));
        }

        // 5. Grok (xAI)
        if (settings.grokApiKey) {
            this.registry.register(new OpenAIProvider(
                "grok",
                "Grok",
                settings.grokApiKey,
                "https://api.x.ai/v1"
            ));
        }

        // 6. OpenRouter
        if (settings.openRouterApiKey) {
            this.registry.register(new OpenAIProvider(
                "openrouter",
                "OpenRouter",
                settings.openRouterApiKey,
                "https://openrouter.ai/api/v1"
            ));
        }
    }

    async listModels(): Promise<{ id: string, name: string, providerId: string, capabilities?: any }[]> {
        const allModels: { id: string, name: string, providerId: string, capabilities?: any }[] = [];
        const providers = this.registry.getAll();

        for (const provider of providers) {
            try {
                const models = await provider.getModels();
                for (const m of models) {
                    allModels.push({
                        id: `${provider.id}:${m.id}`, // Scoped ID
                        name: m.name || m.id,
                        providerId: provider.id,
                        capabilities: m.capabilities
                    });
                }
            } catch (e) {
                console.error(`Error listing models for ${provider.name}`, e);
            }
        }
        return allModels;
    }

    async unloadOllamaModel(model: string) {
        // Derive base URL for Ollama /api/generate endpoint (remove /v1)
        let baseUrl = this.modelUrl || "http://localhost:11434";
        baseUrl = baseUrl.replace(/\/v1\/?$/, "");

        try {
            console.log(`[Smart Memory] Unloading model: ${model}`);
            await requestUrl({
                url: `${baseUrl}/api/generate`,
                method: 'POST',
                body: JSON.stringify({ model: model, keep_alive: 0 })
            });
        } catch (e) {
            console.warn(`[Smart Memory] Failed to unload model ${model}:`, e);
        }
    }

    async getRunningModels(): Promise<string[]> {
        let baseUrl = this.modelUrl || "http://localhost:11434";
        baseUrl = baseUrl.replace(/\/v1\/?$/, "");
        try {
            const res = await requestUrl({ url: `${baseUrl}/api/ps` });
            if (res.status === 200 && res.json && res.json.models) {
                return res.json.models.map((m: any) => m.name || m.model);
            }
        } catch (e) { /* ignore */ }
        return [];
    }

    // Compatibility wrapper for old calls
    async chatCompletion(request: any): Promise<any> {
        // Adapt old request format if needed, or assume caller updates
        // For now, let's assume we might receive a scoped model ID or default to local

        let providerId = "local";
        let modelId = request.model;

        // Auto-Detect / Default substitution for Local
        if ((!modelId || modelId === 'local') && providerId === 'local' && this.chatModel) {
            modelId = this.chatModel;
        }

        if (request.model && request.model.includes(':')) {
            const parts = request.model.split(':');
            providerId = parts[0];
            modelId = parts.slice(1).join(':');
        }

        const provider = this.registry.get(providerId);
        if (!provider) {
            throw new Error(`Provider ${providerId} not found or not configured.`);
        }

        // --- Smart Memory & Auto-Unload ---
        if (providerId === 'local' && modelId) {
            const isSwitching = this.activeOllamaModel && this.activeOllamaModel !== modelId;
            if (isSwitching && (this.autoUnloadOnChatSwitch || this.enableSmartMemory)) {
                await this.unloadOllamaModel(this.activeOllamaModel!);
            }
            this.activeOllamaModel = modelId;
        }
        // -------------------------------

        // Adapt request to ChatRequest interface
        const chatReq: ChatRequest = {
            messages: request.messages,
            model: modelId, // Strip prefix
            temperature: request.temperature,
            stream: false,
            tools: request.tools,
            tool_choice: request.tool_choice
        };

        const response = await provider.chatCompletion(chatReq);
        return {
            // Return OpenAI-like shape for compatibility with existing UI code
            role: 'assistant',
            content: response.content,
            tool_calls: response.tool_calls
        };
    }

    // For full response (used in web search tool calling loop)
    async chatCompletionFull(request: any): Promise<{ content: string, tool_calls?: any[] }> {
        // Reuse chatCompletion logic since provider returns structured object
        const res = await this.chatCompletion(request);
        return {
            content: res.content,
            tool_calls: res.tool_calls
        };
    }

    async *streamChatCompletion(request: any): AsyncGenerator<string> {
        let providerId = "local";
        let modelId = request.model;

        // Auto-Detect / Default substitution for Local
        if ((!modelId || modelId === 'local') && providerId === 'local' && this.chatModel) {
            modelId = this.chatModel;
        }

        if (request.model && request.model.includes(':')) {
            const parts = request.model.split(':');
            providerId = parts[0];
            modelId = parts.slice(1).join(':');
        }

        const provider = this.registry.get(providerId);
        if (!provider) {
            // Fallback or error
            console.error(`Provider ${providerId} not found.`);
            yield "Error: Provider not configured.";
            return;
        }

        // --- Smart Memory & Auto-Unload ---
        if (providerId === 'local' && modelId) {
            const isSwitching = this.activeOllamaModel && this.activeOllamaModel !== modelId;
            if (isSwitching && (this.autoUnloadOnChatSwitch || this.enableSmartMemory)) {
                await this.unloadOllamaModel(this.activeOllamaModel!);
            }
            this.activeOllamaModel = modelId;
        }
        // -------------------------------

        const chatReq: ChatRequest = {
            messages: request.messages,
            model: modelId,
            temperature: request.temperature,
            stream: true,
            signal: request.signal,
            tools: request.tools,
            tool_choice: request.tool_choice
        };

        const stream = provider.streamChatCompletion(chatReq);
        for await (const chunk of stream) {
            yield chunk;
        }
    }

    // Embeddings usually stay local or use OpenAI
    // For now, let's keep it tied to Local or make it configurable?
    // User didn't ask for multi-provider embeddings, usually RAG uses one consistent model.
    // We will default to local for embeddings to avoid cost, or add a setting later.
    async createEmbedding(text: string): Promise<number[]> {
        // Reuse local logic or OpenAI if local not set? 
        // Let's assume embeddings are still on the "modelUrl" (Local) for now to minimize breakage.
        // Or if user wants OpenAI embeddings, we need to expose that.
        // For MVP refactor, sticking to existing embedding implementation (copy-paste from old Client).

        // We can just use the 'local' provider if it supports it, but IModelProvider doesn't have createEmbedding yet.
        // I'll re-implement the basic fetch here for now, targeting the local URL.

        // NOTE: Ideally IModelProvider should have createEmbedding too.

        // HACK: Just grabbing the local settings via a direct approach or storing them
        // Check registry for 'local'
        const local = this.registry.get('local') as OpenAIProvider;
        if (local) {
            let modelToUse = this.embeddingModel;

            // Auto-detect if missing (avoid defaults that cause 404)
            if (!modelToUse || modelToUse === 'local-model') {
                console.log("No embedding model set. Attempting auto-detection...");
                try {
                    const models = await this.listModels();
                    const localModels = models.filter(m => m.providerId === 'local');
                    // Prefer 'embed' in name, otherwise fallback to first local
                    const bestMatch = localModels.find(m => m.id.includes('embed')) || localModels[0];
                    if (bestMatch) {
                        modelToUse = bestMatch.id.includes(':') ? bestMatch.id.split(':')[1] : bestMatch.id;
                        console.log(`Auto-detected embedding model: ${modelToUse}`);
                        // Optional: We could update settings here if we had access, but for now just use it.
                    }
                } catch (e) { console.warn("Auto-detect failed", e); }
            }

            if (!modelToUse || modelToUse === 'local-model') {
                new Notice("RAG Error: No embedding model selected. Check Settings > Ollama.");
                return []; // Fail gracefully
            }

            // --- Smart Memory Management ---
            // If we are about to use a DIFFERENT model for embedding than what is active (e.g. chat), unload active.
            if (this.enableSmartMemory) {
                if (this.activeOllamaModel && this.activeOllamaModel !== modelToUse) {
                    await this.unloadOllamaModel(this.activeOllamaModel);
                }
                this.activeOllamaModel = modelToUse;
            }
            // -------------------------------

            console.log(`[RAG Debug] Generating embedding. Model: '${modelToUse}', BaseUrl: '${local.baseUrl}'`);

            // We can use NetworkUtils to call embeddings on local
            try {
                const response = await requestUrl({
                    url: `${local.baseUrl}/embeddings`,
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${local.apiKey}`
                    },
                    body: JSON.stringify({
                        input: text,
                        model: modelToUse
                    })
                });
                console.log("[RAG Debug] Standard embeddings success.");
                return response.json?.data?.[0]?.embedding || [];
            } catch (e: any) {
                console.warn(`[RAG Debug] Standard embeddings failed (${e.status}). URL: ${local.baseUrl}/embeddings. Model: ${modelToUse}`);
                // FALLBACK: Try Ollama Native API if /v1/embeddings fails (e.g. 404)
                if (e.status === 404) {
                    console.warn("Standard embeddings failed (404), trying Ollama /api/embeddings fallback...");
                    try {
                        let baseUrl = this.modelUrl || "http://localhost:11434";
                        baseUrl = baseUrl.replace(/\/v1\/?$/, "");
                        console.log(`[RAG Debug] Fallback URL: ${baseUrl}/api/embeddings. Model: ${modelToUse}`);

                        const res = await requestUrl({
                            url: `${baseUrl}/api/embeddings`,
                            method: 'POST',
                            body: JSON.stringify({
                                model: modelToUse,
                                prompt: text
                            })
                        });

                        console.log("[RAG Debug] Fallback embeddings success.");
                        return res.json?.embedding || [];
                    } catch (innerE) {
                        console.error("Fallback embeddings also failed:", innerE);
                        throw e; // Throw original error
                    }
                }
                throw e;
            }
        }
        return [];
    }

    async preloadModel(modelId: string) {
        // Find provider
        const local = this.registry.get('local') as OpenAIProvider;
        if (local) {
            try {
                let baseUrl = this.modelUrl || "http://localhost:11434";
                baseUrl = baseUrl.replace(/\/v1\/?$/, "");
                console.log(`[LocalLLM] Preloading model: ${modelId}`);
                await requestUrl({
                    url: `${baseUrl}/api/generate`,
                    method: 'POST',
                    body: JSON.stringify({ model: modelId, prompt: "", keep_alive: -1 })
                });
                console.log(`[LocalLLM] Preloaded: ${modelId}`);
            } catch (e) {
                console.warn(`[LocalLLM] Failed to preload ${modelId}`, e);
            }
        }
    }
}
export type { Message }; // Re-export for compatibility

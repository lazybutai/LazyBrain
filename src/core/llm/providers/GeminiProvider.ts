import { IModelProvider, ChatRequest, ChatResponse } from '../IModelProvider';
import { NetworkUtils } from '../NetworkUtils';

export class GeminiProvider implements IModelProvider {
    id = "gemini";
    name = "Google Gemini";
    apiKey: string;
    baseUrl = "https://generativelanguage.googleapis.com/v1beta/models";

    constructor(apiKey: string) {
        this.apiKey = apiKey;
    }

    async getModels(): Promise<import('../IModelProvider').ModelInfo[]> {
        const models: import('../IModelProvider').ModelInfo[] = [];
        // 1. Try to fetch dynamic list
        try {
            const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${this.apiKey}`;
            const response = await NetworkUtils.makeRequest(url, 'GET', {}, null);
            if (response && response.models) {
                response.models.forEach((m: any) => {
                    // Filter for generateContent supported models
                    if (m.supportedGenerationMethods && m.supportedGenerationMethods.includes("generateContent")) {
                        const id = m.name.replace("models/", ""); // API returns "models/gemini-..."
                        // Basic capability mapping
                        const caps = { vision: false, tools: true, reasoning: false };
                        if (id.includes("vision") || id.includes("1.5") || id.includes("2.0")) caps.vision = true;
                        if (id.includes("pro") || id.includes("ultra")) caps.reasoning = true;

                        models.push({ id: id, name: m.displayName || id, capabilities: caps });
                    }
                });
            }
        } catch (e) {
            console.warn("Gemini: Failed to fetch models, using fallback.", e);
        }

        // 2. Fallback if empty (or failed)
        if (models.length === 0) {
            return [
                { id: "gemini-1.5-pro", name: "Gemini 1.5 Pro", capabilities: { vision: true, tools: true, reasoning: true } },
                { id: "gemini-1.5-flash", name: "Gemini 1.5 Flash", capabilities: { vision: true, tools: true } },
                { id: "gemini-1.5-flash-8b", name: "Gemini 1.5 Flash-8B", capabilities: { vision: true, tools: true } },
                { id: "gemini-2.0-flash-exp", name: "Gemini 2.0 Flash (Experimental)", capabilities: { vision: true, tools: true } }
            ];
        }

        return models;
    }

    async chatCompletion(req: ChatRequest): Promise<ChatResponse> {
        const model = req.model || 'gemini-1.5-flash';
        const url = `${this.baseUrl}/${model}:generateContent?key=${this.apiKey}`;

        // Map messages
        const contents = req.messages.filter(m => m.role !== 'system').map(m => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content || "" }]
        }));

        // System instruction
        const systemMsg = req.messages.find(m => m.role === 'system');

        const body: any = {
            contents: contents,
            generationConfig: {
                temperature: req.temperature,
            }
        };

        if (systemMsg && systemMsg.content) {
            body.systemInstruction = { parts: [{ text: systemMsg.content }] };
        }

        const response = await NetworkUtils.makeRequest(url, 'POST', {
            'Content-Type': 'application/json'
        }, body, req.signal);

        // Response: { candidates: [ { content: { parts: [ { text: "..." } ] } } ] }
        const text = response.candidates?.[0]?.content?.parts?.[0]?.text || '';
        return {
            content: text
        };
    }

    async *streamChatCompletion(req: ChatRequest): AsyncGenerator<string> {
        const model = req.model || 'gemini-1.5-flash';
        // streamGenerateContent?alt=sse required for manual SSE? 
        // Or REST API returns a JSON array stream?
        // Google REST stream usually requires ?alt=sse
        const url = `${this.baseUrl}/${model}:streamGenerateContent?alt=sse&key=${this.apiKey}`;

        const contents = req.messages.filter(m => m.role !== 'system').map(m => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content || "" }]
        }));

        const systemMsg = req.messages.find(m => m.role === 'system');

        const body: any = {
            contents: contents,
            generationConfig: {
                temperature: req.temperature,
            }
        };
        if (systemMsg && systemMsg.content) {
            body.systemInstruction = { parts: [{ text: systemMsg.content }] };
        }

        const stream = NetworkUtils.streamRequest(url, 'POST', {
            'Content-Type': 'application/json'
        }, body, req.signal);

        let buffer = "";
        for await (const chunk of stream) {
            buffer += chunk;
            const lines = buffer.split('\n');
            buffer = lines.pop() || "";

            for (const line of lines) {
                const trimmed = line.trim();
                // Gemini SSE: data: <json>
                if (trimmed.startsWith('data: ')) {
                    try {
                        const jsonStr = trimmed.slice(6);
                        if (jsonStr === '[DONE]') continue;
                        const data = JSON.parse(jsonStr);
                        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
                        if (text) yield text;
                    } catch (e) { }
                }
            }
        }
    }
}

import { IModelProvider, ChatRequest, ChatResponse } from '../IModelProvider';
import { NetworkUtils } from '../NetworkUtils';

export class AnthropicProvider implements IModelProvider {
    id = "anthropic";
    name = "Anthropic";
    apiKey: string;
    baseUrl = "https://api.anthropic.com/v1";

    constructor(apiKey: string) {
        this.apiKey = apiKey;
    }

    async getModels(): Promise<import('../IModelProvider').ModelInfo[]> {
        try {
            const response = await NetworkUtils.makeRequest(`${this.baseUrl}/models`, 'GET', {
                'x-api-key': this.apiKey,
                'anthropic-version': '2023-06-01'
            }, null);

            if (response.data && Array.isArray(response.data)) {
                return response.data.map((m: any) => ({
                    id: m.id,
                    name: m.display_name || m.id,
                    capabilities: { vision: true, tools: true }
                }));
            }
        } catch (e) {
            console.warn("Failed to fetch Anthropic models, falling back to static list.", e);
        }

        return [
            { id: "claude-3-5-sonnet-20241022", name: "Claude 3.5 Sonnet (New)", capabilities: { vision: true, tools: true } },
            { id: "claude-3-5-haiku-20241022", name: "Claude 3.5 Haiku", capabilities: { vision: true, tools: true } },
            { id: "claude-3-5-sonnet-20240620", name: "Claude 3.5 Sonnet", capabilities: { vision: true, tools: true } },
            { id: "claude-3-opus-20240229", name: "Claude 3 Opus", capabilities: { vision: true, tools: true } },
            { id: "claude-3-sonnet-20240229", name: "Claude 3 Sonnet", capabilities: { vision: true, tools: true } },
            { id: "claude-3-haiku-20240307", name: "Claude 3 Haiku", capabilities: { vision: true, tools: true } }
        ];
    }

    async chatCompletion(req: ChatRequest): Promise<ChatResponse> {
        const url = `${this.baseUrl}/messages`;

        let systemPrompt = "";
        const messages = req.messages.filter(m => {
            if (m.role === 'system') {
                systemPrompt += (m.content || "") + "\n";
                return false;
            }
            return true;
        }).map(m => {
            if (m.images && m.images.length > 0) {
                const content: any[] = [];
                m.images.forEach(imgBase64 => {
                    let mediaType = "image/jpeg";
                    let data = imgBase64;
                    if (imgBase64.includes(';base64,')) {
                        const parts = imgBase64.split(';base64,');
                        mediaType = parts[0].replace('data:', '');
                        data = parts[1];
                    }
                    content.push({
                        type: "image",
                        source: { type: "base64", media_type: mediaType, data: data }
                    });
                });
                if (m.content) content.push({ type: "text", text: m.content });
                return { role: m.role, content: content };
            }
            return { role: m.role, content: m.content };
        });

        const body: any = {
            model: req.model || 'claude-3-5-sonnet-20240620',
            messages: messages,
            max_tokens: 4096,
            temperature: req.temperature,
            stream: false
        };

        if (systemPrompt.trim()) body.system = systemPrompt.trim();

        const response = await NetworkUtils.makeRequest(url, 'POST', {
            'x-api-key': this.apiKey,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json'
        }, body, req.signal);

        const contentBlock = response.content?.find((c: any) => c.type === 'text');
        return {
            content: contentBlock?.text || '',
            tool_calls: undefined
        };
    }

    async *streamChatCompletion(req: ChatRequest): AsyncGenerator<string> {
        // ... setup ...

        const url = `${this.baseUrl}/messages`;

        let systemPrompt = "";
        const messages = req.messages.filter(m => {
            if (m.role === 'system') {
                systemPrompt += (m.content || "") + "\n";
                return false;
            }
            return true;
        }).map(m => {
            if (m.images && m.images.length > 0) {
                const content: any[] = [];
                m.images.forEach(imgBase64 => {
                    let mediaType = "image/jpeg";
                    let data = imgBase64;
                    if (imgBase64.includes(';base64,')) {
                        const parts = imgBase64.split(';base64,');
                        mediaType = parts[0].replace('data:', '');
                        data = parts[1];
                    }
                    content.push({
                        type: "image",
                        source: { type: "base64", media_type: mediaType, data: data }
                    });
                });
                if (m.content) content.push({ type: "text", text: m.content });
                return { role: m.role, content: content };
            }
            return { role: m.role, content: m.content };
        });

        const body: any = {
            model: req.model || 'claude-3-5-sonnet-20240620',
            messages: messages,
            max_tokens: 4096,
            temperature: req.temperature,
            stream: true
        };

        if (systemPrompt.trim()) body.system = systemPrompt.trim();

        const stream = NetworkUtils.streamRequest(url, 'POST', {
            'x-api-key': this.apiKey,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json'
        }, body, req.signal);

        let buffer = "";
        try {
            for await (const chunk of stream) {
                buffer += chunk;
                const lines = buffer.split('\n');
                buffer = lines.pop() || "";

                for (const line of lines) {
                    this.processLine(line);
                    const yielded = this.extractContent(line);
                    if (yielded) yield yielded;
                }
            }
            // FLUSH BUFFER: Process any remaining text (CRITICAL for error messages)
            if (buffer.trim()) {
                console.log("Anthropic: Flushing remaining buffer:", buffer);
                this.processLine(buffer);
                // Also check if it's a raw JSON error
                try {
                    const data = JSON.parse(buffer);
                    if (data.type === 'error') {
                        console.error("Anthropic API Error (Flushed):", data);
                        throw new Error(data.error?.message || "Anthropic Stream Error");
                    }
                } catch (e) { }
            }
        } catch (error) {
            console.error("Anthropic Stream Error Caught:", error);
            throw error;
        }
    }

    private processLine(line: string) {
        const trimmed = line.trim();
        if (!trimmed) return;
        if (trimmed.startsWith('data: ')) {
            // Normal handling
        } else if (trimmed.startsWith('event:')) {
            // Ignore
        } else {
            console.error("Anthropic Non-SSE Line:", trimmed);
        }
    }

    private extractContent(line: string): string | null {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) return null;
        try {
            const data = JSON.parse(trimmed.slice(6));
            if (data.type === 'content_block_delta' && data.delta?.type === 'text_delta') {
                return data.delta.text;
            }
            if (data.type === 'error') {
                console.error("Anthropic API Error Event:", data);
                throw new Error(data.error?.message || "Anthropic Stream Error");
            }
        } catch (e) { }
        return null;
    }
}

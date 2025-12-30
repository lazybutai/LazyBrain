import { IModelProvider, ChatRequest, ChatResponse } from '../IModelProvider';
import { NetworkUtils } from '../NetworkUtils';

export class OpenAIProvider implements IModelProvider {
    id: string;
    name: string;
    apiKey: string;
    baseUrl: string;

    constructor(id: string, name: string, apiKey: string, baseUrl: string) {
        this.id = id;
        this.name = name;
        this.apiKey = apiKey;
        this.baseUrl = baseUrl.replace(/\/$/, '');
    }

    async getModels(): Promise<import('../IModelProvider').ModelInfo[]> {
        if (!this.apiKey) return [];
        try {
            const response = await NetworkUtils.makeRequest(`${this.baseUrl}/models`, 'GET', {
                'Authorization': `Bearer ${this.apiKey}`
            }, null);

            // OpenAI usually: { data: [{ id: 'gpt-4' }, ...] }
            if (response.data && Array.isArray(response.data)) {
                return response.data.map((m: any) => {
                    const id = m.id;
                    return {
                        id: id,
                        name: id,
                        capabilities: this.detectCapabilities(id)
                    };
                }).sort((a: any, b: any) => a.id.localeCompare(b.id));
            }
            return [];
        } catch (e) {
            console.error(`Failed to fetch models for ${this.name}`, e);
            return [];
        }
    }

    private detectCapabilities(modelId: string) {
        const lower = modelId.toLowerCase();
        const caps = { vision: false, tools: false, reasoning: false };

        // Vision
        if (lower.includes('gpt-4') || lower.includes('gpt-4o') || lower.includes('o1')) caps.vision = true;
        if (lower.includes('llava') || lower.includes('bakllava') || lower.includes('vision') || lower.includes('moondream') || lower.includes('vl') || lower.includes('qwen-vl')) caps.vision = true;
        if (lower.includes('grok') && (lower.includes('vision') || lower.includes('1.5') || lower.includes('2'))) caps.vision = true; // Grok-1.5V and Grok-2

        // Tools
        if (lower.includes('gpt-4') || lower.includes('gpt-3.5') || lower.includes('o1')) caps.tools = true;
        if (lower.includes('function') || lower.includes('tool') || lower.includes('hermes-2-pro')) caps.tools = true;
        if (lower.includes('grok')) caps.tools = true; // Most Grok models support tools nowadays

        // Reasoning
        if (lower.includes('o1') || lower.includes('qwq')) caps.reasoning = true;

        return caps;
    }

    async chatCompletion(req: ChatRequest): Promise<ChatResponse> {
        const url = `${this.baseUrl}/chat/completions`;
        const body = {
            messages: req.messages.map(m => {
                // 1. Handle Images (Vision)
                if (m.images && m.images.length > 0) {
                    const content: any[] = [];
                    if (m.content) content.push({ type: "text", text: m.content });
                    m.images.forEach(img => {
                        content.push({ type: "image_url", image_url: { url: img } });
                    });
                    return {
                        role: m.role,
                        content: content,
                        tool_calls: m.tool_calls,
                        tool_call_id: m.tool_call_id
                    };
                }

                // 2. Standard Text / Tool Message
                // Fix: Ensure content is not null (Ollama 400 fix) and preserve tool use properties
                return {
                    role: m.role,
                    content: m.content || "", // Force empty string if null
                    tool_calls: m.tool_calls,
                    tool_call_id: m.tool_call_id
                };
            }),
            model: req.model,
            temperature: req.temperature,
            stream: false,
            tools: req.tools,
            tool_choice: req.tool_choice
        };
        // console.log("OpenAI Payload:", JSON.stringify(body, null, 2)); // Security: Removed for production

        const response = await NetworkUtils.makeRequest(url, 'POST', {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiKey}`
        }, body, req.signal);

        const msg = response.choices?.[0]?.message || {};

        let content = msg.content || '';
        let tool_calls = msg.tool_calls;

        // COMMAND-R LOCAL MODEL COMPATIBILITY
        // Local models (like Command-R via LM Studio) might output tool calls as raw text.
        // Format: <|channel|>commentary to=tool_name <|constrain|>json<|message|>{"args": ...}
        if (!tool_calls && content.includes('<|channel|>commentary to=')) {
            try {
                // console.log("Detected potential Command-R tool call in content:", content);

                // 1. Extract Tool Name
                const markerTo = 'to=';
                const nameStart = content.indexOf(markerTo);

                if (nameStart !== -1) {
                    const startPos = nameStart + markerTo.length;
                    // Tool name ends at the next space or tag start
                    let endPos = content.indexOf(' ', startPos);
                    if (endPos === -1) endPos = content.indexOf('<', startPos);

                    if (endPos !== -1) {
                        const toolName = content.substring(startPos, endPos).trim();

                        // 2. Extract JSON Arguments
                        const markerMsg = '<|message|>';
                        const msgStart = content.indexOf(markerMsg);

                        if (msgStart !== -1) {
                            let jsonStr = content.substring(msgStart + markerMsg.length).trim();

                            // Find the last closing brace to avoid trailing garbage
                            const lastBrace = jsonStr.lastIndexOf('}');
                            if (lastBrace !== -1) {
                                jsonStr = jsonStr.substring(0, lastBrace + 1);

                                // Validate JSON
                                JSON.parse(jsonStr);

                                tool_calls = [{
                                    id: `call_${Date.now()}`,
                                    type: 'function',
                                    function: {
                                        name: toolName,
                                        arguments: jsonStr
                                    }
                                }];

                                // Clear content to prevent raw tokens from showing in UI
                                // We keep it empty so the UI accepts it as a pure tool call
                                content = "";
                                console.log(`Command-R Tool Call Parsed: ${toolName}`, jsonStr);
                            }
                        }
                    }
                }
            } catch (e) {
                console.warn("Failed to parse Command-R tool call", e);
            }
        }

        return {
            content: content,
            tool_calls: tool_calls
        };
    }

    async *streamChatCompletion(req: ChatRequest): AsyncGenerator<string> {
        const url = `${this.baseUrl}/chat/completions`;
        const body = {
            messages: req.messages.map(m => {
                // 1. Handle Images (Vision)
                if (m.images && m.images.length > 0) {
                    const content: any[] = [];
                    if (m.content) content.push({ type: "text", text: m.content });
                    m.images.forEach(img => {
                        content.push({ type: "image_url", image_url: { url: img } });
                    });
                    return {
                        role: m.role,
                        content: content,
                        tool_calls: m.tool_calls,
                        tool_call_id: m.tool_call_id
                    };
                }

                // 2. Standard Text / Tool Message
                // Fix: Ensure content is not null (Ollama 400 fix) and preserve tool use properties
                return {
                    role: m.role,
                    content: m.content || "", // Force empty string if null
                    tool_calls: m.tool_calls,
                    tool_call_id: m.tool_call_id
                };
            }),
            model: req.model,
            temperature: req.temperature,
            stream: true,
            tools: req.tools,
            tool_choice: req.tool_choice
        };

        const stream = NetworkUtils.streamRequest(url, 'POST', {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiKey}`
        }, body, req.signal);

        let buffer = "";
        for await (const chunk of stream) {
            buffer += chunk;
            const lines = buffer.split('\n');
            buffer = lines.pop() || "";

            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || trimmed === 'data: [DONE]') continue;
                if (trimmed.startsWith('data: ') || trimmed.startsWith('data:')) {
                    try {
                        const jsonStr = trimmed.substring(trimmed.indexOf(':') + 1).trim();
                        const data = JSON.parse(jsonStr);
                        const content = data.choices?.[0]?.delta?.content;
                        if (content) {
                            // console.log("OpenAI Content:", content);
                            yield content;
                        }
                    } catch (e) { console.warn("OpenAI Parse Error", e); }
                }
            }
        }
    }
}

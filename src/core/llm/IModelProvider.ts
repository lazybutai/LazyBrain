
export interface Message {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string | null;
    tool_calls?: any[];
    tool_call_id?: string;
    images?: string[]; // Base64 encoded images
}

export interface ChatRequest {
    messages: Message[];
    model?: string;
    temperature?: number;
    stream?: boolean;
    signal?: AbortSignal;
    tools?: any[];
    tool_choice?: any;
}

export interface ChatResponse {
    content: string;
    tool_calls?: any[];
}

export interface IModelProvider {
    id: string;      // e.g. "openai", "anthropic", "local"
    name: string;    // e.g. "OpenAI", "Anthropic", "Local LLM"

    getModels(): Promise<ModelInfo[]>;

    chatCompletion(req: ChatRequest): Promise<ChatResponse>;
    streamChatCompletion(req: ChatRequest): AsyncGenerator<string>;
}

export interface ModelInfo {
    id: string;
    name?: string; // Human readable name if different
    contextWindow?: number;
    capabilities?: {
        vision?: boolean;
        tools?: boolean; // Function calling
        reasoning?: boolean; // e.g. o1/QwQ
    };
}

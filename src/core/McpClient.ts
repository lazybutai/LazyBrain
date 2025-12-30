
import { Notice } from 'obsidian';

// Basic JSON-RPC Types
interface JsonRpcRequest {
    jsonrpc: "2.0";
    id: number | string;
    method: string;
    params?: any;
}

interface JsonRpcResponse {
    jsonrpc: "2.0";
    id: number | string;
    result?: any;
    error?: {
        code: number;
        message: string;
        data?: any;
    };
}

export class McpClient {
    private process: any = null; // ChildProcess
    private requestCounter = 0;
    private pendingRequests: Map<number | string, (resolve: any, reject: any) => void> = new Map();
    private apiKey: string;

    // Buffer for stream parsing
    private buffer = "";

    constructor(apiKey: string) {
        this.apiKey = apiKey;
    }

    isRunning(): boolean {
        return this.process !== null;
    }

    async start() {
        if (this.process) return;

        // @ts-ignore
        if (typeof require === 'undefined') {
            new Notice("MCP requires Desktop Node.js access.");
            return;
        }
        // @ts-ignore
        const { spawn } = require('child_process');

        if (!this.apiKey) {
            new Notice("Brave API Key is missing.");
            throw new Error("Brave API Key is missing.");
        }

        console.log("MCP: Starting Brave Search Server...");

        // Command: npx -y @modelcontextprotocol/server-brave-search
        // Needs env BRAVE_API_KEY

        // FIX: Use platform-specific command.
        // On Windows, npx.cmd requires a shell or careful invocation to avoid EINVAL/ENOENT.
        // We accept shell: true here because the command and arguments are hardcoded and safe.
        const isWindows = process.platform === 'win32';
        const cmd = isWindows ? 'npx.cmd' : 'npx';

        this.process = spawn(cmd, ['-y', '@modelcontextprotocol/server-brave-search'], {
            env: { ...process.env, BRAVE_API_KEY: this.apiKey },
            shell: isWindows, // Windows needs shell for batch files like npx.cmd
            stdio: ['pipe', 'pipe', 'pipe']
        });

        this.process.stdout.on('data', (data: Buffer) => {
            this.handleData(data.toString());
        });

        this.process.stderr.on('data', (data: Buffer) => {
            console.error(`MCP Stderr: ${data.toString()}`);
        });

        this.process.on('error', (err: any) => {
            console.error("MCP Process Error:", err);
            new Notice("MCP Process Error: " + err.message);
            this.stop();
        });

        this.process.on('exit', (code: number) => {
            console.log(`MCP Process exited with code ${code}`);
            this.stop();
        });

        // Initialize MCP Connection (Initialize Request)
        await this.sendRequest('initialize', {
            protocolVersion: "2024-11-05",
            capabilities: { tools: {} },
            clientInfo: { name: "obsidian-local-llm", version: "1.0.0" }
        });

        await this.sendNotification('notifications/initialized', {});
        new Notice("MCP Web Search Connected.");
    }

    stop() {
        if (this.process) {
            this.process.kill();
            this.process = null;
        }
        this.pendingRequests.clear();
        this.buffer = "";
    }

    async listTools(): Promise<any[]> {
        if (!this.process) await this.start();
        const response = await this.sendRequest('tools/list', {});
        return response.tools || [];
    }

    async callTool(name: string, args: any): Promise<any> {
        if (!this.process) await this.start();
        const response = await this.sendRequest('tools/call', {
            name: name,
            arguments: args
        });
        return response;
    }

    // --- JSON-RPC Implementation ---

    private async sendRequest(method: string, params: any): Promise<any> {
        const id = this.requestCounter++;
        const request: JsonRpcRequest = { jsonrpc: "2.0", id, method, params };

        return new Promise((resolve, reject) => {
            this.pendingRequests.set(id, { resolve, reject } as any);
            this.send(request);

            // Timeout
            setTimeout(() => {
                if (this.pendingRequests.has(id)) {
                    this.pendingRequests.delete(id);
                    reject(new Error(`MCP Request ${method} timed out`));
                }
            }, 10000);
        });
    }

    private async sendNotification(method: string, params: any) {
        const request: JsonRpcRequest = { jsonrpc: "2.0", id: null as any, method, params }; // Notifications have no ID? Protocol says omit ID or null
        // Actually MCP spec for notifications: do not include id.
        const notification = { jsonrpc: "2.0", method, params };
        this.send(notification);
    }

    private send(msg: any) {
        if (!this.process) throw new Error("MCP process not running");
        const str = JSON.stringify(msg) + "\n";
        this.process.stdin.write(str);
    }

    private handleData(chunk: string) {
        this.buffer += chunk;
        const lines = this.buffer.split('\n');
        this.buffer = lines.pop() || ""; // Keep incomplete line

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            try {
                const msg = JSON.parse(trimmed);
                if (msg.id !== undefined && (msg.result || msg.error)) {
                    // Response
                    const pending = this.pendingRequests.get(msg.id);
                    if (pending) {
                        // @ts-ignore
                        const { resolve, reject } = pending;
                        this.pendingRequests.delete(msg.id);
                        if (msg.error) reject(new Error(msg.error.message));
                        else resolve(msg.result);
                    }
                } else {
                    // Notification or Request from Server? Ignore for now
                    // console.log("MCP Notification:", msg);
                }
            } catch (e) {
                console.error("MCP Parse Error:", e);
            }
        }
    }
}

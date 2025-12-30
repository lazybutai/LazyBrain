import { requestUrl } from 'obsidian';

export class NetworkUtils {

    static async makeRequest(url: string, method: 'POST' | 'GET', headers: any, body: any, signal?: AbortSignal): Promise<any> {
        // Node.js Implementation (Desktop) - Bypasses CORS
        // @ts-ignore
        if (typeof require !== 'undefined' && typeof process !== 'undefined') {
            // @ts-ignore
            const http = require('http');
            // @ts-ignore
            const https = require('https');
            const { URL } = require('url');

            const parsedUrl = new URL(url);
            const options = {
                method: method,
                hostname: parsedUrl.hostname,
                port: parsedUrl.port,
                path: parsedUrl.pathname + parsedUrl.search,
                headers: headers,
                signal: signal
            };

            return new Promise((resolve, reject) => {
                const req = (parsedUrl.protocol === 'https:' ? https : http).request(options, (res: any) => {
                    let data = '';
                    res.on('data', (chunk: any) => data += chunk);
                    res.on('end', () => {
                        try {
                            // Try to parse basic JSON, or return text if not JSON
                            let json = null;
                            try { json = JSON.parse(data); } catch (e) { }

                            if (res.statusCode >= 400) {
                                reject(new Error(`API Error: ${res.statusCode} - ${json?.error?.message || data}`));
                            } else {
                                resolve(json || data);
                            }
                        } catch (e) {
                            reject(e);
                        }
                    });
                });
                req.on('error', (e: any) => reject(e));
                if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
                req.end();
            });
        }

        // Fallback to Obsidian requestUrl / fetch
        const response = await requestUrl({
            url: url,
            method: method,
            headers: headers,
            body: typeof body === 'string' ? body : JSON.stringify(body)
        });

        if (response.status >= 400) {
            throw new Error(`API Error: ${response.status} - ${response.text}`);
        }
        return response.json;
    }

    static async *streamRequest(url: string, method: 'POST' | 'GET', headers: any, body: any, signal?: AbortSignal): AsyncGenerator<string> {
        // Node.js Implementation (Desktop) - Bypasses CORS
        // @ts-ignore
        if (typeof require !== 'undefined' && typeof process !== 'undefined') {
            try {
                // @ts-ignore
                const http = require('http');
                // @ts-ignore
                const https = require('https');
                const { URL } = require('url');

                const parsedUrl = new URL(url);
                const options = {
                    hostname: parsedUrl.hostname,
                    port: parsedUrl.port,
                    path: parsedUrl.pathname + parsedUrl.search,
                    method: method,
                    headers: { ...headers, 'Accept-Encoding': 'identity' },
                    signal: signal
                };

                // Use a simple push-queue with notificaiton
                const queue: any[] = [];
                let notify: (() => void) | null = null;
                let ended = false;
                let error: any = null;

                const req = (parsedUrl.protocol === 'https:' ? https : http).request(options, (res: any) => {
                    console.log(`NetworkUtils: Response Status: ${res.statusCode} ${res.statusMessage} [${method} ${url}]`);

                    let hasError = res.statusCode >= 400;
                    let errorBody = "";

                    res.setEncoding('utf8');
                    res.on('data', (chunk: string) => {
                        if (hasError) {
                            errorBody += chunk;
                        } else {
                            queue.push(chunk);
                            if (notify) { notify(); notify = null; }
                        }
                    });
                    res.on('end', () => {
                        if (hasError) {
                            try {
                                const json = JSON.parse(errorBody);
                                const msg = json.error?.message || json.message || errorBody;
                                error = new Error(`API Error: ${res.statusCode} - ${msg}`);
                            } catch (e) {
                                error = new Error(`API Error: ${res.statusCode} - ${errorBody || res.statusMessage}`);
                            }
                        }
                        ended = true;
                        if (notify) { notify(); notify = null; }
                    });
                });

                req.on('error', (e: any) => {
                    console.error("NetworkUtils Stream Error", e);
                    error = e;
                    ended = true;
                    if (notify) { notify(); notify = null; }
                });

                if (body) {
                    const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
                    options.headers['Content-Length'] = Buffer.byteLength(bodyStr);
                    req.write(bodyStr);
                    console.log("NetworkUtils: Request Sent to", url);
                }
                req.end();

                // Async Generator Loop
                while (true) {
                    while (queue.length > 0) {
                        const c = queue.shift();
                        // console.log("NetworkUtils: Yielding Chunk", c.length);
                        yield c;
                    }
                    if (ended) {
                        if (error) {
                            console.error("NetworkUtils: Ended with Error", error);
                            throw error;
                        }
                        console.log("NetworkUtils: Ended cleanly.");
                        break;
                    }
                    // Wait for next event
                    await new Promise<void>(resolve => notify = resolve);
                }
                return;
            } catch (nodeError) {
                console.warn("Node.js streaming failed, trying fetch fallback...", nodeError);
            }
        }

        // Fetch Implementation
        const response = await fetch(url, {
            method: method,
            headers: headers,
            body: typeof body === 'string' ? body : JSON.stringify(body),
            signal: signal
        });

        if (!response.ok) {
            const text = await response.text();
            throw new Error(`API Error: ${response.status} - ${text}`);
        }
        if (!response.body) throw new Error("No response body");

        const reader = response.body.getReader();
        const decoder = new TextDecoder("utf-8");

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            yield decoder.decode(value, { stream: true });
        }
    }
}

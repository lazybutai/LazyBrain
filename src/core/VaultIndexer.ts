import { TFile, Vault, MetadataCache, Notice } from 'obsidian';
import { VectorStore } from './VectorStore';
import { LlmClient } from './LlmClient';

export class VaultIndexer {
    private vault: Vault;
    private metadataCache: MetadataCache;
    private vectorStore: VectorStore;
    private llmClient: LlmClient;
    private isIndexing: boolean = false;

    constructor(vault: Vault, metadataCache: MetadataCache, vectorStore: VectorStore, llmClient: LlmClient) {
        this.vault = vault;
        this.metadataCache = metadataCache;
        this.vectorStore = vectorStore;
        this.llmClient = llmClient;
    }

    async indexVault(onProgress?: (processed: number, total: number) => void) {
        if (this.isIndexing) return;
        this.isIndexing = true;
        // console.log("Starting Vault Indexing...");

        try {
            const files = this.vault.getMarkdownFiles();
            const total = files.length;
            let processed = 0;

            for (const file of files) {
                // Skip if not modified (TODO: Implement granular caching based on mtime)
                // For now, naive re-index or naive check
                await this.indexFile(file);

                processed++;
                if (onProgress) onProgress(processed, total);
            }

            await this.vectorStore.save();
            // console.log("Vault Indexing Complete.");
        } catch (e) {
            console.error("Indexing failed:", e);
        } finally {
            this.isIndexing = false;
        }
    }

    async indexFile(file: TFile) {
        // Smart Skip: Check mtime
        const lastModified = file.stat.mtime;
        const storedMtime = this.vectorStore.getMtime(file.path);

        if (storedMtime === lastModified) {
            // console.log(`Skipping unchanged file: ${file.path}`);
            return;
        }

        const content = await this.vault.read(file);
        const chunks = this.chunkText(content);

        const documentChunks = [];

        for (let i = 0; i < chunks.length; i++) {
            const chunkText = chunks[i];
            try {
                // Generate embedding
                const vector = await this.llmClient.createEmbedding(chunkText);

                documentChunks.push({
                    id: `${file.path}#${i}`,
                    text: chunkText,
                    vector: vector,
                    metadata: {
                        filePath: file.path,
                        startLine: 0,
                        endLine: 0,
                        mtime: lastModified // Store mtime
                    }
                });

                // Add a delay to prevent overloading
                await new Promise(resolve => setTimeout(resolve, 300));

            } catch (err: any) {
                console.warn(`Failed to embed chunk in ${file.path}:`, err);
                // Notify user if it's likely a model connection issue
                if (err.message && (err.message.includes("fetch failed") || err.message.includes("ECONNREFUSED"))) {
                    new Notice(`Indexing Failed: Local LLM likely offline.\nFile: ${file.basename}`);
                }
            }
        }

        if (documentChunks.length > 0) {
            // Overwrite old chunks
            this.vectorStore.addDocuments(documentChunks);
        }
    }

    async deleteFile(path: string) {
        this.vectorStore.deleteDocuments(path);
        await this.vectorStore.save();
    }

    async syncUpdates() {
        if (!this.llmClient.enableBackgroundIndexing) {
            // console.log("Smart Sync disabled by setting.");
            return;
        }
        console.log("Starting Smart Sync...");
        const files = this.vault.getMarkdownFiles();
        let updatedCount = 0;
        for (const file of files) {
            const lastModified = file.stat.mtime;
            const storedMtime = this.vectorStore.getMtime(file.path);
            if (storedMtime !== lastModified) {
                await this.indexFile(file);
                updatedCount++;
            }
        }
        if (updatedCount > 0) {
            await this.vectorStore.save();
            console.log(`Smart Sync: Updated ${updatedCount} files.`);
        } else {
            console.log("Smart Sync: Vault is up to date.");
        }
    }

    async indexText(content: string, virtualPath: string) {
        // Same logic as indexFile but for raw text (Virtual I/O)
        const chunks = this.chunkText(content);
        const documentChunks = [];

        for (let i = 0; i < chunks.length; i++) {
            const chunkText = chunks[i];
            try {
                const vector = await this.llmClient.createEmbedding(chunkText);
                documentChunks.push({
                    id: `${virtualPath}#${i}`,
                    text: chunkText,
                    vector: vector,
                    metadata: {
                        filePath: virtualPath, // Virtual path acts as the filter key
                        startLine: 0,
                        endLine: 0
                    }
                });
                // Small delay not needed for single text usually, but safe to keep if batching
            } catch (err) {
                console.warn(`Failed to embed virtual chunk ${virtualPath}:`, err);
            }
        }

        if (documentChunks.length > 0) {
            this.vectorStore.addDocuments(documentChunks);
        }
    }

    private chunkText(text: string, maxLength: number = 1000, overlap: number = 100): string[] {
        // Simple paragraph/newline splitter for now
        // TODO: Smarter sentence-boundary splitting
        const chunks: string[] = [];
        let currentChunk = "";

        const paragraphs = text.split('\n\n');

        for (const para of paragraphs) {
            if ((currentChunk.length + para.length) > maxLength) {
                chunks.push(currentChunk);
                currentChunk = para; // handling overlap roughly would go here
            } else {
                currentChunk += (currentChunk ? '\n\n' : '') + para;
            }
        }
        if (currentChunk) chunks.push(currentChunk);

        return chunks;
    }
}

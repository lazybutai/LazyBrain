import { normalizePath } from "obsidian";

interface DocumentChunk {
    id: string; // File path + chunk index
    text: string;
    vector: number[];
    metadata: {
        filePath: string;
        startLine?: number;
        endLine?: number;
        mtime?: number; // New: Modified Timestamp
    };
}

export class VectorStore {
    private chunks: DocumentChunk[] = [];
    private dbPath: string;
    private adapter: any; // Obsidian FileSystemAdapter

    constructor(adapter: any, dbPath: string = '.obsidian/plugins/local-llm-interface/vector_store.json') {
        this.adapter = adapter;
        this.dbPath = dbPath;
    }

    async load() {
        if (await this.adapter.exists(this.dbPath)) {
            const content = await this.adapter.read(this.dbPath);
            try {
                this.chunks = JSON.parse(content);
                console.log(`VectorStore loaded ${this.chunks.length} chunks.`);
            } catch (e) {
                console.error("Failed to load VectorStore:", e);
                this.chunks = [];
            }
        } else {
            console.log("VectorStore not found, starting fresh.");
        }
    }

    async save() {
        // Ensure directory exists
        const dir = this.dbPath.substring(0, this.dbPath.lastIndexOf('/'));
        if (!(await this.adapter.exists(dir))) {
            await this.adapter.mkdir(dir);
        }
        await this.adapter.write(this.dbPath, JSON.stringify(this.chunks));
    }

    addDocuments(newChunks: DocumentChunk[]) {
        // Remove existing chunks for the same files (naive update)
        const newFilePaths = new Set(newChunks.map(c => c.metadata.filePath));
        this.chunks = this.chunks.filter(c => !newFilePaths.has(c.metadata.filePath));

        this.chunks.push(...newChunks);
    }

    deleteDocuments(filePath: string) {
        // Remove all chunks associated with this file path
        const initialCount = this.chunks.length;
        this.chunks = this.chunks.filter(c => c.metadata.filePath !== filePath);
        if (this.chunks.length !== initialCount) {
            console.log(`VectorStore: Deleted chunks for ${filePath}`);
        }
    }

    getMtime(filePath: string): number {
        // Find any chunk from this file and return its mtime
        // Assuming all chunks from same file have same mtime
        const chunk = this.chunks.find(c => c.metadata.filePath === filePath);
        return chunk && chunk.metadata.mtime ? chunk.metadata.mtime : 0;
    }

    search(queryVector: number[], limit: number = 5, filterPath?: string): DocumentChunk[] {
        if (this.chunks.length === 0) return [];

        const similarities: { chunk: DocumentChunk; score: number }[] = [];

        for (const chunk of this.chunks) {
            // Filter by Path (Project Context)
            if (filterPath && !chunk.metadata.filePath.startsWith(filterPath)) {
                continue;
            }

            const score = this.cosineSimilarity(queryVector, chunk.vector);
            similarities.push({ chunk, score });
        }

        similarities.sort((a, b) => b.score - a.score);
        return similarities.slice(0, limit).map((s) => s.chunk);
    }

    private cosineSimilarity(vecA: number[], vecB: number[]): number {
        let dotProduct = 0;
        let normA = 0;
        let normB = 0;
        for (let i = 0; i < vecA.length; i++) {
            dotProduct += vecA[i] * vecB[i];
            normA += vecA[i] * vecA[i];
            normB += vecB[i] * vecB[i];
        }
        return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
    }
}

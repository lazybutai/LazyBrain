import { TFile, Vault, TFolder } from 'obsidian';
// @ts-ignore
const pdfParse = require('pdf-parse');

export class FileLoader {
    constructor(private vault: Vault) { }

    /**
     * Reads an image file and returns valid Base64 string with mime type
     * e.g. "data:image/png;base64,..."
     */
    async readImage(file: TFile): Promise<string> {
        const resourcePath = this.vault.getResourcePath(file);
        // The resource path in Obsidian looks like: "app://local/path/to/file.png?12345"
        // But for internal API usage sending to LLM, we need the actual base64 data.
        // We can use vault.readBinary to get formatting.

        const arrayBuffer = await this.vault.readBinary(file);
        const base64 = this.arrayBufferToBase64(arrayBuffer);
        const mimeType = this.getMimeType(file.extension);

        return `data:${mimeType};base64,${base64}`;
    }

    /**
     * Extracts text from PDF using pdf-parse.
     */
    async readPdf(file: TFile): Promise<string> {
        try {
            const arrayBuffer = await this.vault.readBinary(file);
            return this.readPdfBuffer(arrayBuffer, file.name);
        } catch (e) {
            console.error("Failed to parse PDF", e);
            return `[Error parsing PDF: ${file.name}]`;
        }
    }

    async readPdfBuffer(arrayBuffer: ArrayBuffer, name: string = "document.pdf"): Promise<string> {
        try {
            const buffer = Buffer.from(arrayBuffer);
            const data = await pdfParse(buffer);
            return `[PDF Content: ${name}]\n${data.text}\n[End of PDF ${name}]`;
        } catch (e) {
            console.error("Failed to parse PDF Buffer", e);
            return `[Error parsing PDF: ${name}]`;
        }
    }

    async resolvePath(path: string): Promise<TFile | null> {
        const file = this.vault.getAbstractFileByPath(path);
        if (file instanceof TFile) return file;
        return null; // or handle folders
    }

    private arrayBufferToBase64(buffer: ArrayBuffer): string {
        let binary = '';
        const bytes = new Uint8Array(buffer);
        const len = bytes.byteLength;
        for (let i = 0; i < len; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return window.btoa(binary);
    }

    private getMimeType(extension: string): string {
        switch (extension.toLowerCase()) {
            case 'png': return 'image/png';
            case 'jpg':
            case 'jpeg': return 'image/jpeg';
            case 'gif': return 'image/gif';
            case 'webp': return 'image/webp';
            case 'pdf': return 'application/pdf';
            default: return 'application/octet-stream';
        }
    }
}

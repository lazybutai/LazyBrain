import { App, ButtonComponent } from 'obsidian';

export class ReviewWidget {
    containerEl: HTMLElement;
    buttonsEl: HTMLElement;
    statusEl: HTMLElement;
    onAccept: () => void;
    onReject: () => void;

    constructor(app: App, onAccept: () => void, onReject: () => void) {
        this.onAccept = onAccept;
        this.onReject = onReject;

        // Create Container
        this.containerEl = document.createElement('div');
        this.containerEl.addClass('ai-review-widget');
        this.containerEl.style.position = 'absolute';
        this.containerEl.style.bottom = '20px';
        this.containerEl.style.left = '50%';
        this.containerEl.style.transform = 'translateX(-50%)';
        this.containerEl.style.zIndex = '9999';
        this.containerEl.style.backgroundColor = 'var(--background-primary)';
        this.containerEl.style.border = '1px solid var(--background-modifier-border)';
        this.containerEl.style.borderRadius = '8px';
        this.containerEl.style.padding = '8px 12px';
        this.containerEl.style.boxShadow = '0 4px 12px rgba(0,0,0,0.3)';
        this.containerEl.style.display = 'flex';
        this.containerEl.style.alignItems = 'center';
        this.containerEl.style.gap = '10px';
        this.containerEl.style.minWidth = '200px';

        // Status Text
        this.statusEl = this.containerEl.createSpan({ text: 'AI is writing...' });
        this.statusEl.style.fontSize = '0.9em';
        this.statusEl.style.color = 'var(--text-muted)';
        this.statusEl.style.flex = '1';

        // Buttons Container
        this.buttonsEl = this.containerEl.createDiv();
        this.buttonsEl.style.display = 'flex';
        this.buttonsEl.style.gap = '8px';

        // Reject/Undo Button
        new ButtonComponent(this.buttonsEl)
            .setButtonText("Undo")
            .onClick(() => {
                this.close();
                this.onReject();
            });

        // Accept Button
        new ButtonComponent(this.buttonsEl)
            .setButtonText("Accept")
            .setCta()
            .onClick(() => {
                this.close();
                this.onAccept();
            });

        // Append to body (floating)
        document.body.appendChild(this.containerEl);
    }

    updateStatus(text: string) {
        this.statusEl.setText(text);
    }

    close() {
        if (this.containerEl && this.containerEl.parentNode) {
            this.containerEl.parentNode.removeChild(this.containerEl);
        }
    }
}

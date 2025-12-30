import { App, Modal, Setting } from "obsidian";

export class ConfirmationModal extends Modal {
    private title: string;
    private message: string;
    private onConfirm: () => void;
    private confirmLabel: string;

    constructor(app: App, title: string, message: string, onConfirm: () => void, confirmLabel = "Delete") {
        super(app);
        this.title = title;
        this.message = message;
        this.onConfirm = onConfirm;
        this.confirmLabel = confirmLabel;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();

        contentEl.createEl("h2", { text: this.title });
        contentEl.createEl("p", { text: this.message });

        const buttonContainer = contentEl.createDiv();
        buttonContainer.style.marginTop = "20px";
        buttonContainer.style.display = "flex";
        buttonContainer.style.justifyContent = "flex-end";
        buttonContainer.style.gap = "10px";

        new Setting(buttonContainer)
            .addButton((btn) =>
                btn
                    .setButtonText("Cancel")
                    .onClick(() => {
                        this.close();
                    })
            )
            .addButton((btn) =>
                btn
                    .setButtonText(this.confirmLabel)
                    .setCta()
                    .setWarning()
                    .onClick(() => {
                        this.onConfirm();
                        this.close();
                    })
            );
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}

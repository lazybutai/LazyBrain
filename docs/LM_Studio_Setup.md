# Setting up LM Studio for LazyBrain 🧪

LM Studio provides a friendly UI to discover, download, and run local LLMs with an OpenAI-compatible server.

## Installation

1.  **Download**: Visit [lmstudio.ai](https://lmstudio.ai/) and click **Download LM Studio**.
2.  **Install**: Run the installer.

## Getting a Model

1.  Open LM Studio.
2.  Click the **Search** (magnifying glass) icon on the left.
3.  Search for a model (e.g., `Llama 3`, `Gemma`, `Mistral`).
4.  Click **Download** on a quantization level that fits your RAM (usually `Q4_K_M` is a good balance).

## Starting the Server (Crucial Step)

LazyBrain talks to LM Studio via its Local Server feature.

1.  Click the **Local Server** (double arrow explicitly `<->`) icon on the left sidebar.
2.  **Select a Model**: Choose your downloaded model from the top dropdown.
3.  **Server Settings**:
    *   **Port**: Default is `1234`.
    *   **CORS**: Ensure "Enable CORS (Cross-Origin Resource Sharing)" is **CHECKED** (ON). This is required for Obsidian to talk to it.
4.  Click **Start Server**.

## Configuring LazyBrain

1.  In Obsidian, go to **Settings > LazyBrain**.
2.  **Model URL**: Set to `http://localhost:1234/v1`.
3.  **API Key**: You can leave this as `lm-studio` (it's not validated locally).
4.  **Chat Model**: The name usually auto-detects, or you can use `local-model` if LM Studio has one loaded.

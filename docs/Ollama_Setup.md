# Setting up Ollama for LazyBrain 🦙

Ollama is a lightweight, easy-to-use tool for running open-source LLMs locally.

## Installation

1.  **Download**: Visit [ollama.com](https://ollama.com/) and download the installer for your OS (Windows, macOS, or Linux).
2.  **Install**: Run the installer. It will set up the Ollama background service.
3.  **Verify**: Open your terminal (Command Prompt or PowerShell) and run:
    ```bash
    ollama --version
    ```

## Downloading a Model

LazyBrain works best with models like `llama3` or `mistral`. To pull a model:

1.  Open your terminal.
2.  Run the pull command:
    ```bash
    ollama pull llama3
    ```
3.  Wait for the download to finish.

## Configuring LazyBrain

1.  In Obsidian, go to **Settings > LazyBrain**.
2.  **Model URL**: Set to `http://localhost:11434/v1` (Ollama's default API port).
3.  **Chat Model**: Type the name of the model you downloaded (e.g., `llama3`).
4.  **Embedding Model**: You can use `nomic-embed-text` (pull it via `ollama pull nomic-embed-text`) or leave it as default.

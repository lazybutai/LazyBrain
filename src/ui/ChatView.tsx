const SYSTEM_PROMPT_WEB_SEARCH = `
You have access to a live web search tool.
- You should use the 'brave_web_search' tool to find real-time information.
- If the first search is insufficient, perform additional searches with different queries to gather comprehensive information.
- Always cite your sources with links if available.
`;
import { ItemView, WorkspaceLeaf, Platform, setIcon, MarkdownRenderer, Notice, TFile } from "obsidian";
import * as React from "react";
import * as ReactDOM from "react-dom/client";
import LocalLLMPlugin, { Conversation, Project, MessageNode } from "../../main";
import { Message } from "../core/LlmClient";
import { IModelProvider, ModelInfo } from "../core/llm/IModelProvider";
import { McpClient } from "../core/McpClient";
import { FileLoader } from "../core/FileLoader";
import { FileSuggestModal } from "./modals/FileSuggestModal";
import { ConfirmationModal } from "./modals/ConfirmationModal";

export const VIEW_TYPE_CHAT = "local-llm-chat-view";


const ObsidianIcon = ({ name, className }: { name: string; className?: string }) => {
    const ref = React.useRef<HTMLSpanElement>(null);
    React.useEffect(() => {
        if (ref.current) setIcon(ref.current, name);
    }, [name]);
    return <span ref={ref} className={className} />;
};

const MarkdownMessage: React.FC<{
    content: string;
    plugin: LocalLLMPlugin;
    role: string;
    attachments?: { file: string, content: string }[];
    images?: string[]; // New prop for images
    contextSources?: string[]; // New prop for RAG
    showSources?: boolean;
    onRemoveAttachment?: (filename: string) => void;
}> = ({ content, plugin, role, attachments, images, contextSources, showSources, onRemoveAttachment }) => {
    const containerRef = React.useRef<HTMLDivElement>(null);

    // RAG Source Renderer
    const renderSources = () => {
        try {
            // Default to true if undefined
            const shouldShow = showSources !== false;
            if (!contextSources || contextSources.length === 0 || !shouldShow) return null;

            return (
                <div className="rag-sources" style={{
                    fontSize: '0.70em',
                    color: 'var(--text-muted)',
                    marginBottom: '8px',
                    padding: '4px 8px',
                    background: 'rgba(var(--mono-rgb-100), 0.05)',
                    borderRadius: '4px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    flexWrap: 'wrap'
                }}>
                    <ObsidianIcon name="book" className="svg-icon-xm" />
                    <span style={{ fontWeight: 'bold' }}>Used Context:</span>
                    {contextSources.map((source, i) => {
                        // Extract basename only
                        const name = source.split('/').pop()?.replace('.md', '') || source;
                        // ... rest of map
                        // Moved map content to avoid clutter in diff
                        return (
                            <span key={i} className="context-chip" style={{
                                textDecoration: 'underline',
                                cursor: 'pointer',
                                color: 'var(--text-accent)'
                            }} onClick={() => plugin.app.workspace.openLinkText(source, "", true)}>
                                {name}
                            </span>
                        );
                    })}
                </div>
            );
        } catch (e) {
            console.error("Error rendering sources:", e);
            return null;
        }
    };


    React.useEffect(() => {
        if (!containerRef.current) return;
        containerRef.current.empty();

        // Render basic markdown first
        MarkdownRenderer.render(plugin.app, content || "", containerRef.current, "/", plugin)
            .then(() => {
                if (!containerRef.current) return;

                // DOM Post-processing to replace @[filename] with interactive chips
                const walker = document.createTreeWalker(containerRef.current, NodeFilter.SHOW_TEXT);
                const nodesToReplace: { node: Text, matches: RegExpExecArray[] }[] = [];
                const regex = /@\[(.*?)\]/g;

                let node: Node | null;
                while ((node = walker.nextNode())) {
                    const text = node.textContent || "";
                    let match;
                    const matches: RegExpExecArray[] = [];
                    // We must create a new regex or reset lastIndex to ensure correct looping
                    const localRegex = new RegExp(regex);
                    while ((match = localRegex.exec(text)) !== null) {
                        matches.push(match);
                    }
                    if (matches.length > 0) {
                        nodesToReplace.push({ node: node as Text, matches });
                    }
                }

                nodesToReplace.forEach(({ node, matches }) => {
                    const fragment = document.createDocumentFragment();
                    let lastIndex = 0;
                    const text = node.textContent || "";

                    matches.forEach(match => {
                        // Text before
                        if (match.index > lastIndex) {
                            fragment.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
                        }

                        // The Link Component
                        const filename = match[1];
                        const span = document.createElement("span");
                        span.className = "attachment-link";
                        span.title = "Open Note";
                        span.innerHTML = `<span class="attachment-text">${filename}</span>`;

                        // Click to Open
                        span.onclick = (e) => {
                            // e.stopPropagation(); // Allow bubbling so text selection works? No, it's a link.
                            if ((e.target as HTMLElement).closest('.attachment-delete')) return; // handled by delete btn
                            plugin.app.workspace.openLinkText(filename, "", true);
                        };

                        // Delete Button (Only if callback provided)
                        if (onRemoveAttachment) {
                            const del = document.createElement("span");
                            del.className = "attachment-delete";
                            del.textContent = "×"; // or SVG
                            del.title = "Remove attachment";
                            del.onclick = (e) => {
                                e.stopPropagation();
                                onRemoveAttachment(filename);
                            };
                            span.appendChild(del);
                        }

                        fragment.appendChild(span);
                        lastIndex = match.index + match[0].length;
                    });

                    // Text after
                    if (lastIndex < text.length) {
                        fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
                    }

                    node.parentNode?.replaceChild(fragment, node);
                });

                // Render Images if present
                if (images && images.length > 0) {
                    const imgContainer = document.createElement('div');
                    imgContainer.style.display = 'flex';
                    imgContainer.style.flexWrap = 'wrap';
                    imgContainer.style.gap = '8px';
                    imgContainer.style.marginTop = '8px';

                    images.forEach(imgData => {
                        const img = document.createElement('img');
                        img.src = imgData;
                        img.style.maxWidth = '200px';
                        img.style.maxHeight = '200px';
                        img.style.borderRadius = '8px';
                        img.style.cursor = 'pointer';
                        img.onclick = () => {
                            // Simple lightbox or open in new window could act here
                            // For now, just basic view
                        };
                        imgContainer.appendChild(img);
                    });
                    containerRef.current.appendChild(imgContainer);
                }
            })
            .catch((err) => {
                console.error("Markdown render error:", err);
                if (containerRef.current) containerRef.current.innerText = content;
            });
    }, [content, plugin, attachments, images, onRemoveAttachment]);

    return (
        <div className={`message - content ${role === 'user' ? 'user-content' : 'markdown-rendered'} `} ref={containerRef}>
            {role === 'assistant' && renderSources()}
        </div>
    );
};

const MetricsBar = ({ speed, contextUsed, contextLimit }: { speed: number; contextUsed: number; contextLimit: number }) => {
    return (
        <div className="metrics-bar" style={{ fontSize: '0.8em', color: 'var(--text-muted)', padding: '5px 15px', borderTop: '1px solid var(--background-modifier-border)', display: 'flex', justifyContent: 'space-between' }}>
            <span>Speed: {speed > 0 ? `${speed.toFixed(1)} t / s` : '--'}</span>
            <span>Context: {contextUsed} / {contextLimit} tokens</span>
        </div>
    );
};

const getThread = (chat: Conversation): MessageNode[] => {
    if (!chat.messageMap || !chat.currentLeafId) return [];
    const thread: MessageNode[] = [];
    let current: MessageNode | undefined = chat.messageMap[chat.currentLeafId];
    while (current) {
        thread.unshift(current);
        current = current.parentId ? chat.messageMap[current.parentId] : undefined;
    }
    return thread;
};

interface ChatProps {
    plugin: LocalLLMPlugin;
}

const ChatComponent: React.FC<ChatProps> = ({ plugin }) => {
    const newChatBtnRef = React.useRef<HTMLButtonElement>(null);
    const sendBtnRef = React.useRef<HTMLButtonElement>(null);
    const inputRef = React.useRef<HTMLDivElement>(null); // Changed to HTMLDivElement
    const toggleSidebarRef = React.useRef<HTMLButtonElement>(null);
    const abortControllerRef = React.useRef<AbortController | null>(null);
    const mcpClientRef = React.useRef<McpClient | null>(null);

    const [conversations, setConversations] = React.useState<Conversation[]>([]);
    const [projects, setProjects] = React.useState<Project[]>([]);
    const [activeId, setActiveId] = React.useState<string | null>(null);
    const [activeProjectId, setActiveProjectId] = React.useState<string | null>(null);
    const [isCreatingProject, setIsCreatingProject] = React.useState(false);
    const [isWebSearchEnabled, setIsWebSearchEnabled] = React.useState(false);
    const [newProjectName, setNewProjectName] = React.useState("");
    const [newProjectPath, setNewProjectPath] = React.useState("");
    const [editingProjectId, setEditingProjectId] = React.useState<string | null>(null);
    const [editProjectName, setEditProjectName] = React.useState("");
    const [isLoading, setIsLoading] = React.useState(false);
    const [loadingMessage, setLoadingMessage] = React.useState("");
    const [isSidebarCollapsed, setIsSidebarCollapsed] = React.useState(false);
    const [metrics, setMetrics] = React.useState({ speed: 0, contextUsed: 0, contextLimit: 4096 });
    const [editingId, setEditingId] = React.useState<string | null>(null);
    const [editTitle, setEditTitle] = React.useState("");
    const [forkingNodeId, setForkingNodeId] = React.useState<string | null>(null);
    const messagesEndRef = React.useRef<HTMLDivElement>(null);

    // Settings Reactivity
    const [settingsTick, setSettingsTick] = React.useState(0);
    React.useEffect(() => {
        plugin.onSettingsUpdate(() => {
            setSettingsTick(t => t + 1);
        });
    }, []);

    // Model Selection State
    const [availableModels, setAvailableModels] = React.useState<{ id: string, name: string, providerId: string, capabilities?: { vision?: boolean, tools?: boolean, reasoning?: boolean } }[]>([]);
    const [selectedModelId, setSelectedModelId] = React.useState<string>("local");
    const selectedModelIdRef = React.useRef(selectedModelId); // REF for Stale Closure Fix
    const [showModelSelector, setShowModelSelector] = React.useState(false);
    const modelSelectorRef = React.useRef<HTMLDivElement>(null);

    // Keep Ref in sync
    React.useEffect(() => {
        selectedModelIdRef.current = selectedModelId;
    }, [selectedModelId]);

    const handleRefresh = async () => {
        setLoadingMessage("Refreshing...");
        setIsLoading(true);
        try {
            await plugin.indexer.syncUpdates(); // Force index sync
            const models = await plugin.llmClient.listModels();
            setAvailableModels(models);
            if (models.length > 0 && String(selectedModelId) === 'local') {
                // Check if local is still valid or pick first
                const hasLocal = models.some(m => m.providerId === 'local');
                if (!hasLocal) setSelectedModelId(models[0].id);
            }
            new Notice("Refresh Complete: Models & Vault Index synced.");
        } catch (e: any) {
            new Notice("Refresh Failed: " + e.message);
        } finally {
            setIsLoading(false);
        }
    };

    React.useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (modelSelectorRef.current && !modelSelectorRef.current.contains(event.target as Node)) {
                setShowModelSelector(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    React.useEffect(() => {
        const fetchModels = async () => {
            try {
                const models = await plugin.llmClient.listModels();
                console.log("LocalLLM: Fetched models:", models);
                setAvailableModels(models);
                if (models.length > 0 && selectedModelId === 'local') {
                    const hasLocal = models.some(m => m.providerId === 'local');
                    if (!hasLocal) setSelectedModelId(models[0].id);
                } else if (models.length === 0) {
                    console.warn("LocalLLM: No models found.");
                    new Notice("Local LLM: No models detected. Check provider settings.");
                }
            } catch (e: any) {
                console.error("LocalLLM: Failed to list models", e);
                new Notice("Local LLM Error: Failed to list models. " + e.message);
            }
        };
        fetchModels();
    }, [plugin.settings]); // Re-fetch if settings change

    const filteredConversations = React.useMemo(() => {
        return conversations.filter(c => {
            if (activeProjectId) return c.projectId === activeProjectId;
            return c.projectId === undefined || c.projectId === null;
        });
    }, [conversations, activeProjectId]);

    const activeConversation = conversations.find(c => c.id === activeId);

    React.useEffect(() => {
        // This useEffect causing Infinite Loop?
        // NO, we removed it.
        // We will calculate contextUsed during Render (Derived State)
    }, []);

    // Derived Metrics
    const contextUsedDerived = React.useMemo(() => {
        if (!activeConversation) return 0;
        const thread = getThread(activeConversation);
        const totalChars = thread.reduce((acc, msg) => acc + (msg.content || "").length, 0);
        return Math.ceil(totalChars / 4);
    }, [activeConversation]);
    // ^ This is much safer. It only updates when activeConversation object changes (which happens on stream update)
    // BUT we don't call setMetrics, so no loop.

    React.useEffect(() => {
        const history = plugin.settings.history || [];
        const loadedProjects = plugin.settings.projects || [];
        setConversations(history);
        setProjects(loadedProjects);
    }, []);

    React.useEffect(() => {
        const btn = sendBtnRef.current;
        const input = inputRef.current;
        const sendHandler = (e: MouseEvent) => { e.stopPropagation(); handleSend(); };
        const keyHandler = (e: KeyboardEvent) => {
            if (plugin.settings.enterToSend) {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
            } else {
                if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); handleSend(); }
            }
        };
        if (btn) btn.addEventListener('click', sendHandler);
        if (input) input.addEventListener('keydown', keyHandler);
        return () => {
            if (btn) btn.removeEventListener('click', sendHandler);
            if (input) input.removeEventListener('keydown', keyHandler);
        };
    }, [activeId, isLoading, conversations, plugin.settings.enterToSend]);

    const activeProject = projects.find(p => p.id === activeProjectId);

    const createNewChat = () => {
        const newChat: Conversation = {
            id: Date.now().toString(),
            title: "New Chat",
            timestamp: Date.now(),
            projectId: activeProjectId || undefined,
            messageMap: {},
            currentLeafId: undefined,
            messages: undefined
        };
        setConversations(prev => {
            const updated = [newChat, ...prev];
            plugin.settings.history = updated;
            plugin.saveSettings();
            return updated;
        });
        setActiveId(newChat.id);
    };

    const handleCreateProjectSave = () => {
        if (!newProjectName) { new Notice("Project name is required."); return; }
        const path = newProjectPath || "Projects/" + newProjectName;
        const newProject: Project = { id: Date.now().toString(), name: newProjectName, folderPath: path };
        setProjects(prev => {
            const updated = [...prev, newProject];
            plugin.settings.projects = updated;
            plugin.saveSettings();
            return updated;
        });
        setActiveProjectId(newProject.id);
        setIsCreatingProject(false);
        setNewProjectName("");
        setNewProjectPath("");
        setActiveId(null);
    };

    const startEditingProject = (e: React.MouseEvent, p: Project) => {
        e.stopPropagation();
        setEditingProjectId(p.id);
        setEditProjectName(p.name);
    };

    const saveProjectName = () => {
        if (!editingProjectId) return;
        if (!editProjectName.trim()) { setEditingProjectId(null); return; }
        setProjects(prev => {
            const updated = prev.map(p => p.id === editingProjectId ? { ...p, name: editProjectName.trim() } : p);
            plugin.settings.projects = updated;
            plugin.saveSettings();
            return updated;
        });
        setEditingProjectId(null);
    };

    const handleDeleteProject = (projectId: string) => {
        const doDelete = () => {
            setProjects(prev => {
                const updated = prev.filter(p => p.id !== projectId);
                plugin.settings.projects = updated;
                plugin.saveSettings();
                return updated;
            });
            setConversations(prev => {
                const updated = prev.map(c => c.projectId === projectId ? { ...c, projectId: undefined } : c);
                plugin.settings.history = updated;
                plugin.saveSettings();
                return updated;
            });
            if (activeProjectId === projectId) setActiveProjectId(null);
        };
        new ConfirmationModal(plugin.app, "Delete Project?", "Are you sure you want to delete this project?", doDelete).open();
    };

    const navigateBranch = (chatId: string, nodeId: string, direction: 'prev' | 'next') => {
        setConversations(prev => {
            return prev.map(c => {
                if (c.id === chatId && c.messageMap) {
                    const node = c.messageMap[nodeId];
                    if (!node || !node.parentId) return c;
                    const parent = c.messageMap[node.parentId];
                    if (!parent) return c;
                    const currentIndex = parent.childrenIds.indexOf(node.id);
                    if (currentIndex === -1) return c;
                    let newIndex = direction === 'prev' ? currentIndex - 1 : currentIndex + 1;
                    if (newIndex < 0) newIndex = 0;
                    if (newIndex >= parent.childrenIds.length) newIndex = parent.childrenIds.length - 1;
                    const siblingId = parent.childrenIds[newIndex];
                    let tipId = siblingId;
                    let tipNode = c.messageMap[tipId];
                    while (tipNode && tipNode.childrenIds.length > 0) {
                        tipId = tipNode.childrenIds[tipNode.childrenIds.length - 1];
                        tipNode = c.messageMap[tipId];
                    }
                    return { ...c, currentLeafId: tipId };
                }
                return c;
            });
        });
    };

    const handleFork = async (chatId: string, parentNodeId: string, text: string) => {
        if (!text) return;
        setForkingNodeId(null);
        const newNodeId = `${chatId} -${Date.now()} -u - fork`;
        const newUserNode: MessageNode = {
            id: newNodeId, role: 'user', content: text, parentId: parentNodeId, childrenIds: [], createdAt: Date.now()
        };
        setConversations(prev => {
            const updated = prev.map(c => {
                if (c.id === chatId && c.messageMap) {
                    const newMap = { ...c.messageMap, [newNodeId]: newUserNode };
                    const parent = newMap[parentNodeId!];
                    if (parent) { newMap[parent.id] = { ...parent, childrenIds: [...parent.childrenIds, newNodeId] }; }
                    return { ...c, messageMap: newMap, currentLeafId: newNodeId };
                }
                return c;
            });
            plugin.settings.history = updated;
            plugin.saveSettings();
            return updated;
        });
        setTimeout(() => triggerAiResponse(chatId), 50);
    };

    const handleRegenerate = async (chatId: string, aiNodeId: string) => {
        const chat = conversations.find(c => c.id === chatId);
        if (!chat || !chat.messageMap) return;
        const aiNode = chat.messageMap[aiNodeId];
        if (!aiNode || !aiNode.parentId) return;
        setConversations(prev => {
            const updated = prev.map(c => {
                if (c.id === chatId) return { ...c, currentLeafId: aiNode.parentId! };
                return c;
            });
            plugin.settings.history = updated;
            plugin.saveSettings();
            return updated;
        });
        setTimeout(() => triggerAiResponse(chatId), 50);
    };

    const handleStopGeneration = () => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
            abortControllerRef.current = null;
            setIsLoading(false);
            setLoadingMessage("");
            new Notice("Generation Stopped");
        }
    };

    const handleRemoveAttachment = (chatId: string, nodeId: string, filename: string) => {
        setConversations(prev => {
            return prev.map(c => {
                if (c.id === chatId && c.messageMap && c.messageMap[nodeId]) {
                    const node = c.messageMap[nodeId];
                    // Remove from content
                    // Escape filename for regex
                    const escapedName = filename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    const regex = new RegExp(`@\\[${escapedName}\\]`, 'g');
                    const newContent = (node.content || "").replace(regex, "").trim(); // Trim might be risky if it's in middle of sentence, but usually attachments have spaces around

                    // Remove from attachments array
                    const newAttachments = (node.attachments || []).filter(a => {
                        // Check rough match on path or basename
                        return !a.file.endsWith(filename) && a.file !== filename;
                    });

                    const newNode = { ...node, content: newContent, attachments: newAttachments };
                    const newMap = { ...c.messageMap, [nodeId]: newNode };
                    return { ...c, messageMap: newMap };
                }
                return c;
            })
        });
    };

    const [pendingFiles, setPendingFiles] = React.useState<{ file: TFile | null, preview?: string, name?: string }[]>([]);
    const pendingFilesRef = React.useRef(pendingFiles);
    React.useEffect(() => { pendingFilesRef.current = pendingFiles; }, [pendingFiles]);

    const fileLoaderRef = React.useRef<any>(null); // To avoid circular dependency init in render if possible, or just use plugin.loader if we move it there.
    // Better to instantiate in effect or assume plugin has it. Let's lazily create or use a helper.
    // Ideally plugin should have it. For now, local instance.

    const handleDrop = async (e: React.DragEvent) => {
        e.preventDefault();
        const files = e.dataTransfer.files;
        // These are DOM File objects, not TFiles. 
        // Obsidian Drag & Drop usually gives us standard files if from OS, 
        // or we might get internal Transfer format.

        // If dropped from Obsidian File Explorer, we can get TFiles via metadata?
        // Simpler: Just rely on OS drag for now/external files?
        // Wait, requirements say "embedded documents like pdfs... inside the notes". 
        // But drag and drop "into the chat" implies external files or internal files.
        // Let's support internal TFiles if possible via text/uri-list or standard behavior?

        // Actually, Obsidian `app.dragManager` handles internal drags.
        // For external files, we accept them. 
        // BUT strict constraint: "You are not allowed to access files not in active workspaces" -> "Code relating to the user's requests should be written in the locations listed above."
        // Wait, the USER can drop a file. We need to handle it.
        // If it's an external file dropped, we probably can't read it easily without uploading to vault?
        // Standard Obsidian workflow: Drop -> Uploads to Vault (Attachment folder).
        // Let's implement that: Drop -> Save to Vault -> Attach as TFile.

        // However, for this iteration, let's look for "Internal" drops first (from File Explorer).
        // If we just want to support "Attach Note", we already have that.
        // The user asked for "drag/drop images".

        const droppedItems = e.dataTransfer.items;
        if (droppedItems) {
            for (let i = 0; i < droppedItems.length; i++) {
                const item = droppedItems[i];
                if (item.kind === 'file') {
                    const file = item.getAsFile();
                    if (file) {
                        // We need to save this file to the vault to use TFile logic consistently
                        // Or we can read it directly here?
                        // "allow you to drag & drop images into the chat"

                        // Strategy: Read content as Base64 immediately for Chat use.
                        // But for prompts we defined `images ?: string[]`.
                        const reader = new FileReader();
                        reader.onload = (ev) => {
                            const base64 = ev.target?.result as string;
                            // We mimic TFile structure or just store raw?
                            // Let's store a "PendingAttachment" object
                            setPendingFiles(prev => [...prev, {
                                file: null as any, // No TFile yet 
                                preview: base64,
                                name: file.name
                            } as any]);
                        };
                        reader.readAsDataURL(file);
                    }
                }
            }
        }
    };

    const handlePaste = (e: React.ClipboardEvent) => {
        // Check for files (images)
        if (e.clipboardData.files && e.clipboardData.files.length > 0) {
            e.preventDefault();
            const files = e.clipboardData.files;
            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                if (file.type.startsWith('image/')) {
                    const reader = new FileReader();
                    reader.onload = (ev) => {
                        const base64 = ev.target?.result as string;
                        setPendingFiles(prev => [...prev, {
                            file: null as any,
                            preview: base64,
                            name: file.name
                        } as any]);
                    };
                    reader.readAsDataURL(file);
                }
            }
            return;
        }

        // Check for text (Strip HTML/Styling)
        // Prevent default paste which might include HTML nested UI
        e.preventDefault();
        const text = e.clipboardData.getData('text/plain');
        document.execCommand("insertText", false, text);
    };

    const handleAttachFile = () => {
        new FileSuggestModal(plugin.app, async (file: TFile) => {
            // Check extension
            const ext = file.extension.toLowerCase();
            if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) {
                // It's an image. Add to pending graphics.
                const loader = new FileLoader(plugin.app.vault);
                const base64 = await loader.readImage(file);
                setPendingFiles(prev => [...prev, { file, preview: base64 }]);
            } else if (ext === 'pdf') {
                setPendingFiles(prev => [...prev, { file, preview: undefined }]); // No preview for PDF yet
            } else {
                // Standard MD Link behavior
                insertLinkToEditor(file);
            }
        }).open();
    };

    const insertLinkToEditor = (file: TFile) => {
        if (inputRef.current) {
            inputRef.current.focus();
            // ... existing logic ...
            const span = document.createElement("span");
            span.contentEditable = "false";
            span.className = "attachment-link";
            span.dataset.file = file.path;
            span.dataset.basename = file.basename;
            span.innerHTML = `<span class="attachment-text">${file.basename}</span>`;
            span.onclick = (e) => { e.stopPropagation(); plugin.app.workspace.openLinkText(file.path, "", true); };

            inputRef.current.appendChild(span);
            inputRef.current.appendChild(document.createTextNode("\u00A0"));
        }
    };

    // ... handleSend (updated below) ...

    const handleSend = async () => {
        if (!inputRef.current || !activeId || isLoading) return;

        // PARSE CONTENT FROM DIV
        // We need to convert the chips back to @[filename] and get text
        let text = "";
        inputRef.current.childNodes.forEach(node => {
            if (node.nodeType === Node.TEXT_NODE) {
                text += node.textContent;
            } else if (node.nodeType === Node.ELEMENT_NODE) {
                const el = node as HTMLElement;
                if (el.classList.contains('attachment-link')) {
                    // Reconstruct tag
                    text += ` @[${el.dataset.basename}]`;
                } else {
                    text += el.innerText; // Fallback for other pasted html?
                }
            }
        });

        text = text.trim();
        if (!text) return;

        setIsLoading(true);
        inputRef.current.innerHTML = ""; // Clear editor


        // PARSE ATTACHMENTS FROM TEXT
        const attachments: { file: string, content: string }[] = [];
        const attachmentRegex = /@\[(.*?)\]/g;
        let match;

        // Resolve files
        while ((match = attachmentRegex.exec(text)) !== null) {
            const filename = match[1];
            const file = plugin.app.metadataCache.getFirstLinkpathDest(filename, "") ||
                plugin.app.vault.getFiles().find(f => f.basename === filename);

            if (file instanceof TFile) {
                try {
                    const content = await plugin.app.vault.read(file);
                    attachments.push({ file: file.path, content });
                } catch (e) {
                    console.error("Failed to read attached file", file.path, e);
                }
            }
        }

        const currentChat = conversations.find(c => c.id === activeId);
        if (!currentChat) {
            setIsLoading(false);
            return;
        }

        // PREPARE IMAGES & PDFS FROM PENDING FILES
        const messageImages: string[] = [];
        const loader = new FileLoader(plugin.app.vault);

        // Use REF to avoid stale closure
        const currentPendingFiles = pendingFilesRef.current;
        console.log("handleSend: Processing pending files from Ref, count:", currentPendingFiles.length);

        for (const pf of currentPendingFiles) {
            const ext = pf.file ? pf.file.extension.toLowerCase() : "";
            if (ext === 'pdf' && pf.file) {
                const pdfText = await loader.readPdf(pf.file);
                text += `\n\n${pdfText} \n\n`;
            } else if (pf.preview?.startsWith('data:image')) {
                messageImages.push(pf.preview);
                console.log("handleSend: Added Image", pf.preview.substring(0, 50));
            } else {
                console.warn("handleSend: skipped file", pf);
            }
        }
        console.log("handleSend: messageImages count", messageImages.length);

        const newNodeId = `${activeId} -${Date.now()} -u`;
        const parentId = currentChat.currentLeafId || null;
        const newUserNode: MessageNode = {
            id: newNodeId,
            role: 'user',
            content: text,
            parentId: parentId,
            childrenIds: [],
            createdAt: Date.now(),
            attachments: attachments,
            images: messageImages.length > 0 ? messageImages : undefined
        };

        // Clear Pending Files
        setPendingFiles([]);

        setConversations(prev => {
            const updated = prev.map(c => {
                if (c.id === activeId) {
                    const map = c.messageMap || {};
                    const newMap = { ...map, [newNodeId]: newUserNode };
                    if (parentId && newMap[parentId]) {
                        newMap[parentId] = { ...newMap[parentId], childrenIds: [...newMap[parentId].childrenIds, newNodeId] };
                    }
                    let title = c.title;
                    if (!c.currentLeafId && text.length > 0) title = text.slice(0, 30);
                    return { ...c, messageMap: newMap, currentLeafId: newNodeId, title, timestamp: Date.now() };
                }
                return c;
            });
            plugin.settings.history = updated;
            plugin.saveSettings();
            return updated;
        });

        // Use REF for Model ID to avoid stale closure
        setTimeout(() => triggerAiResponse(activeId, selectedModelIdRef.current), 50);
    };

    const triggerAiResponse = async (chatId: string, modelIdOverride?: string) => {
        setIsLoading(true);
        setMetrics(prev => ({ ...prev, speed: 0 }));
        setLoadingMessage("Thinking...");
        if (abortControllerRef.current) abortControllerRef.current.abort();
        abortControllerRef.current = new AbortController();
        const signal = abortControllerRef.current.signal;
        const startTime = Date.now();
        let tokenCount = 0;

        try {
            const freshChat = plugin.settings.history.find(c => c.id === chatId);
            if (!freshChat) return;
            const thread = getThread(freshChat);
            const userMsgNode = thread[thread.length - 1];
            let text = userMsgNode.content || "";

            let contextString = "";
            let usedSources: string[] = []; // Track sources

            try {
                const queryVector = await plugin.llmClient.createEmbedding(text);
                // console.log("[RAG Debug] Embedding received. Length:", queryVector.length);
                const filterPath = activeProject ? activeProject.folderPath : undefined;
                // @ts-ignore
                const relevantChunks = plugin.vectorStore.search(queryVector, plugin.settings.maxContextChunks || 3, filterPath);
                console.log("[RAG Debug] Search complete. Chunks found:", relevantChunks.length);
                if (relevantChunks.length > 0) {
                    contextString = relevantChunks.map((c: any) => `[File: ${c.metadata.filePath}]\n${c.text} `).join('\n\n');
                    // Deduplicate sources
                    usedSources = [...new Set(relevantChunks.map((c: any) => c.metadata.filePath))];
                    // console.log("[RAG Debug] Used Sources:", usedSources);
                }
            } catch (err) { console.error("[RAG Debug] Search failed", err); }


            // Construct Messages
            const messagesToSend: Message[] = thread.map(n => {
                let content = n.content || "";
                const msgImages: string[] = [];

                // INJECT ATTACHMENTS FOR AI (Invisible to User)
                if (n.attachments && n.attachments.length > 0) {
                    // Check if attachments are images or text?
                    // Currently n.attachments are text/PDF content.
                    // The NEW pendingFiles are separate.
                    // Wait, we need to decide where to store images in history.
                    // MessageNode needs 'images' field too!
                    const attachmentText = n.attachments.map(a => `\n\n[USER ATTACHED NOTE: ${a.file}]\n${a.content} \n[END ATTACHMENT]`).join("");
                    content += attachmentText;
                }

                // If this node has images (from new feature), add them
                if (n.images && n.images.length > 0) {
                    msgImages.push(...n.images);
                }

                // If it's a tool call message, content might be null/empty, keep it as is
                if (n.role === 'tool' || n.tool_calls) return { role: n.role, content: content, tool_calls: n.tool_calls, tool_call_id: n.tool_call_id } as Message;

                // Return message with images if present
                const msg: Message = { role: n.role, content: content };
                if (msgImages.length > 0) msg.images = msgImages;
                return msg;
            });

            // CRITICAL FIX: Inject RAG Context into System Prompt
            if (contextString) {
                // Find existing system prompt or prepend a new one
                const systemMessageIndex = messagesToSend.findIndex(m => m.role === 'system');
                const contextIntro = `\n\n[CONTEXT FROM USER VAULT]\nThe following information is retrieved from the user's notes. Use it to answer the question if relevant.\n\n${contextString}\n\n[END CONTEXT]\n`;

                if (systemMessageIndex !== -1) {
                    messagesToSend[systemMessageIndex].content += contextIntro;
                } else {
                    messagesToSend.unshift({ role: 'system', content: plugin.settings.systemPrompt + contextIntro });
                }
            } else if (messagesToSend.length > 0 && messagesToSend[0].role !== 'system') {
                // Ensure system prompt is always present
                messagesToSend.unshift({ role: 'system', content: plugin.settings.systemPrompt });
            }

            // INJECT WEB SEARCH PROMPT
            if (isWebSearchEnabled) {
                const systemMessageIndex = messagesToSend.findIndex(m => m.role === 'system');
                if (systemMessageIndex !== -1) {
                    messagesToSend[systemMessageIndex].content += SYSTEM_PROMPT_WEB_SEARCH;
                } else {
                    // Should have been created above, but safety check
                    messagesToSend.unshift({ role: 'system', content: plugin.settings.systemPrompt + SYSTEM_PROMPT_WEB_SEARCH });
                }
            }

            // TOOL USE SETUP
            let tools: any[] = [];
            if (isWebSearchEnabled) {
                if (!plugin.settings.braveApiKey) {
                    new Notice("Web Search Failed: Missing Brave API Key in Settings.");
                    setIsWebSearchEnabled(false);
                } else {
                    if (!mcpClientRef.current) {
                        mcpClientRef.current = new McpClient(plugin.settings.braveApiKey);
                        setLoadingMessage("Initializing Web Search...");
                    }

                    if (mcpClientRef.current) {
                        try {
                            setLoadingMessage("Fetching Tools...");
                            const mcpTools = await mcpClientRef.current.listTools();
                            if (mcpTools.length === 0) {
                                new Notice("Web Search: No tools found. Is the server running?");
                            } else {
                                console.log("Web Search Tools Loaded:", mcpTools.length);
                            }
                            tools = mcpTools.map(t => ({
                                type: "function",
                                function: {
                                    name: t.name,
                                    description: t.description,
                                    parameters: t.inputSchema
                                }
                            }));
                        } catch (e: any) {
                            console.error("Failed to list tools", e);
                            new Notice(`Web Search Error: ${e.message}`, 5000);
                        }
                    }
                }
            }

            let finalResponseText = "";
            let keepLooping = true;
            let loops = 0;
            const MAX_LOOPS = 5;

            while (keepLooping && loops < MAX_LOOPS) {
                loops++;
                if (tools.length > 0) {
                    setLoadingMessage(`Thinking (Step ${loops})...`);
                    let fullMsg;
                    try {
                        fullMsg = await plugin.llmClient.chatCompletionFull({
                            messages: messagesToSend,
                            model: modelIdOverride || selectedModelId,
                            tools: tools,
                            tool_choice: "auto"
                        });
                    } catch (e: any) {
                        console.error("LocalLLM: Tool/Chat Error", e);
                        new Notice(`AI Error: ${e.message}`);
                        throw e;
                    }

                    let toolCallFound = null;

                    // 1. Check Native Tool Calls
                    if (fullMsg.tool_calls && fullMsg.tool_calls.length > 0) {
                        toolCallFound = fullMsg.tool_calls[0];
                    }
                    // 2. Check Fallback JSON in Content (for Local Models)
                    else if (fullMsg.content && (fullMsg.content.includes('tool_uses') || fullMsg.content.includes('"recipient_name"'))) {
                        try {
                            // Attempt to extract JSON object
                            const jsonMatch = fullMsg.content.match(/\{[\s\S]*"tool_uses"[\s\S]*\}/);
                            if (jsonMatch) {
                                const jsonFn = JSON.parse(jsonMatch[0]);
                                if (jsonFn.tool_uses && jsonFn.tool_uses.length > 0) {
                                    const use = jsonFn.tool_uses[0];
                                    // Map to OpenAI format
                                    toolCallFound = {
                                        id: "call_" + Date.now(),
                                        function: {
                                            name: use.recipient_name.replace('functions.', ''),
                                            arguments: JSON.stringify(use.parameters)
                                        }
                                    };
                                    // If we found it in content, we treats content as null so we don't double print
                                    fullMsg.content = "";
                                }
                            }
                        } catch (e) {
                            console.log("Failed to parse fallback tool JSON", e);
                        }
                    }

                    if (toolCallFound) {
                        // Handle Tool Call
                        const fnName = toolCallFound.function.name;
                        const fnArgs = JSON.parse(toolCallFound.function.arguments);

                        setLoadingMessage(`Searching: ${fnArgs.query || JSON.stringify(fnArgs)}...`);

                        // Execute
                        let toolResult = "Error";
                        if (mcpClientRef.current) {
                            try {
                                const result = await mcpClientRef.current.callTool(fnName, fnArgs);
                                toolResult = JSON.stringify(result);
                            } catch (e: any) {
                                toolResult = "Error: " + e.message;
                            }
                        }

                        // Append Assistant Message with Tool Call
                        messagesToSend.push({
                            role: "assistant",
                            content: null,
                            tool_calls: [toolCallFound]
                        });

                        // Append Tool Result
                        messagesToSend.push({
                            role: "tool",
                            content: toolResult,
                            tool_call_id: toolCallFound.id
                        });

                        // Loop continues...
                    } else {
                        // No tool calls, just content.
                        finalResponseText = fullMsg.content;
                        keepLooping = false;
                    }
                } else {
                    // No tools enabled, just stream.
                    keepLooping = false;
                }

                if (!keepLooping) {
                    const aiNodeId = `${chatId}-${Date.now()}-a`;
                    const aiNode: MessageNode = {
                        id: aiNodeId,
                        role: 'assistant',
                        content: finalResponseText || "",
                        parentId: userMsgNode.id,
                        childrenIds: [],
                        createdAt: Date.now(),
                        contextSources: usedSources.length > 0 ? usedSources : undefined
                    };

                    setConversations(prev => {
                        const updated = prev.map(c => {
                            if (c.id === chatId && c.messageMap) {
                                const newMap = { ...c.messageMap, [aiNodeId]: aiNode };
                                const parent = newMap[userMsgNode.id];
                                if (parent) { newMap[userMsgNode.id] = { ...parent, childrenIds: [...parent.childrenIds, aiNodeId] }; }
                                return { ...c, messageMap: newMap, currentLeafId: aiNodeId };
                            }
                            return c;
                        });
                        // FIX: Persist initial empty node immediately so updateAiInfo can find it later
                        plugin.settings.history = updated;
                        plugin.saveSettings();
                        return updated;
                    });

                    if (finalResponseText) {
                        await updateAiInfo(chatId, aiNodeId, finalResponseText);
                    } else {
                        console.log(`LocalLLM: Starting stream with ${modelIdOverride || selectedModelId}`);
                        try {
                            let stream = plugin.llmClient.streamChatCompletion({
                                messages: messagesToSend,
                                model: modelIdOverride || selectedModelId,
                                signal
                            });
                            let streamedText = "";
                            for await (const chunk of stream) {
                                if (signal.aborted) break;
                                streamedText += chunk;
                                const newTokens = Math.ceil(chunk.length / 4);
                                tokenCount += (newTokens < 1 ? 1 : newTokens);
                                const elapsedSec = (Date.now() - startTime) / 1000;
                                setMetrics(prev => ({ ...prev, speed: elapsedSec > 0 ? (tokenCount / elapsedSec) : 0 }));

                                setConversations(prev => {
                                    return prev.map(c => {
                                        if (c.id === chatId && c.messageMap) {
                                            const node = c.messageMap[aiNodeId];
                                            if (node) {
                                                const newNode = { ...node, content: streamedText };
                                                const newMap = { ...c.messageMap, [aiNodeId]: newNode };
                                                return { ...c, messageMap: newMap };
                                            }
                                        }
                                        return c;
                                    });
                                });
                            }
                            finalResponseText = streamedText;
                            await updateAiInfo(chatId, aiNodeId, streamedText);
                        } catch (streamErr: any) {
                            console.error("LocalLLM: Streaming error", streamErr);
                            new Notice(`Stream Error: ${streamErr.message}`);
                            // Keep partial text
                            finalResponseText = finalResponseText || "Error.";

                            // Append error to UI
                            setConversations(prev => {
                                return prev.map(c => {
                                    if (c.id === chatId && c.messageMap) {
                                        const node = c.messageMap[aiNodeId];
                                        if (node) {
                                            const ERR_MSG = `\n\n> [!ERROR] Stream Failed\n> ${streamErr.message}`;
                                            const newNode = { ...node, content: (node.content || "") + ERR_MSG };
                                            return { ...c, messageMap: { ...c.messageMap, [aiNodeId]: newNode } };
                                        }
                                    }
                                    return c;
                                });
                            });
                        }
                    }
                }

            }

            if (activeProject && !signal.aborted && finalResponseText) {
                const memoryContent = `Context(Chat Memory): \nUser: ${text} \nAI: ${finalResponseText}`;
                const virtualPath = `${activeProject.folderPath}/.memory/${chatId}/${Date.now()}.md`;
                plugin.indexer.indexText(memoryContent, virtualPath).then(() => { plugin.vectorStore.save(); });
            }

        } catch (error: any) {
            if (error.name === 'AbortError') { console.log("Generation aborted by user."); }
            else { console.error(error); new Notice("AI Error: " + error.message); }
        } finally {
            setIsLoading(false); setLoadingMessage(""); abortControllerRef.current = null;
        }
    };

    const updateAiInfo = async (chatId: string, nodeId: string, text: string) => {
        plugin.settings.history = plugin.settings.history.map(c => {
            if (c.id === chatId && c.messageMap) {
                const node = c.messageMap[nodeId];
                if (node) {
                    const newNode = { ...node, content: text };
                    const newMap = { ...c.messageMap, [nodeId]: newNode };
                    return { ...c, messageMap: newMap };
                }
            }
            return c;
        });
        await plugin.saveSettings();
    };

    // Scroll Management
    const chatContainerRef = React.useRef<HTMLDivElement>(null);
    const [isUserScrolledUp, setIsUserScrolledUp] = React.useState(false);

    // Auto-scroll effect
    React.useEffect(() => {
        if (!isUserScrolledUp && chatContainerRef.current) {
            chatContainerRef.current.scrollTo({ top: chatContainerRef.current.scrollHeight, behavior: 'smooth' });
        }
    }, [conversations, activeId, isLoading, isUserScrolledUp]);

    const handleScroll = () => {
        if (chatContainerRef.current) {
            const { scrollTop, scrollHeight, clientHeight } = chatContainerRef.current;
            // logic: if distance from bottom > 50px, user is scrolled up
            const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
            const isUp = distanceFromBottom > 50;
            if (isUp !== isUserScrolledUp) {
                setIsUserScrolledUp(isUp);
            }
        }
    };

    const scrollToBottom = () => {
        if (chatContainerRef.current) {
            chatContainerRef.current.scrollTo({ top: chatContainerRef.current.scrollHeight, behavior: 'smooth' });
            setIsUserScrolledUp(false);
        }
    };

    const startEditing = (e: React.MouseEvent, chat: Conversation) => { e.stopPropagation(); setEditingId(chat.id); setEditTitle(chat.title); };
    const saveTitle = () => {
        if (editingId) {
            setConversations(prev => {
                const updated = prev.map(c => c.id === editingId ? { ...c, title: editTitle } : c);
                plugin.settings.history = updated;
                plugin.saveSettings();
                return updated;
            });
            setEditingId(null);
        }
    };
    const copyToClipboard = (text: string) => { navigator.clipboard.writeText(text); new Notice("Copied!"); };
    const createNoteFromMessage = async (content: string) => {
        const filename = `AI Note - ${new Date().toISOString().replace(/[:.]/g, '-')}.md`;
        try { const file = await plugin.app.vault.create(filename, content); plugin.app.workspace.getLeaf().openFile(file); } catch (e) { console.error("Failed", e); }
    };

    const handleSaveChatToNote = async (chat?: Conversation) => {
        const targetChat = chat || activeConversation;
        if (!targetChat) return;

        const thread = getThread(targetChat);
        if (!thread || thread.length === 0) return;

        const title = targetChat.title || "Chat Export";
        // Sanitize filename
        const filename = title.replace(/[\\/:*?"<>|]/g, '-').trim();
        const project = projects.find(p => p.id === targetChat.projectId);
        const baseFolder = project ? project.folderPath : "";

        let content = `# ${title}\n\n`;
        content += `**Date:** ${new Date().toLocaleString()}\n`;
        if (project) content += `**Project:** [[${project.name}]]\n`;
        content += `---\n\n`;

        thread.forEach(node => {
            if (node.role === 'system') return;
            const role = node.role === 'user' ? "User" : (node.model || "AI");
            content += `### ${role}\n${node.content}\n\n`;
        });

        const targetPath = baseFolder ? `${baseFolder}/${filename}.md` : `${filename}.md`;

        // Handle deduplication
        let finalPath = targetPath;
        let counter = 1;
        while (await plugin.app.vault.adapter.exists(finalPath)) {
            finalPath = baseFolder ? `${baseFolder}/${filename} (${counter}).md` : `${filename} (${counter}).md`;
            counter++;
        }

        try {
            const file = await plugin.app.vault.create(finalPath, content);
            new Notice(`Chat saved to ${finalPath}`);
            plugin.app.workspace.getLeaf(true).openFile(file);
        } catch (e) {
            new Notice("Failed to save chat note");
            console.error(e);
        }
    };



    const threadToRender = activeConversation ? getThread(activeConversation) : [];

    // Replace state Metrics with Derived + Speed state
    const currentContextUsed = contextUsedDerived;

    return (
        <div className={`local-llm-container ${isSidebarCollapsed ? 'sidebar-closed' : ''}`}>
            {/* Top Toggle */}
            <button className="sidebar-toggle sidebar-toggle-top" onClick={(e) => { e.stopPropagation(); setIsSidebarCollapsed(p => !p); }} title={isSidebarCollapsed ? "Expand Sidebar" : "Collapse Sidebar"}>
                {isSidebarCollapsed ? "»" : "«"}
            </button>
            {/* Bottom Toggle */}
            <button className="sidebar-toggle sidebar-toggle-bottom" onClick={(e) => { e.stopPropagation(); setIsSidebarCollapsed(p => !p); }} title={isSidebarCollapsed ? "Expand Sidebar" : "Collapse Sidebar"}>
                {isSidebarCollapsed ? "»" : "«"}
            </button>

            <div className={`llm-sidebar ${isSidebarCollapsed ? 'collapsed' : ''}`}>
                {/* 1. Top Action: New Chat */}
                <div className="sidebar-section" style={{ padding: '12px', borderBottom: '1px solid var(--background-modifier-border)' }}>
                    <button onClick={createNewChat} className="new-chat-btn" style={{ width: '100%', justifyContent: 'center' }}>
                        <ObsidianIcon name="plus" className="svg-icon-sm" /> New Chat
                    </button>
                </div>

                {/* 2. Workspaces List */}
                <div className="sidebar-section workspaces-list" style={{ padding: '0', borderBottom: '1px solid var(--background-modifier-border)', display: 'flex', flexDirection: 'column', gap: '0' }}>

                    {!isCreatingProject ? (
                        <>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 5px 5px 5px' }}>
                                <span style={{ fontSize: '0.75em', fontWeight: 'bold', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Workspaces</span>
                                <button className="icon-btn" onClick={() => setIsCreatingProject(true)} title="New Project"><ObsidianIcon name="plus" className="svg-icon-sm" /></button>
                            </div>

                            {/* Global Context */}
                            <div
                                className={`chat-item ${!activeProjectId ? 'active' : ''}`}
                                onClick={() => setActiveProjectId(null)}
                                title="Default global workspace"
                            >
                                <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <ObsidianIcon name="globe" className="svg-icon-sm" /> General Workspace
                                </span>
                            </div>

                            {/* Projects */}
                            {projects.map(p => (
                                <div
                                    key={p.id}
                                    className={`chat-item ${activeProjectId === p.id ? 'active' : ''}`}
                                    onClick={() => setActiveProjectId(p.id)}
                                    title={p.folderPath}
                                >
                                    {editingProjectId === p.id ? (
                                        <input
                                            value={editProjectName}
                                            onChange={(e) => setEditProjectName(e.target.value)}
                                            onClick={(e) => e.stopPropagation()}
                                            onBlur={saveProjectName}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter') saveProjectName();
                                                if (e.key === 'Escape') setEditingProjectId(null);
                                            }}
                                            autoFocus
                                            className="edit-chat-input"
                                        />
                                    ) : (
                                        <>
                                            <span style={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden', flex: 1 }}>
                                                <ObsidianIcon name="folder" className="svg-icon-sm" />
                                                <span className="chat-title">{p.name}</span>
                                            </span>
                                            <div style={{ display: 'flex' }}>
                                                <button
                                                    className="icon-btn project-delete-btn"
                                                    onClick={(e) => startEditingProject(e, p)}
                                                    title="Rename Project"
                                                    style={{ opacity: 0, transition: 'opacity 0.2s', padding: '2px' }}
                                                >
                                                    <ObsidianIcon name="pencil" className="svg-icon-sm" />
                                                </button>
                                                <button
                                                    className="icon-btn project-delete-btn"
                                                    onClick={(e) => { e.stopPropagation(); handleDeleteProject(p.id); }}
                                                    title="Delete Project"
                                                    style={{ opacity: 0, transition: 'opacity 0.2s', padding: '2px' }}
                                                >
                                                    <ObsidianIcon name="trash" className="svg-icon-sm" />
                                                </button>
                                            </div>
                                        </>
                                    )}
                                </div>
                            ))}
                        </>
                    ) : (
                        <div className="create-project-form" style={{ padding: '10px', background: 'var(--background-secondary-alt)', borderRadius: '6px' }}>
                            <h4 style={{ margin: '0 0 10px 0', fontSize: '0.9em' }}>New Project</h4>
                            <input type="text" placeholder="Project Name" value={newProjectName} onChange={(e) => setNewProjectName(e.target.value)} style={{ marginBottom: '8px', width: '100%' }} autoFocus />
                            <input type="text" placeholder="Path (e.g. Projects/Game)" value={newProjectPath} onChange={(e) => setNewProjectPath(e.target.value)} style={{ marginBottom: '10px', width: '100%' }} />
                            <div style={{ display: 'flex', gap: '5px' }}>
                                <button onClick={handleCreateProjectSave} className="mod-cta" style={{ flex: 1 }}>Save</button>
                                <button onClick={() => setIsCreatingProject(false)} style={{ flex: 1 }}>Cancel</button>
                            </div>
                        </div>
                    )}
                </div>

                <div className="chat-list">
                    {filteredConversations.length === 0 && <div style={{ padding: '10px', color: 'var(--text-muted)', textAlign: 'center' }}>No chats here yet.</div>}
                    {filteredConversations.map(chat => (
                        <div key={chat.id} className={`chat-item ${chat.id === activeId ? 'active' : ''}`} onClick={() => setActiveId(chat.id)} title={chat.title}>
                            {editingId === chat.id ? (
                                <input className="edit-chat-input" value={editTitle} onChange={(e) => setEditTitle(e.target.value)} onClick={(e) => e.stopPropagation()} onBlur={saveTitle} onKeyDown={(e) => { if (e.key === 'Enter') saveTitle(); if (e.key === 'Escape') setEditingId(null); }} autoFocus />
                            ) : (
                                <span className="chat-title" onDoubleClick={(e) => startEditing(e, chat)}>{chat.title}</span>
                            )}
                            {!editingId && (
                                <div className="chat-actions">
                                    <button className="icon-btn" onClick={(e) => { e.stopPropagation(); handleSaveChatToNote(chat); }} title="Save Chat to Note">
                                        <ObsidianIcon name="save" className="svg-icon-sm" />
                                    </button>
                                    <button className="icon-btn" onClick={(e) => startEditing(e, chat)}>
                                        <ObsidianIcon name="pencil" className="svg-icon-sm" />
                                    </button>
                                    <button className="icon-btn delete-btn" onClick={(e) => {
                                        e.stopPropagation();
                                        const doDelete = () => {
                                            setConversations(prev => {
                                                const updated = prev.filter(c => c.id !== chat.id);
                                                plugin.settings.history = updated;
                                                plugin.saveSettings();
                                                if (activeId === chat.id) setActiveId('default');
                                                return updated;
                                            });
                                        };
                                        new ConfirmationModal(plugin.app, "Delete Chat?", "Are you sure you want to delete this conversation?", doDelete).open();
                                    }}>    <ObsidianIcon name="trash" className="svg-icon-sm" />
                                    </button>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            </div>

            <div className="llm-main-area">
                {activeConversation ? (
                    <>
                        <div className="chat-header-bar" style={{ padding: '0 10px 5px 10px', fontSize: '0.85em', color: 'var(--text-muted)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span>{activeProject ? `Project: ${activeProject.name}` : 'Global Context'}</span>
                        </div>
                        <div
                            className="chat-messages"
                            ref={chatContainerRef}
                            onScroll={handleScroll}
                        >
                            {threadToRender.map((node) => {
                                const parent = node.parentId && activeConversation.messageMap ? activeConversation.messageMap[node.parentId] : null;
                                const childCout = parent ? parent.childrenIds.length : 1;
                                const myIndex = parent ? parent.childrenIds.indexOf(node.id) : 0;

                                // Hide empty AI bubbles while thinking
                                if (node.role === 'assistant' && !node.content && !node.tool_calls && isLoading) return null;

                                return (
                                    <div key={node.id} className={`chat-message ${node.role}`}>
                                        <div className="message-bubble">
                                            <MarkdownMessage
                                                content={node.content || (node.tool_calls ? "(Running Tools...)" : "")}
                                                plugin={plugin}
                                                role={node.role}
                                                attachments={node.attachments}
                                                images={node.images}
                                                contextSources={node.contextSources}
                                                showSources={plugin.settings.showSourcesInChat ?? false}
                                                onRemoveAttachment={node.role === 'user' ? (file) => handleRemoveAttachment(activeId || "", node.id, file) : undefined}
                                            />
                                        </div>

                                        <div className="message-meta-row">
                                            {childCout > 1 && (
                                                <div className="branch-nav">
                                                    <button className="icon-btn" onClick={(e) => { e.preventDefault(); e.stopPropagation(); navigateBranch(activeConversation.id, node.id, 'prev'); }} disabled={myIndex === 0}>{'<'}</button>
                                                    <span className="branch-counter">{myIndex + 1}/{childCout}</span>
                                                    <button className="icon-btn" onClick={(e) => { e.preventDefault(); e.stopPropagation(); navigateBranch(activeConversation.id, node.id, 'next'); }} disabled={myIndex === childCout - 1}>{'>'}</button>
                                                </div>
                                            )}
                                            <div className="message-actions-row">
                                                <button className="msg-action-btn" onClick={() => copyToClipboard(node.content || "")} title="Copy"><ObsidianIcon name="copy" className="svg-icon-sm" /></button>
                                                <button className="msg-action-btn" onClick={() => createNoteFromMessage(node.content || "")} title="New Note"><ObsidianIcon name="file-plus" className="svg-icon-sm" /></button>
                                                {node.role === 'user' && !forkingNodeId && (
                                                    <button className="msg-action-btn" onClick={() => { if (node.parentId) setForkingNodeId(node.id); }} title="Branch / Edit"><ObsidianIcon name="git-branch" className="svg-icon-sm" /></button>
                                                )}
                                                {node.role === 'assistant' && (
                                                    <button className="msg-action-btn" onClick={() => handleRegenerate(activeConversation.id, node.id)} title="Regenerate"><ObsidianIcon name="refresh-cw" className="svg-icon-sm" /></button>
                                                )}
                                            </div>
                                        </div>

                                        {forkingNodeId === node.id && (
                                            <div className="fork-input" style={{ margin: '10px 0', padding: '5px', borderLeft: '2px solid var(--interactive-accent)' }}>
                                                <textarea id={`fork-input-${node.id}`} placeholder="Type new path..." rows={2} style={{ width: '100%' }}
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleFork(activeConversation.id, node.parentId || "", (e.target as HTMLTextAreaElement).value); }
                                                    }}
                                                />
                                                <button onClick={() => setForkingNodeId(null)}>Cancel</button>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                            {isLoading && (
                                <div className="loading-indicator" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                    <span>{loadingMessage || "Thinking..."} {metrics.speed > 0 && `(${metrics.speed.toFixed(1)} t/s)`}</span>
                                    <button className="stop-btn" onClick={handleStopGeneration} title="Stop Generation">
                                        <ObsidianIcon name="square" className="svg-icon-sm" />
                                    </button>
                                </div>
                            )}

                            {/* Refresh Button (Top Right Absolute or Fixed?) - Actually let's put it in the header */}
                            <div ref={messagesEndRef} />
                        </div>

                        {/* Floating Scroll Button */}
                        {isUserScrolledUp && (
                            <button
                                onClick={scrollToBottom}
                                style={{
                                    position: 'absolute',
                                    bottom: '140px',
                                    left: '50%',
                                    transform: 'translateX(-50%)',
                                    zIndex: 20,
                                    width: '32px',
                                    height: '32px',
                                    borderRadius: '50%',
                                    background: 'var(--background-primary)',
                                    border: '1px solid var(--background-modifier-border)',
                                    color: 'var(--text-muted)',
                                    boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    transition: 'all 0.2s',
                                    opacity: 0.8
                                }}
                                className="scroll-bottom-btn"
                                title="Scroll to Bottom"
                                onMouseEnter={(e) => {
                                    e.currentTarget.style.color = 'var(--text-normal)';
                                    e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
                                    e.currentTarget.style.opacity = '1';
                                    e.currentTarget.style.borderColor = 'var(--interactive-accent)';
                                }}
                                onMouseLeave={(e) => {
                                    e.currentTarget.style.color = 'var(--text-muted)';
                                    e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.1)';
                                    e.currentTarget.style.opacity = '0.8';
                                    e.currentTarget.style.borderColor = 'var(--background-modifier-border)';
                                }}
                            >
                                <ObsidianIcon name="arrow-down" className="svg-icon-sm" />
                            </button>
                        )}

                        <div className="chat-input-area" onDrop={handleDrop} onDragOver={e => e.preventDefault()}>



                            <div className="chat-input-unified-container">
                                {pendingFiles.length > 0 && (
                                    <div className="pending-files-bar" style={{ display: 'flex', gap: '8px', padding: '0 0 8px 0', overflowX: 'auto', marginBottom: '4px' }}>
                                        {pendingFiles.map((pf, idx) => (
                                            <div key={idx} className="pending-file-chip" style={{
                                                position: 'relative',
                                                display: 'flex',
                                                flexDirection: 'column',
                                                alignItems: 'center',
                                                background: 'var(--background-secondary-alt)',
                                                padding: '4px',
                                                borderRadius: '4px',
                                                minWidth: '60px',
                                                border: '1px solid var(--background-modifier-border)'
                                            }}>
                                                {pf.preview ? (
                                                    <img src={pf.preview} style={{ width: '40px', height: '40px', objectFit: 'cover', borderRadius: '4px' }} />
                                                ) : (
                                                    <div style={{ width: '40px', height: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--background-modifier-border)', borderRadius: '4px' }}>
                                                        <ObsidianIcon name="file" className="file-icon" />
                                                    </div>
                                                )}
                                                <span style={{ fontSize: '0.7em', maxWidth: '60px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: '4px' }}>
                                                    {pf.file?.name || pf.name || "File"}
                                                </span>
                                                <div
                                                    className="remove-file-btn"
                                                    onClick={() => setPendingFiles(prev => prev.filter((_, i) => i !== idx))}
                                                    style={{
                                                        position: 'absolute', top: '-6px', right: '-6px',
                                                        background: 'var(--text-error)', color: 'white',
                                                        borderRadius: '50%', width: '16px', height: '16px',
                                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                        cursor: 'pointer', fontSize: '12px', fontWeight: 'bold',
                                                        boxShadow: '0 1px 2px rgba(0,0,0,0.2)'
                                                    }}
                                                >
                                                    ×
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                                <div className="chat-input-editor-wrapper">
                                    <div
                                        ref={inputRef}
                                        className="chat-input-editor"
                                        contentEditable={true}
                                        onPaste={handlePaste}
                                        data-placeholder={plugin.settings.enterToSend ? "Send a message..." : "Send a message..."}
                                        onInput={(e) => {
                                            const sel = window.getSelection();
                                            // Check for @ trigger
                                            if (sel && sel.rangeCount > 0 && sel.anchorNode?.nodeType === Node.TEXT_NODE) {
                                                const text = sel.anchorNode.textContent || "";
                                                // Check if last char typed is @
                                                // Warning: this simple check might misfire if moving cursor. 
                                                // Better: check if char before cursor is @
                                                if (text.endsWith('@') || text.endsWith(' @')) {
                                                    handleAttachFile();
                                                }
                                            }
                                        }}
                                        onKeyDown={(e) => {
                                            // Handle Enter behavior in ContentEditable
                                            if (e.key === 'Enter') {
                                                if (plugin.settings.enterToSend && !e.shiftKey) {
                                                    e.preventDefault();
                                                    handleSend();
                                                } else if (!plugin.settings.enterToSend && e.ctrlKey) {
                                                    e.preventDefault();
                                                    handleSend();
                                                }
                                            }
                                        }}
                                    />
                                    {plugin.settings.showContextMetrics && (
                                        <div className="input-metrics">
                                            <span>{currentContextUsed} / {plugin.settings.contextWindow || 4096} tokens</span>
                                            {metrics.speed > 0 && <span>{metrics.speed.toFixed(1)} t/s</span>}
                                        </div>
                                    )}
                                </div>
                                <div className="chat-input-footer">
                                    <div className="footer-left">
                                        <button className="icon-btn tool-btn" onClick={handleAttachFile} title="Attach Note (@)">
                                            <ObsidianIcon name="paperclip" className="svg-icon-sm" />
                                        </button>
                                        <button className={`icon-btn tool-btn ${isWebSearchEnabled ? 'is-active' : ''}`} onClick={() => setIsWebSearchEnabled(!isWebSearchEnabled)} title={isWebSearchEnabled ? "Web Search ON" : "Web Search OFF"}>
                                            <ObsidianIcon name="globe" className="svg-icon-sm" />
                                        </button>
                                    </div>

                                    <div className="footer-right">
                                        <div className="model-selector-container" ref={modelSelectorRef}>
                                            <button
                                                className="model-selector-trigger-minimal"
                                                onClick={() => setShowModelSelector(!showModelSelector)}
                                                title="Select Model"
                                            >
                                                <div className="model-icon"><ObsidianIcon name="cpu" className="svg-icon-xs" /></div>
                                                <span className="model-name">
                                                    {availableModels.find(m => m.id === selectedModelIdRef.current)?.name || "Select Model"}
                                                </span>
                                                <div className="model-chevron"><ObsidianIcon name="chevron-up" className="svg-icon-xs" /></div>
                                            </button>

                                            {showModelSelector && (
                                                <div className="model-selector-dropdown-menu">
                                                    <div className="model-selector-header">Model</div>
                                                    <div className="model-list">

                                                        {availableModels.map(m => (
                                                            <div
                                                                key={m.id}
                                                                className={`model-option ${selectedModelId === m.id ? 'selected' : ''}`}
                                                                onClick={() => {
                                                                    setSelectedModelId(m.id);
                                                                    setShowModelSelector(false);
                                                                    plugin.llmClient.preloadModel(m.id);
                                                                }}
                                                            >
                                                                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.name}</span>
                                                                <div style={{ display: 'flex', gap: '4px', opacity: 0.6 }}>
                                                                    {m.capabilities?.vision && <ObsidianIcon name="eye" className="svg-icon-xs" />}
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                        </div>

                                        <button className="icon-btn refresh-btn" onClick={handleRefresh} title="Refresh Context & Models">
                                            <ObsidianIcon name="refresh-cw" className="svg-icon-sm" />
                                        </button>

                                        <button ref={sendBtnRef} disabled={isLoading} className="send-btn-arrow" title="Send">
                                            <ObsidianIcon name="arrow-right" className="svg-icon-sm" />
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </>
                ) : (
                    <div className="no-chat-selected">
                        <h2>{activeProject ? activeProject.name : "LazyBrain"}</h2>
                        <p>{activeProject ? `Scope: ${activeProject.folderPath}` : "Select a chat or project to begin."}</p>
                    </div>
                )}
            </div>
        </div >
    );
};

export class ChatView extends ItemView {
    plugin: LocalLLMPlugin;
    root: ReactDOM.Root | null = null;
    constructor(leaf: WorkspaceLeaf, plugin: LocalLLMPlugin) { super(leaf); this.plugin = plugin; }
    getViewType() { return VIEW_TYPE_CHAT; }
    getDisplayText() { return "LazyBrain Chat"; }
    getIcon() { return "message-square"; }
    async onOpen() {
        const container = this.contentEl; container.empty();
        const wrapper = container.createDiv("local-llm-wrapper");
        wrapper.style.height = "100%"; wrapper.style.width = "100%";
        this.root = ReactDOM.createRoot(wrapper);
        this.root.render(<ChatComponent plugin={this.plugin} />);
    }
    async onClose() { this.root?.unmount(); }
}

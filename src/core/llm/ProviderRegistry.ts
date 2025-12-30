import { IModelProvider } from './IModelProvider';

export class ProviderRegistry {
    private providers: Map<string, IModelProvider> = new Map();
    private activeProviderId: string | null = null;
    private activeModelId: string | null = null;

    register(provider: IModelProvider) {
        this.providers.set(provider.id, provider);
    }

    get(id: string): IModelProvider | undefined {
        return this.providers.get(id);
    }

    getAll(): IModelProvider[] {
        return Array.from(this.providers.values());
    }

    setActiveProvider(providerId: string) {
        if (this.providers.has(providerId)) {
            this.activeProviderId = providerId;
        }
    }

    getActiveProvider(): IModelProvider | undefined {
        if (this.activeProviderId) return this.providers.get(this.activeProviderId);
        return undefined;
    }
}

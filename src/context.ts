import type { ExtensionContext } from 'vscode';

let extensionContext: ExtensionContext | undefined;

export function setExtensionContext(context: ExtensionContext): void {
    extensionContext = context;
}

export function getExtensionContext(): ExtensionContext {
    if (!extensionContext) {
        throw new Error('Extension context not initialized');
    }
    return extensionContext;
}

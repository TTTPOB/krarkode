export class HelpEntry {
    constructor(
        public readonly sourceUrl: string,
        public readonly title: string | undefined,
        public readonly content?: string,
        public readonly kind: string = 'html',
        public readonly entryType: 'help' | 'welcome' = 'help'
    ) {}
}

export function createHelpEntry(
    sourceUrl: string,
    title: string | undefined,
    content?: string,
    kind: string = 'html',
    entryType: 'help' | 'welcome' = 'help'
): HelpEntry {
    return new HelpEntry(sourceUrl, title, content, kind, entryType);
}

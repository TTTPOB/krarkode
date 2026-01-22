export class HelpEntry {
    constructor(
        public readonly sourceUrl: string,
        public readonly title: string | undefined,
        public readonly content?: string,
        public readonly entryType: 'help' | 'welcome' = 'help'
    ) {}
}

export function createHelpEntry(
    sourceUrl: string,
    title: string | undefined,
    content?: string,
    entryType: 'help' | 'welcome' = 'help'
): HelpEntry {
    return new HelpEntry(sourceUrl, title, content, entryType);
}

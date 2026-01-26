import * as assert from 'assert';
import * as vscode from 'vscode';
import { HelpService } from '../../help/helpService';

suite('Help service', () => {
    test('showHelpContent pushes entries and updates navigation', async () => {
        const requests: Array<{ method: string; params: unknown }> = [];
        const service = new HelpService(vscode.Uri.file('/tmp'), (method, params) => {
            requests.push({ method, params });
        });

        await service.showHelpContent('<title>Intro</title><p>Hi</p>', 'html', false);
        assert.strictEqual(service.helpEntries.length, 1);
        assert.strictEqual(service.currentHelpEntry?.title, 'Intro');
        assert.strictEqual(service.canGoBack, false);

        await service.showHelpContent('<title>Next</title><p>More</p>', 'html', false);
        assert.strictEqual(service.helpEntries.length, 2);
        assert.strictEqual(service.currentHelpEntry?.title, 'Next');
        assert.strictEqual(service.canGoBack, true);

        service.goBack();
        assert.strictEqual(service.currentHelpEntry?.title, 'Intro');
        service.goForward();
        assert.strictEqual(service.currentHelpEntry?.title, 'Next');

        assert.deepStrictEqual(requests, []);
        service.dispose();
    });

    test('loadUrl fetches HTML and injects base href', async () => {
        const originalFetch = globalThis.fetch;
        globalThis.fetch = (async () =>
            ({
                ok: true,
                text: async () => '<html><head><title>Topic</title></head><body>Body</body></html>',
            }) as unknown as Response) as typeof fetch;

        const service = new HelpService(vscode.Uri.file('/tmp'), () => undefined);
        try {
            await service.loadUrl('http://127.0.0.1:1234/help/topic.html');
            const entry = service.currentHelpEntry;
            assert.ok(entry);
            assert.strictEqual(entry?.title, 'Topic');
            assert.strictEqual(entry?.kind, 'html');
            assert.ok(entry?.content?.includes('<base href="http://127.0.0.1:1234/help/">'));
        } finally {
            globalThis.fetch = originalFetch;
            service.dispose();
        }
    });

    test('showWelcomePage uses welcome entry when base URL is missing', async () => {
        const service = new HelpService(vscode.Uri.file('/tmp'), () => undefined);
        await service.showWelcomePage();
        assert.strictEqual(service.currentHelpEntry?.entryType, 'welcome');
        assert.strictEqual(service.currentHelpEntry?.title, 'R Help');
        service.dispose();
    });
});

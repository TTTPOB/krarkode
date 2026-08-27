import * as path from 'path';
import Mocha from 'mocha';
import * as vscode from 'vscode';
import { setExtensionContext } from '../../context';

export async function run(): Promise<void> {
    const mocha = new Mocha({ ui: 'tdd', color: true });
    const testsRoot = path.resolve(__dirname);

    mocha.addFile(path.join(testsRoot, 'extension.test.js'));
    mocha.addFile(path.join(testsRoot, 'logging.test.js'));
    mocha.addFile(path.join(testsRoot, 'dataExplorerUtils.test.js'));
    mocha.addFile(path.join(testsRoot, 'sidecarUtils.test.js'));
    mocha.addFile(path.join(testsRoot, 'helpService.test.js'));
    mocha.addFile(path.join(testsRoot, 'variablesService.test.js'));

    const extension = vscode.extensions.getExtension('tttpob.krarkode');
    if (!extension) {
        throw new Error('Krarkode extension not found in extension host');
    }
    await extension.activate();

    // dist/extension.js and dist-test/context.js contain separate module instances.
    setExtensionContext({
        extensionUri: extension.extensionUri,
        globalStorageUri: vscode.Uri.file(path.join(testsRoot, '.global-storage')),
        globalState: {
            get: () => undefined,
            update: () => Promise.resolve(),
        },
    } as unknown as vscode.ExtensionContext);

    return new Promise((resolve, reject) => {
        mocha.run((failures: number) => {
            if (failures > 0) {
                reject(new Error(`${failures} tests failed.`));
            } else {
                resolve();
            }
        });
    });
}

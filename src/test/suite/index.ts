import * as path from 'path';
import Mocha from 'mocha';

export function run(): Promise<void> {
    const mocha = new Mocha({ ui: 'tdd', color: true });
    const testsRoot = path.resolve(__dirname);

    mocha.addFile(path.join(testsRoot, 'extension.test.js'));
    mocha.addFile(path.join(testsRoot, 'logging.test.js'));

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

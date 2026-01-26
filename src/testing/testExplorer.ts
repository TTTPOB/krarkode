import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as cp from 'child_process';
import * as readline from 'readline';
import { getLogger, LogCategory } from '../logging/logger';
import { getRBinaryPath } from '../util';

type TestItemKind = 'file' | 'test';

type TestItemInfo = {
    kind: TestItemKind;
    filePath: string;
    testName?: string;
};

type ReporterEvent = {
    type: 'start_file' | 'start_test' | 'add_result' | 'end_test' | 'end_file';
    filename?: string;
    test?: string;
    result?: string;
    message?: string;
    location?: string;
};

const TEST_FILE_PATTERN = 'tests/testthat/test*.R';
const TESTTHAT_CONFIG = 'tests/testthat.R';
const R_PACKAGE_DESCRIPTOR = 'DESCRIPTION';

let controller: vscode.TestController | undefined;
let fileWatcher: vscode.FileSystemWatcher | undefined;
let configWatcher: vscode.FileSystemWatcher | undefined;
const testItemData = new WeakMap<vscode.TestItem, TestItemInfo>();
const testsByFile = new Map<string, Map<string, vscode.TestItem>>();
const logger = getLogger();

export async function setupTestExplorer(context: vscode.ExtensionContext): Promise<void> {
    if (!isTestingEnabled()) {
        logger.debug('ark', LogCategory.Core, 'Testing disabled; skipping test explorer setup.');
        disposeTestExplorer();
        return;
    }

    if (controller) {
        return;
    }

    const workspaceRoot = getWorkspaceRoot();
    if (!workspaceRoot) {
        logger.debug('ark', LogCategory.Core, 'No workspace folder; skipping test explorer setup.');
        return;
    }

    const configured = await isTestthatConfigured(workspaceRoot);
    if (!configured) {
        logger.debug('ark', LogCategory.Core, 'Testthat config not found; skipping test explorer setup.');
        return;
    }

    controller = vscode.tests.createTestController('krarkodeTestthat', 'Krarkode Test Explorer');
    context.subscriptions.push(controller);
    logger.log('ark', LogCategory.Core, 'info', 'Test explorer initialized.');

    controller.resolveHandler = async (item) => {
        if (!controller) {
            return;
        }
        if (item) {
            await loadTestsFromFile(item);
            return;
        }
        await discoverTestFiles(workspaceRoot);
    };

    controller.createRunProfile(
        'Run',
        vscode.TestRunProfileKind.Run,
        (request, token) => runHandler(request, token, workspaceRoot, context),
        true,
    );

    fileWatcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(workspaceRoot, TEST_FILE_PATTERN),
    );
    fileWatcher.onDidCreate(() => void discoverTestFiles(workspaceRoot));
    fileWatcher.onDidDelete(() => void discoverTestFiles(workspaceRoot));
    fileWatcher.onDidChange((uri) => void refreshFileItem(uri));
    context.subscriptions.push(fileWatcher);

    configWatcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(workspaceRoot, TESTTHAT_CONFIG),
    );
    configWatcher.onDidCreate(() => void discoverTestFiles(workspaceRoot));
    configWatcher.onDidDelete(() => void disposeTestExplorer());
    context.subscriptions.push(configWatcher);

    await discoverTestFiles(workspaceRoot);
}

export async function refreshTestExplorer(context: vscode.ExtensionContext): Promise<void> {
    if (isTestingEnabled()) {
        await setupTestExplorer(context);
        return;
    }
    disposeTestExplorer();
}

function disposeTestExplorer(): void {
    controller?.dispose();
    controller = undefined;
    fileWatcher?.dispose();
    fileWatcher = undefined;
    configWatcher?.dispose();
    configWatcher = undefined;
    testsByFile.clear();
}

async function discoverTestFiles(workspaceRoot: vscode.Uri): Promise<void> {
    if (!controller) {
        return;
    }
    logger.debug('ark', LogCategory.Core, `Discovering testthat files in ${workspaceRoot.fsPath}.`);
    const pattern = new vscode.RelativePattern(workspaceRoot, TEST_FILE_PATTERN);
    const files = await vscode.workspace.findFiles(pattern);
    const seen = new Set<string>();
    for (const uri of files) {
        seen.add(uri.fsPath);
        getOrCreateFileItem(uri);
    }

    controller.items.forEach((item) => {
        const info = testItemData.get(item);
        if (!info || info.kind !== 'file') {
            return;
        }
        if (!seen.has(info.filePath)) {
            controller?.items.delete(item.id);
            testsByFile.delete(info.filePath);
        }
    });
}

function getOrCreateFileItem(uri: vscode.Uri): vscode.TestItem | undefined {
    if (!controller) {
        return undefined;
    }
    const id = uri.fsPath;
    const existing = controller.items.get(id);
    if (existing) {
        return existing;
    }

    const label = path.basename(uri.fsPath);
    const item = controller.createTestItem(id, label, uri);
    item.canResolveChildren = true;
    controller.items.add(item);
    testItemData.set(item, { kind: 'file', filePath: uri.fsPath });
    logger.debug('ark', LogCategory.Core, `Created test file item for ${uri.fsPath}.`);
    return item;
}

async function refreshFileItem(uri: vscode.Uri): Promise<void> {
    if (!controller) {
        return;
    }
    const item = controller.items.get(uri.fsPath);
    if (!item) {
        return;
    }
    await loadTestsFromFile(item);
}

async function loadTestsFromFile(item: vscode.TestItem): Promise<void> {
    const info = testItemData.get(item);
    if (!info || info.kind !== 'file' || !item.uri) {
        return;
    }

    logger.debug('ark', LogCategory.Core, `Parsing tests from ${info.filePath}.`);
    const document = await vscode.workspace.openTextDocument(item.uri);
    const content = document.getText();
    const matches = parseTestNames(content, document);
    const children: vscode.TestItem[] = [];
    const testMap = new Map<string, vscode.TestItem>();
    for (const match of matches) {
        const id = `${info.filePath}::${match.name}`;
        const child = controller?.createTestItem(id, match.name, item.uri);
        if (!child) {
            continue;
        }
        child.range = match.range;
        children.push(child);
        testMap.set(match.name, child);
        testItemData.set(child, { kind: 'test', filePath: info.filePath, testName: match.name });
    }
    item.children.replace(children);
    testsByFile.set(info.filePath, testMap);
    logger.debug('ark', LogCategory.Core, `Parsed ${children.length} tests in ${info.filePath}.`);
}

function parseTestNames(content: string, document: vscode.TextDocument): Array<{ name: string; range: vscode.Range }> {
    const regex = /(test_that|describe|it)\s*\(\s*(['"])((?:\\.|(?!\2).)*)\2/gm;
    const matches: Array<{ name: string; range: vscode.Range }> = [];
    for (const match of content.matchAll(regex)) {
        const name = match[3]?.trim();
        if (!name || match.index === undefined) {
            continue;
        }
        const start = document.positionAt(match.index);
        const end = document.positionAt(match.index + match[0].length);
        matches.push({ name, range: new vscode.Range(start, end) });
    }
    return matches;
}

async function runHandler(
    request: vscode.TestRunRequest,
    token: vscode.CancellationToken,
    workspaceRoot: vscode.Uri,
    context: vscode.ExtensionContext,
): Promise<void> {
    if (!controller) {
        return;
    }
    const run = controller.createTestRun(request);
    const targets = collectRunTargets(request);
    logger.log('ark', LogCategory.Core, 'info', `Starting test run (${targets.length} target(s)).`);

    for (const target of targets) {
        if (token.isCancellationRequested) {
            break;
        }
        await runTestTarget(run, target, workspaceRoot, context);
    }

    run.end();
    logger.log('ark', LogCategory.Core, 'info', 'Test run finished.');
}

type RunTarget = {
    filePath: string;
    fileItem: vscode.TestItem;
    selectedTests: string[] | null;
};

function collectRunTargets(request: vscode.TestRunRequest): RunTarget[] {
    if (!controller) {
        return [];
    }
    const targets = new Map<string, RunTarget>();
    const include = request.include;
    const exclude = request.exclude ?? [];

    const isExcluded = (item: vscode.TestItem): boolean => exclude.includes(item);

    const collectFileItem = (item: vscode.TestItem): void => {
        const info = testItemData.get(item);
        if (!info || info.kind !== 'file' || !item.uri) {
            return;
        }
        if (isExcluded(item)) {
            return;
        }
        targets.set(info.filePath, {
            filePath: info.filePath,
            fileItem: item,
            selectedTests: null,
        });
    };

    const collectTestItem = (item: vscode.TestItem): void => {
        const info = testItemData.get(item);
        if (!info || info.kind !== 'test' || !info.testName) {
            return;
        }
        if (isExcluded(item)) {
            return;
        }
        const fileItem = controller?.items.get(info.filePath);
        if (!fileItem) {
            return;
        }
        const target = targets.get(info.filePath) ?? {
            filePath: info.filePath,
            fileItem,
            selectedTests: [],
        };
        target.selectedTests ??= [];
        target.selectedTests.push(info.testName);
        targets.set(info.filePath, target);
    };

    if (!include || include.length === 0) {
        controller.items.forEach((item) => {
            collectFileItem(item);
        });
    } else {
        include.forEach((item) => {
            const info = testItemData.get(item);
            if (!info) {
                return;
            }
            if (info.kind === 'file') {
                collectFileItem(item);
                return;
            }
            collectTestItem(item);
        });
    }

    return Array.from(targets.values());
}

async function runTestTarget(
    run: vscode.TestRun,
    target: RunTarget,
    workspaceRoot: vscode.Uri,
    context: vscode.ExtensionContext,
): Promise<void> {
    const rPath = await getRBinaryPath(false);
    if (!rPath) {
        run.errored(target.fileItem, new vscode.TestMessage('R binary not found. Configure krarkode.r.rBinaryPath.'));
        return;
    }
    run.started(target.fileItem);

    const reporterPath = context.asAbsolutePath(path.join('resources', 'testing', 'krarkode-testthat.R'));
    const reporterPathPosix = reporterPath.replace(/\\/g, '/');
    const testPathPosix = target.filePath.replace(/\\/g, '/');
    const selectedTest = target.selectedTests && target.selectedTests.length === 1 ? target.selectedTests[0] : null;
    const expression = buildRunnerExpression(reporterPathPosix, testPathPosix, selectedTest);

    logger.debug('ark', LogCategory.Core, `Running testthat for ${target.filePath}.`);

    await spawnRProcess(rPath, expression, workspaceRoot.fsPath, run, target);
}

function buildRunnerExpression(reporterPath: string, testPath: string, selectedTest: string | null): string {
    const reporterLiteral = toRStringLiteral(reporterPath);
    const testLiteral = toRStringLiteral(testPath);
    const selectedLiteral = selectedTest ? toRStringLiteral(selectedTest) : 'NULL';
    return `source(${reporterLiteral}); krarkode_run_tests(${testLiteral}, selected_test = ${selectedLiteral})`;
}

async function spawnRProcess(
    rPath: string,
    expression: string,
    cwd: string,
    run: vscode.TestRun,
    target: RunTarget,
): Promise<void> {
    return new Promise((resolve) => {
        const child = cp.spawn(rPath, ['--no-echo', '-e', expression], {
            cwd,
            env: { ...process.env },
        });
        let stderr = '';

        const rl = readline.createInterface({ input: child.stdout });
        rl.on('line', (line) => {
            handleReporterLine(line, run, target);
        });

        child.stderr.on('data', (data: Buffer) => {
            const message = data.toString();
            stderr += message;
            logger.debug('ark', LogCategory.Core, `testthat stderr: ${message.trim()}`);
        });

        child.on('error', (error) => {
            run.errored(target.fileItem, new vscode.TestMessage(String(error)));
            resolve();
        });

        child.on('exit', (code) => {
            if (code !== 0) {
                const detail = stderr.trim();
                const message =
                    detail.length > 0
                        ? `Test process exited with code ${code ?? 'null'}: ${detail}`
                        : `Test process exited with code ${code ?? 'null'}.`;
                run.errored(target.fileItem, new vscode.TestMessage(message));
            }
            rl.close();
            resolve();
        });
    });
}

function handleReporterLine(line: string, run: vscode.TestRun, target: RunTarget): void {
    const trimmed = line.trim();
    if (!trimmed) {
        return;
    }
    let event: ReporterEvent | undefined;
    try {
        event = JSON.parse(trimmed) as ReporterEvent;
    } catch {
        logger.debug('ark', LogCategory.Core, `Non-JSON test output: ${trimmed}`);
        return;
    }

    if (event.type === 'start_file') {
        logger.debug('ark', LogCategory.Core, `Test file started: ${event.filename ?? target.filePath}.`);
        return;
    }

    const testName = event.test;
    if (!testName) {
        return;
    }
    const testItem = testsByFile.get(target.filePath)?.get(testName);
    if (!testItem) {
        logger.debug('ark', LogCategory.Core, `Test item not found for ${testName}.`);
        return;
    }

    if (event.type === 'start_test') {
        run.started(testItem);
        return;
    }

    if (event.type === 'end_test') {
        return;
    }

    if (event.type === 'add_result') {
        const message = event.message ?? '';
        const testMessage = message ? new vscode.TestMessage(message) : new vscode.TestMessage('');
        const location = event.location ? parseLocation(event.location, target.filePath) : undefined;
        if (location) {
            testMessage.location = location;
        }
        switch (event.result) {
            case 'success':
            case 'warning':
                run.passed(testItem);
                break;
            case 'skip':
                run.skipped(testItem);
                break;
            case 'failure':
                run.failed(testItem, testMessage);
                break;
            case 'error':
                run.errored(testItem, testMessage);
                break;
            default:
                run.errored(testItem, new vscode.TestMessage(`Unknown result: ${event.result ?? 'unknown'}`));
                break;
        }
    }
}

function parseLocation(location: string, filePath: string): vscode.Location | undefined {
    const match = location.match(/:(\d+)(?::(\d+))?$/);
    if (match) {
        const line = Math.max(0, parseInt(match[1], 10) - 1);
        const column = Math.max(0, parseInt(match[2] ?? '1', 10) - 1);
        return new vscode.Location(vscode.Uri.file(filePath), new vscode.Position(line, column));
    }
    const lineMatch = location.match(/Line\s+(\d+)/i);
    if (lineMatch) {
        const line = Math.max(0, parseInt(lineMatch[1], 10) - 1);
        return new vscode.Location(vscode.Uri.file(filePath), new vscode.Position(line, 0));
    }
    return undefined;
}

function isTestingEnabled(): boolean {
    return vscode.workspace.getConfiguration('krarkode.testing').get<boolean>('enabled') === true;
}

function getWorkspaceRoot(): vscode.Uri | undefined {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        return undefined;
    }
    return workspaceFolders[0].uri;
}

async function isTestthatConfigured(root: vscode.Uri): Promise<boolean> {
    const hasConfig = await existsInWorkspace(root, TESTTHAT_CONFIG);
    const hasDescriptor = await existsInWorkspace(root, R_PACKAGE_DESCRIPTOR);
    if (!hasDescriptor) {
        logger.debug('ark', LogCategory.Core, 'R package descriptor missing; skipping test explorer.');
        return false;
    }
    return hasConfig;
}

async function existsInWorkspace(root: vscode.Uri, relativePath: string): Promise<boolean> {
    const fullPath = path.join(root.fsPath, relativePath);
    return fs.existsSync(fullPath);
}

function toRStringLiteral(value: string): string {
    const escaped = value
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\r')
        .replace(/\t/g, '\\t');
    return `"${escaped}"`;
}

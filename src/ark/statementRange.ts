import * as vscode from 'vscode';
import {
    Position,
    Range,
    RequestType,
    VersionedTextDocumentIdentifier,
    type LanguageClient,
} from 'vscode-languageclient/node';
import { getLogger, LogCategory } from '../logging/logger';

interface StatementRangeParams {
    textDocument: VersionedTextDocumentIdentifier;
    position: Position;
}

interface StatementRangeResponse {
    range: Range;
    code?: string;
}

const StatementRangeRequest = new RequestType<
    StatementRangeParams,
    StatementRangeResponse | undefined,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    any
>('positron/textDocument/statementRange');

/**
 * Query the Ark LSP for the complete statement range at a given cursor position.
 * Returns the VS Code range and optional pre-processed code (e.g. for roxygen examples).
 * Returns undefined if the LSP client is unavailable or the request fails.
 */
export async function getStatementRange(
    client: LanguageClient,
    document: vscode.TextDocument,
    position: vscode.Position,
): Promise<{ range: vscode.Range; code?: string } | undefined> {
    try {
        const params: StatementRangeParams = {
            textDocument: client.code2ProtocolConverter.asVersionedTextDocumentIdentifier(document),
            position: client.code2ProtocolConverter.asPosition(position),
        };

        const response = await client.sendRequest(StatementRangeRequest, params);
        if (!response) {
            return undefined;
        }

        const range = client.protocol2CodeConverter.asRange(response.range);
        const code = typeof response.code === 'string' ? response.code : undefined;
        return { range, code };
    } catch (err) {
        getLogger().log(
            'runtime',
            LogCategory.Exec,
            'debug',
            `statementRange request failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        return undefined;
    }
}

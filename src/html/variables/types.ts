/**
 * Shared type definitions for the Variables webview.
 */

export interface Variable {
    access_key: string;
    display_name: string;
    display_value: string;
    display_type: string;
    type_info: string;
    size: number;
    kind: string;
    length: number;
    has_children: boolean;
    has_viewer: boolean;
    is_truncated: boolean;
    updated_time: number;
}

export interface RefreshParams {
    variables: Variable[];
    length: number;
    version: number;
}

export interface UpdateParams {
    assigned: Variable[];
    unevaluated: Variable[];
    removed: string[];
    version: number;
}

export interface InspectResult {
    path: string[];
    children: Variable[];
    length: number;
}

export interface ConnectionParams {
    connected: boolean;
}

export interface ErrorParams {
    message?: string;
    detail?: string;
}

export interface VariablesEvent {
    method: 'refresh' | 'update' | 'inspect' | 'connection' | 'error';
    params: RefreshParams | UpdateParams | InspectResult | ConnectionParams | ErrorParams;
}

declare function acquireVsCodeApi(): {
    postMessage: (message: unknown) => void;
};

let vsCodeApi: ReturnType<typeof acquireVsCodeApi> | null = null;

export function getVsCodeApi(): ReturnType<typeof acquireVsCodeApi> {
    if (!vsCodeApi) {
        vsCodeApi = acquireVsCodeApi();
    }
    return vsCodeApi;
}

export function isUpdateParams(value: unknown): value is UpdateParams {
    return (
        typeof value === 'object' &&
        value !== null &&
        Array.isArray((value as UpdateParams).assigned) &&
        Array.isArray((value as UpdateParams).removed) &&
        typeof (value as UpdateParams).version === 'number'
    );
}

export function pathKey(path: string[]): string {
    return JSON.stringify(path);
}

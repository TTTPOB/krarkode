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

export interface ViewParams {
    path: string[];
}

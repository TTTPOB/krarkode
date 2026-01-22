// Define Variable interface matching Rust/Protocol
interface Variable {
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

interface RefreshParams {
    variables: Variable[];
    length: number;
    version: number;
}

interface InspectResult {
    path: string[];
    children: Variable[];
    length: number;
}

interface VariablesEvent {
    method: 'refresh' | 'update' | 'inspect';
    params: RefreshParams | InspectResult | any; // UpdateParams is complex, using any for now
}

declare function acquireVsCodeApi(): any;
const vscode = acquireVsCodeApi();

const listElement = document.getElementById('variables-list')!;
let variables: Variable[] = [];
const childrenByPath = new Map<string, Variable[]>();
const childrenLengthByPath = new Map<string, number>();
const expandedPaths = new Set<string>();
const loadingPaths = new Set<string>();

// Handle messages from extension
window.addEventListener('message', event => {
    const message = event.data;
    switch (message.type) {
        case 'update':
            handleUpdate(message.event);
            break;
    }
});

function handleUpdate(event: VariablesEvent) {
    if (event.method === 'refresh') {
        variables = (event.params as RefreshParams).variables;
        resetTreeState();
        render();
    } else if (event.method === 'update') {
        // Handle partial update
        // For simplicity, we might just re-render or merge
        // event.params: { assigned: [], unevaluated: [], removed: [] }
        const params = event.params;
        const assigned = params.assigned || [];
        const removed = params.removed || [];

        // Remove
        variables = variables.filter(v => !removed.includes(v.access_key));
        
        // Update/Add
        for (const v of assigned) {
            const index = variables.findIndex(existing => existing.access_key === v.access_key);
            if (index !== -1) {
                variables[index] = v;
            } else {
                variables.push(v);
            }
        }
        resetTreeState();
        render();
    } else if (event.method === 'inspect') {
        const params = event.params as InspectResult;
        const key = pathKey(params.path);
        childrenByPath.set(key, params.children);
        childrenLengthByPath.set(key, params.length);
        loadingPaths.delete(key);
        render();
    }
}

function resetTreeState() {
    childrenByPath.clear();
    childrenLengthByPath.clear();
    expandedPaths.clear();
    loadingPaths.clear();
}

function render() {
    listElement.innerHTML = '';

    // Group variables
    const dataVars = variables.filter(v => v.kind === 'table' || v.kind === 'dataframe');
    const valueVars = variables.filter(v => v.kind !== 'table' && v.kind !== 'dataframe' && v.kind !== 'plot'); // Assuming plot is separate
    // Note: Ark VariableKind includes 'Table', 'Map', 'Collection' etc.
    // We should check exact kind strings from Ark. 
    // Ark sends lowercase: 'table', 'string', 'number', etc.

    if (dataVars.length > 0) {
        renderGroup('DATA', dataVars);
    }

    if (valueVars.length > 0) {
        renderGroup('VALUES', valueVars);
    }
    
    if (variables.length === 0) {
        const empty = document.createElement('div');
        empty.style.padding = '10px';
        empty.style.opacity = '0.7';
        empty.textContent = 'No variables';
        listElement.appendChild(empty);
    }
}

function renderGroup(title: string, vars: Variable[]) {
    const groupHeader = document.createElement('div');
    groupHeader.className = 'group-header';
    groupHeader.textContent = title;
    listElement.appendChild(groupHeader);

    vars.forEach(v => renderVariable(v, [v.access_key], 0));
}

function renderVariable(variable: Variable, path: string[], depth: number) {
    const key = pathKey(path);
    const isExpanded = expandedPaths.has(key);
    const isComplex = isComplexVariable(variable);

    const item = document.createElement('div');
    item.className = 'variable-item';
    if (isComplex) {
        item.classList.add('is-complex');
    }

    const row = document.createElement('div');
    row.className = 'variable-row';
    row.style.paddingLeft = `${8 + depth * 14}px`;
    row.onclick = () => {
        if (variable.has_children) {
            toggleExpanded(path);
        }
    };

    const toggle = document.createElement('div');
    toggle.className = 'var-toggle';
    toggle.textContent = variable.has_children ? (isExpanded ? '▾' : '▸') : '';
    row.appendChild(toggle);

    const icon = document.createElement('div');
    icon.className = 'var-icon';
    icon.textContent = getIconForKind(variable.kind);
    row.appendChild(icon);

    const name = document.createElement('div');
    name.className = 'var-name';
    name.textContent = variable.display_name;
    name.title = variable.display_name;
    row.appendChild(name);

    const value = document.createElement('div');
    value.className = 'var-value';
    value.textContent = variable.display_value;
    value.title = variable.display_value;
    row.appendChild(value);

    const type = document.createElement('div');
    type.className = 'var-type';
    type.textContent = variable.display_type;
    row.appendChild(type);

    if (variable.has_viewer) {
        const actions = document.createElement('div');
        actions.className = 'var-actions';

        const viewBtn = document.createElement('button');
        viewBtn.className = 'action-btn';
        viewBtn.textContent = '◫';
        viewBtn.title = 'View Data';
        viewBtn.onclick = (e) => {
            e.stopPropagation();
            vscode.postMessage({ type: 'view', path });
        };
        actions.appendChild(viewBtn);
        row.appendChild(actions);
    }

    item.appendChild(row);

    if (isComplex) {
        const metaText = buildMetaText(variable);
        if (metaText) {
            const meta = document.createElement('div');
            meta.className = 'variable-meta';
            meta.style.paddingLeft = `${28 + depth * 14}px`;
            meta.textContent = metaText;
            item.appendChild(meta);
        }
    }

    listElement.appendChild(item);

    if (variable.has_children && isExpanded) {
        const children = childrenByPath.get(key);
        if (children) {
            if (children.length === 0) {
                renderPlaceholder('No entries', depth + 1);
                return;
            }

            for (const child of children) {
                renderVariable(child, [...path, child.access_key], depth + 1);
            }

            const total = childrenLengthByPath.get(key);
            if (total && total > children.length) {
                renderPlaceholder(`… ${total - children.length} more`, depth + 1, 'variable-overflow');
            }
            return;
        }

        if (loadingPaths.has(key)) {
            renderPlaceholder('Loading…', depth + 1);
        }
    }
}

function toggleExpanded(path: string[]) {
    const key = pathKey(path);
    if (expandedPaths.has(key)) {
        expandedPaths.delete(key);
        render();
        return;
    }

    expandedPaths.add(key);
    if (!childrenByPath.has(key)) {
        loadingPaths.add(key);
        vscode.postMessage({ type: 'inspect', path });
    }
    render();
}

function renderPlaceholder(text: string, depth: number, className = 'variable-placeholder') {
    const item = document.createElement('div');
    item.className = className;
    item.style.paddingLeft = `${28 + depth * 14}px`;
    item.textContent = text;
    listElement.appendChild(item);
}

function buildMetaText(variable: Variable): string | undefined {
    const parts: string[] = [];
    if (variable.type_info && variable.type_info !== variable.display_type) {
        parts.push(variable.type_info);
    }

    if (variable.length > 0) {
        parts.push(formatLength(variable));
    }

    if (variable.size > 0) {
        parts.push(formatBytes(variable.size));
    }

    if (parts.length === 0) {
        return undefined;
    }

    return parts.join(' • ');
}

function formatLength(variable: Variable): string {
    if (variable.kind === 'table') {
        return `${variable.length} columns`;
    }
    if (variable.kind === 'map') {
        return `${variable.length} entries`;
    }
    return `${variable.length} items`;
}

function formatBytes(size: number): string {
    if (size < 1024) {
        return `${size} B`;
    }
    if (size < 1024 * 1024) {
        return `${(size / 1024).toFixed(1)} KB`;
    }
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function isComplexVariable(variable: Variable): boolean {
    return variable.has_children || ['table', 'map', 'collection', 'class'].includes(variable.kind);
}

function pathKey(path: string[]): string {
    return JSON.stringify(path);
}

function getIconForKind(kind: string): string {
    switch (kind) {
        case 'table': return '◫';
        case 'string': return 'abc';
        case 'number': return '#';
        case 'boolean': return '☑';
        case 'function': return 'λ';
        default: return '?';
    }
}

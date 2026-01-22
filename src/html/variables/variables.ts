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

interface VariablesEvent {
    method: 'refresh' | 'update';
    params: RefreshParams | any; // UpdateParams is complex, using any for now
}

declare function acquireVsCodeApi(): any;
const vscode = acquireVsCodeApi();

const listElement = document.getElementById('variables-list')!;
let variables: Variable[] = [];

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
        render();
    }
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

    vars.forEach(v => {
        const item = document.createElement('div');
        item.className = 'variable-item';
        
        // Icon
        const icon = document.createElement('div');
        icon.className = 'var-icon';
        icon.textContent = getIconForKind(v.kind); // We can use codicons later
        item.appendChild(icon);

        // Name
        const name = document.createElement('div');
        name.className = 'var-name';
        name.textContent = v.display_name;
        name.title = v.display_name;
        item.appendChild(name);

        // Value
        const value = document.createElement('div');
        value.className = 'var-value';
        value.textContent = v.display_value;
        value.title = v.display_value;
        item.appendChild(value);

        // Type
        const type = document.createElement('div');
        type.className = 'var-type';
        type.textContent = v.display_type;
        item.appendChild(type);

        // Actions (View button if has_viewer)
        if (v.has_viewer) {
            const actions = document.createElement('div');
            actions.className = 'var-actions';
            
            const viewBtn = document.createElement('button');
            viewBtn.className = 'action-btn';
            viewBtn.textContent = '◫'; // Grid icon placeholder
            viewBtn.title = 'View Data';
            viewBtn.onclick = (e) => {
                e.stopPropagation();
                vscode.postMessage({ type: 'view', path: [v.access_key] });
            };
            actions.appendChild(viewBtn);
            item.appendChild(actions);
        }

        listElement.appendChild(item);
    });
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

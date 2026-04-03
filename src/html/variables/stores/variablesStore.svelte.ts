/**
 * Reactive state store for the Variables webview.
 * Svelte 5 runes class singleton.
 */

import {
    type Variable,
    type RefreshParams,
    type UpdateParams,
    type InspectResult,
    type ConnectionParams,
    type ErrorParams,
    isUpdateParams,
    pathKey,
} from '../types';

class VariablesStore {
    variables = $state<Variable[]>([]);
    isConnected = $state(false);
    errorMessage = $state<string | undefined>(undefined);
    errorDetail = $state<string | undefined>(undefined);
    filterText = $state('');

    // Tree state: use plain objects since Map/Set mutations aren't tracked by $state.
    // We reassign on every change to trigger reactivity.
    private _childrenByPath = $state<Record<string, Variable[]>>({});
    private _childrenLengthByPath = $state<Record<string, number>>({});
    private _expandedPaths = $state<Record<string, boolean>>({});
    private _loadingPaths = $state<Record<string, boolean>>({});

    // Derived: grouped variables
    dataVars = $derived(
        this.variables.filter((v) => v.kind === 'table' || v.kind === 'dataframe'),
    );
    valueVars = $derived(
        this.variables.filter(
            (v) => v.kind !== 'table' && v.kind !== 'dataframe' && v.kind !== 'plot',
        ),
    );

    // Derived: filtered groups
    filteredDataVars = $derived(this.applyFilter(this.dataVars));
    filteredValueVars = $derived(this.applyFilter(this.valueVars));

    // Public accessors for tree state
    getChildren(path: string[]): Variable[] | undefined {
        return this._childrenByPath[pathKey(path)];
    }

    getChildrenLength(path: string[]): number | undefined {
        return this._childrenLengthByPath[pathKey(path)];
    }

    isExpanded(path: string[]): boolean {
        return this._expandedPaths[pathKey(path)] === true;
    }

    isLoading(path: string[]): boolean {
        return this._loadingPaths[pathKey(path)] === true;
    }

    // Event handlers
    handleRefresh(params: RefreshParams): void {
        this.variables = params.variables;
        this.resetTreeState();
    }

    handleUpdate(params: unknown): void {
        if (!isUpdateParams(params)) {
            return;
        }
        const assigned = params.assigned || [];
        const removed = params.removed || [];

        // Remove
        let next = this.variables.filter((v) => !removed.includes(v.access_key));

        // Update/Add
        for (const v of assigned) {
            const index = next.findIndex((existing) => existing.access_key === v.access_key);
            if (index !== -1) {
                next[index] = v;
            } else {
                next.push(v);
            }
        }

        this.variables = next;
        this.resetTreeState();
    }

    handleInspect(params: InspectResult): void {
        const key = pathKey(params.path);
        this._childrenByPath = { ...this._childrenByPath, [key]: params.children };
        this._childrenLengthByPath = { ...this._childrenLengthByPath, [key]: params.length };
        const { [key]: _, ...rest } = this._loadingPaths;
        this._loadingPaths = rest;
    }

    handleConnection(params: ConnectionParams): void {
        this.isConnected = params.connected;
        if (!params.connected) {
            this.variables = [];
            this.resetTreeState();
        }
    }

    setError(message?: string, detail?: string): void {
        this.errorMessage = message;
        this.errorDetail = detail;
    }

    clearError(): void {
        this.errorMessage = undefined;
        this.errorDetail = undefined;
    }

    /**
     * Request children for schema display without expanding in the UI.
     * Returns true if the caller should send an inspect request.
     */
    requestChildren(path: string[]): boolean {
        const key = pathKey(path);
        if (this._childrenByPath[key] || this._loadingPaths[key]) {
            return false;
        }
        this._loadingPaths = { ...this._loadingPaths, [key]: true };
        return true;
    }

    /**
     * Toggle expand/collapse for a variable path.
     * Returns true if the caller should send an inspect request (i.e., expanding and no cached children).
     */
    toggleExpanded(path: string[]): boolean {
        const key = pathKey(path);
        if (this._expandedPaths[key]) {
            const { [key]: _, ...rest } = this._expandedPaths;
            this._expandedPaths = rest;
            return false;
        }

        this._expandedPaths = { ...this._expandedPaths, [key]: true };

        if (!this._childrenByPath[key]) {
            this._loadingPaths = { ...this._loadingPaths, [key]: true };
            return true;
        }

        return false;
    }

    private resetTreeState(): void {
        this._childrenByPath = {};
        this._childrenLengthByPath = {};
        this._expandedPaths = {};
        this._loadingPaths = {};
    }

    private applyFilter(vars: Variable[]): Variable[] {
        const term = this.filterText.trim().toLowerCase();
        if (!term) {
            return vars;
        }
        return vars.filter((v) => v.display_name.toLowerCase().includes(term));
    }
}

export const variablesStore = new VariablesStore();

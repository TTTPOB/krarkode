import type { InitMessage } from '../types';

type InitControllerOptions = {
    log: (message: string, payload?: unknown) => void;
    initializeDataStore: (state: InitMessage['state'], schema: InitMessage['schema']) => void;
    setColumnVisibilityStatus: (value: string) => void;
    setColumnVisibilitySearchTerm: (value: string) => void;
    getActiveStatsColumnIndex: () => number | null;
    setStatsMessage: (message: string, stateValue: 'empty' | 'loading' | 'error') => void;
    clearStatsContent: () => void;
    setCodePreview: (value: string) => void;
    applySchemaUpdate: (schema: InitMessage['schema']) => void;
    getVisibleSchema: () => InitMessage['schema'];
    applyPendingRows: () => void;
    scheduleTableLayoutDiagnostics: (stage: string) => void;
};

export function useInitController(options: InitControllerOptions) {
    const {
        log,
        initializeDataStore,
        setColumnVisibilityStatus,
        setColumnVisibilitySearchTerm,
        getActiveStatsColumnIndex,
        setStatsMessage,
        clearStatsContent,
        setCodePreview,
        applySchemaUpdate,
        getVisibleSchema,
        applyPendingRows,
        scheduleTableLayoutDiagnostics,
    } = options;

    const handleInit = (message: InitMessage): void => {
        initializeDataStore(message.state, message.schema ?? []);
        setColumnVisibilityStatus('');
        setColumnVisibilitySearchTerm('');
        if (getActiveStatsColumnIndex() === null) {
            setStatsMessage('Select a column to view statistics.', 'empty');
        } else {
            setStatsMessage('Loading statistics...', 'loading');
        }
        clearStatsContent();
        setCodePreview('');
        applySchemaUpdate(getVisibleSchema());
        applyPendingRows();
        log('Data explorer initialized', {
            rows: message.state.table_shape.num_rows,
            columns: getVisibleSchema().length,
        });
        scheduleTableLayoutDiagnostics('init');
    };

    return {
        handleInit,
    };
}

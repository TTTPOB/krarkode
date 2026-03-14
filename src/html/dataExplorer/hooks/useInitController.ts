import { uiStore, statsStore } from '../stores';
import type { InitMessage } from '../types';

type InitControllerOptions = {
    log: (message: string, payload?: unknown) => void;
    initializeDataStore: (state: InitMessage['state'], schema: InitMessage['schema']) => void;
    applySchemaUpdate: (schema: InitMessage['schema']) => void;
    getVisibleSchema: () => InitMessage['schema'];
    applyPendingRows: () => void;
    scheduleTableLayoutDiagnostics: (stage: string) => void;
    clearStatsContent: () => void;
};

export class InitController {
    private readonly log: (message: string, payload?: unknown) => void;
    private readonly initializeDataStore: (state: InitMessage['state'], schema: InitMessage['schema']) => void;
    private readonly applySchemaUpdate: (schema: InitMessage['schema']) => void;
    private readonly getVisibleSchema: () => InitMessage['schema'];
    private readonly applyPendingRows: () => void;
    private readonly scheduleTableLayoutDiagnostics: (stage: string) => void;
    private readonly clearStatsContent: () => void;

    constructor(options: InitControllerOptions) {
        this.log = options.log;
        this.initializeDataStore = options.initializeDataStore;
        this.applySchemaUpdate = options.applySchemaUpdate;
        this.getVisibleSchema = options.getVisibleSchema;
        this.applyPendingRows = options.applyPendingRows;
        this.scheduleTableLayoutDiagnostics = options.scheduleTableLayoutDiagnostics;
        this.clearStatsContent = options.clearStatsContent;
    }

    handleInit(message: InitMessage): void {
        this.initializeDataStore(message.state, message.schema ?? []);
        uiStore.columnVisibilityStatus = '';
        uiStore.columnVisibilitySearchTerm = '';
        if (uiStore.activeStatsColumnIndex === null) {
            statsStore.messageText = 'Select a column to view statistics.';
            statsStore.messageState = 'empty';
        } else {
            statsStore.messageText = 'Loading statistics...';
            statsStore.messageState = 'loading';
        }
        this.clearStatsContent();
        uiStore.codePreview = '';
        this.applySchemaUpdate(this.getVisibleSchema());
        this.applyPendingRows();
        this.log('Data explorer initialized', {
            rows: message.state.table_shape.num_rows,
            columns: this.getVisibleSchema().length,
        });
        this.scheduleTableLayoutDiagnostics('init');
    }
}

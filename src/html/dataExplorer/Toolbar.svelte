<script lang="ts">
    let {
        title = 'Data Explorer',
        meta = '',
        columnsButtonEl = $bindable<HTMLButtonElement | undefined>(),
        statsButtonEl = $bindable<HTMLButtonElement | undefined>(),
        codeButtonEl = $bindable<HTMLButtonElement | undefined>(),
        onOpenColumns,
        onOpenStats,
        onOpenCode,
        onRefresh,
        onExport,
    }: {
        title?: string;
        meta?: string;
        columnsButtonEl?: HTMLButtonElement | undefined;
        statsButtonEl?: HTMLButtonElement | undefined;
        codeButtonEl?: HTMLButtonElement | undefined;
        onOpenColumns?: () => void;
        onOpenStats?: () => void;
        onOpenCode?: () => void;
        onRefresh?: () => void;
        onExport?: (data: { format: 'csv' | 'tsv' | 'html' }) => void;
    } = $props();

    let dropdownOpen = $state(false);
    let dropdownContentEl: HTMLDivElement | undefined = $state();

    function handleExport(format: 'csv' | 'tsv' | 'html'): void {
        dropdownOpen = false;
        onExport?.({ format });
    }

    function toggleDropdown(): void {
        dropdownOpen = !dropdownOpen;
        if (dropdownOpen) {
            // Focus first menu item after DOM update
            requestAnimationFrame(() => {
                const first = dropdownContentEl?.querySelector('button') as HTMLButtonElement | null;
                first?.focus();
            });
        }
    }

    function handleDropdownKeydown(event: KeyboardEvent): void {
        const items = Array.from(dropdownContentEl?.querySelectorAll('button') ?? []) as HTMLButtonElement[];
        const current = document.activeElement as HTMLElement;
        const idx = items.indexOf(current as HTMLButtonElement);

        if (event.key === 'ArrowDown') {
            event.preventDefault();
            const next = idx < items.length - 1 ? idx + 1 : 0;
            items[next]?.focus();
        } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            const prev = idx > 0 ? idx - 1 : items.length - 1;
            items[prev]?.focus();
        } else if (event.key === 'Escape') {
            event.preventDefault();
            dropdownOpen = false;
        }
    }
</script>

<div class="toolbar" role="toolbar" aria-label="Data explorer toolbar">
    <div class="title" id="table-title">{title}</div>
    <div class="meta" id="table-meta">{meta}</div>
    <div class="toolbar-actions" role="group" aria-label="Table actions">
        <button
            class="action"
            id="columns-btn"
            title="Column Visibility"
            aria-label="Toggle column visibility"
            bind:this={columnsButtonEl}
            onclick={() => onOpenColumns?.()}
        >
            Columns
        </button>
        <button
            class="action"
            id="stats-btn"
            title="Column Statistics"
            aria-label="Toggle column statistics"
            bind:this={statsButtonEl}
            onclick={() => onOpenStats?.()}
        >
            Stats
        </button>
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="dropdown" onkeydown={handleDropdownKeydown}>
            <button
                class="action"
                id="export-btn"
                aria-haspopup="menu"
                aria-expanded={dropdownOpen}
                onclick={toggleDropdown}
            >Export &#9662;</button>
            <div
                class="dropdown-content"
                class:open={dropdownOpen}
                id="export-dropdown"
                role="menu"
                aria-label="Export formats"
                bind:this={dropdownContentEl}
            >
                <button role="menuitem" tabindex={dropdownOpen ? 0 : -1} data-format="csv" onclick={() => handleExport('csv')}>Export as CSV</button>
                <button role="menuitem" tabindex={dropdownOpen ? 0 : -1} data-format="tsv" onclick={() => handleExport('tsv')}>Export as TSV</button>
                <button role="menuitem" tabindex={dropdownOpen ? 0 : -1} data-format="html" onclick={() => handleExport('html')}>Export as HTML</button>
            </div>
        </div>
        <button
            class="action"
            id="code-btn"
            title="Convert to Code"
            aria-label="Open code conversion"
            bind:this={codeButtonEl}
            onclick={() => onOpenCode?.()}
        >
            Code
        </button>
        <button class="action" id="refresh-btn" aria-label="Refresh data" onclick={() => onRefresh?.()}>
            Refresh
        </button>
    </div>
</div>

<style>
    .toolbar {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 8px 12px;
        border-bottom: 1px solid var(--vscode-editorWidget-border);
        background: var(--vscode-sideBar-background);
    }

    .toolbar .title {
        font-weight: 600;
    }

    .toolbar .meta {
        opacity: 0.7;
        font-size: 0.9em;
    }

    .toolbar-actions {
        margin-left: auto;
        display: flex;
        gap: 8px;
    }

    .toolbar .action {
        background: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
        border: none;
        padding: 4px 10px;
        border-radius: 3px;
        cursor: pointer;
        font-size: 0.9em;
    }

    .toolbar .action:hover {
        background: var(--vscode-button-hoverBackground);
    }

    .dropdown {
        position: relative;
        display: inline-block;
    }

    .dropdown-content {
        display: none;
        position: absolute;
        right: 0;
        background-color: var(--vscode-dropdown-background);
        border: 1px solid var(--vscode-dropdown-border);
        min-width: 160px;
        box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
        z-index: 1000;
        border-radius: 3px;
    }

    .dropdown:hover .dropdown-content,
    .dropdown-content.open {
        display: block;
    }

    .dropdown-content button {
        width: 100%;
        text-align: left;
        padding: 8px 12px;
        background: none;
        border: none;
        color: var(--vscode-dropdown-foreground);
        cursor: pointer;
    }

    .dropdown-content button:hover,
    .dropdown-content button:focus {
        background: var(--vscode-list-hoverBackground);
        outline: none;
    }
</style>

<script lang="ts">
    import { onMount } from 'svelte';
    import { initializeDataExplorer } from './dataExplorer';

    onMount(() => {
        initializeDataExplorer();
    });
</script>

<div class="toolbar">
    <div class="title" id="table-title">Data Explorer</div>
    <div class="meta" id="table-meta"></div>
    <div class="toolbar-actions">
        <button class="action" id="columns-btn" title="Column Visibility">Columns</button>
        <button class="action" id="stats-btn" title="Column Statistics">Stats</button>
        <div class="dropdown">
            <button class="action" id="export-btn">Export ▾</button>
            <div class="dropdown-content" id="export-dropdown">
                <button data-format="csv">Export as CSV</button>
                <button data-format="tsv">Export as TSV</button>
                <button data-format="html">Export as HTML</button>
            </div>
        </div>
        <button class="action" id="code-btn" title="Convert to Code">Code</button>
        <button class="action" id="refresh-btn">Refresh</button>
    </div>
</div>
<div class="row-filter-bar" id="row-filter-bar">
    <div class="row-filter-label">Row Filters</div>
    <div class="row-filter-chips" id="row-filter-chips"></div>
    <button class="action secondary" id="add-row-filter">+ Filter</button>
</div>
<div class="side-panel" id="column-visibility-panel">
    <div class="panel-resizer"></div>
    <div class="panel-header">
        <span>Column Visibility</span>
        <div class="panel-actions">
            <button class="panel-pin" data-panel-id="column-visibility-panel" aria-pressed="false" title="Pin panel">
                <span class="codicon codicon-pin"></span>
            </button>
            <button class="close-btn" id="close-column-visibility">&times;</button>
        </div>
    </div>
    <div class="panel-content">
        <div class="filter-section">
            <label for="column-visibility-search">Search Columns</label>
            <input type="text" id="column-visibility-search" placeholder="Column name...">
        </div>
        <div class="filter-actions">
            <button class="action" id="apply-column-visibility-filter">Apply</button>
            <button class="action secondary" id="clear-column-visibility-filter">Clear</button>
            <button class="action secondary" id="invert-column-visibility">Invert</button>
        </div>
        <div class="filter-status" id="column-visibility-status"></div>
        <div class="column-visibility-list" id="column-visibility-list"></div>
    </div>
</div>
<div class="side-panel" id="row-filter-panel">
    <div class="panel-resizer"></div>
    <div class="panel-header">
        <span>Row Filter</span>
        <div class="panel-actions">
            <button class="panel-pin" data-panel-id="row-filter-panel" aria-pressed="false" title="Pin panel">
                <span class="codicon codicon-pin"></span>
            </button>
            <button class="close-btn" id="close-row-filter">&times;</button>
        </div>
    </div>
    <div class="panel-content">
        <div class="filter-section">
            <label for="row-filter-column">Column</label>
            <select id="row-filter-column"></select>
        </div>
        <div class="filter-section">
            <label for="row-filter-type">Filter Type</label>
            <select id="row-filter-type"></select>
        </div>
        <div class="filter-section" id="row-filter-compare-section">
            <label for="row-filter-compare-op">Comparison</label>
            <div class="row-filter-inline">
                <select id="row-filter-compare-op">
                    <option value="=">=</option>
                    <option value="!=">!=</option>
                    <option value="&lt;">&lt;</option>
                    <option value="&lt;=">&lt;=</option>
                    <option value="&gt;">&gt;</option>
                    <option value="&gt;=">&gt;=</option>
                </select>
                <input type="text" id="row-filter-compare-value" placeholder="Value">
            </div>
        </div>
        <div class="filter-section" id="row-filter-between-section">
            <label for="row-filter-between-left">Between</label>
            <div class="row-filter-inline">
                <input type="text" id="row-filter-between-left" placeholder="From">
                <input type="text" id="row-filter-between-right" placeholder="To">
            </div>
        </div>
        <div class="filter-section" id="row-filter-search-section">
            <label for="row-filter-search-type">Text Search</label>
            <select id="row-filter-search-type">
                <option value="contains">contains</option>
                <option value="not_contains">not contains</option>
                <option value="starts_with">starts with</option>
                <option value="ends_with">ends with</option>
                <option value="regex_match">regex</option>
            </select>
            <input type="text" id="row-filter-search-term" placeholder="Search term">
            <label class="checkbox-inline">
                <input type="checkbox" id="row-filter-search-case"> Case sensitive
            </label>
        </div>
        <div class="filter-section" id="row-filter-set-section">
            <label for="row-filter-set-values">Set Membership</label>
            <input type="text" id="row-filter-set-values" placeholder="Comma-separated values">
            <label class="checkbox-inline">
                <input type="checkbox" id="row-filter-set-inclusive" checked> Include values
            </label>
        </div>
        <div class="filter-section" id="row-filter-condition-section">
            <label for="row-filter-condition">Condition</label>
            <select id="row-filter-condition">
                <option value="and">AND</option>
                <option value="or">OR</option>
            </select>
        </div>
        <div class="filter-status" id="row-filter-error"></div>
        <div class="filter-actions">
            <button class="action" id="save-row-filter">Save</button>
            <button class="action secondary" id="cancel-row-filter">Cancel</button>
        </div>
    </div>
</div>
<div class="side-panel" id="stats-panel">
    <div class="panel-resizer" id="stats-panel-resizer"></div>
    <div class="panel-header">
        <span>Column Statistics</span>
        <div class="panel-actions">
            <button class="panel-pin" data-panel-id="stats-panel" aria-pressed="false" title="Pin panel">
                <span class="codicon codicon-pin"></span>
            </button>
            <button class="close-btn" id="close-stats">&times;</button>
        </div>
    </div>
    <div class="panel-content">
        <div class="stats-section">
            <label for="stats-column">Select Column</label>
            <select id="stats-column">
                <option value="">Choose column...</option>
            </select>
        </div>
        <div class="stats-results" id="stats-results">
            <div class="stats-message" id="stats-message">Select a column to view statistics.</div>
            <div class="stats-sections" id="stats-sections">
                <div class="stats-section collapsible" data-section="overview">
                    <button class="section-header" type="button" data-target="stats-overview-section">
                        <span class="codicon codicon-chevron-down"></span>
                        <span>Overview</span>
                    </button>
                    <div class="section-content" id="stats-overview-section">
                        <table class="stats-table" id="stats-overview-table"></table>
                    </div>
                </div>
                <div class="stats-section collapsible" data-section="summary">
                    <button class="section-header" type="button" data-target="stats-summary-section">
                        <span class="codicon codicon-chevron-down"></span>
                        <span>Summary Statistics</span>
                    </button>
                    <div class="section-content" id="stats-summary-section">
                        <table class="stats-table" id="stats-summary-table"></table>
                    </div>
                </div>
                <div class="stats-section collapsible" data-section="distribution">
                    <button class="section-header" type="button" data-target="stats-distribution-section">
                        <span class="codicon codicon-chevron-down"></span>
                        <span>Distribution</span>
                    </button>
                    <div class="section-content" id="stats-distribution-section">
                        <div class="chart-container" id="histogram-chart"></div>
                        <div class="slider-row">
                            <label for="histogram-bins">Bins</label>
                            <input type="range" id="histogram-bins" min="5" max="200" value="20">
                            <input type="number" id="histogram-bins-input" min="5" max="200" value="20">
                            <select id="histogram-method">
                                <option value="freedman_diaconis">Auto (F-D)</option>
                                <option value="sturges">Sturges</option>
                                <option value="scott">Scott</option>
                                <option value="fixed">Fixed</option>
                            </select>
                        </div>
                        <div class="stats-subheader">Quantiles</div>
                        <table class="stats-table" id="stats-quantiles-table"></table>
                    </div>
                </div>
                <div class="stats-section collapsible" data-section="frequency">
                    <button class="section-header" type="button" data-target="stats-frequency-section">
                        <span class="codicon codicon-chevron-down"></span>
                        <span>Top Values</span>
                    </button>
                    <div class="section-content" id="stats-frequency-section">
                        <div class="chart-container" id="frequency-chart"></div>
                        <div class="slider-row">
                            <label for="frequency-limit">Show top</label>
                            <input type="range" id="frequency-limit" min="5" max="50" value="10">
                            <input type="number" id="frequency-limit-input" min="5" max="50" value="10">
                        </div>
                        <div class="stats-footnote" id="frequency-footnote"></div>
                    </div>
                </div>
            </div>
        </div>
    </div>
</div>
<div class="modal" id="code-modal">
    <div class="modal-content">
        <div class="modal-header">
            <span>Convert to Code</span>
            <button class="close-btn" id="close-code">&times;</button>
        </div>
        <div class="modal-body">
            <div class="code-section">
                <label for="code-syntax">Syntax</label>
                <select id="code-syntax">
                    <option value="pandas">Python (pandas)</option>
                    <option value="polars">Python (polars)</option>
                    <option value="dplyr">R (dplyr)</option>
                    <option value="data.table">R (data.table)</option>
                </select>
            </div>
            <div class="code-actions">
                <button class="action" id="convert-code">Convert</button>
                <button class="action secondary" id="copy-code">Copy to Clipboard</button>
            </div>
            <pre id="code-preview"></pre>
        </div>
    </div>
</div>
<div class="context-menu" id="column-menu">
    <button class="context-menu-item" id="column-menu-add-filter">Add Filter</button>
    <button class="context-menu-item" id="column-menu-hide-column">Hide Column</button>
</div>
<div class="table-container">
    <div class="table-header" id="table-header"></div>
    <div class="table-body" id="table-body"></div>
</div>

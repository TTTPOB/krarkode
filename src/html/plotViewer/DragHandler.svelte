<script lang="ts">
    let {
        onDragStart,
        onDrag,
        onDragEnd,
    }: {
        onDragStart: () => void;
        onDrag: (height: number) => void;
        onDragEnd: () => void;
    } = $props();

    let dragging = $state(false);

    function handleMouseDown() {
        dragging = true;
        document.body.style.cursor = 'ns-resize';
        onDragStart();
    }

    function handleMouseMove(event: MouseEvent) {
        if (!dragging) {
            return;
        }
        const containerOffsetTop = document.body.offsetTop;
        const pointerRelativeYpos = event.clientY - containerOffsetTop + window.scrollY;
        const toolbarHeight = document.querySelector('.toolbar')?.clientHeight ?? 0;
        const minHeight = 100;
        const newHeight = Math.max(minHeight, pointerRelativeYpos - toolbarHeight - 5);
        onDrag(newHeight);
    }

    function handleMouseUp() {
        if (dragging) {
            dragging = false;
            document.body.style.cursor = '';
            onDragEnd();
        }
    }
</script>

<svelte:window onmousemove={handleMouseMove} onmouseup={handleMouseUp} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
    class="handler"
    class:dragging
    onmousedown={handleMouseDown}
></div>

<style>
    .handler {
        background-color: var(--vscode-textSeparator-foreground);
        height: 4px;
        cursor: ns-resize;
        flex-shrink: 0;
    }

    .handler:hover,
    .handler.dragging {
        background-color: var(--vscode-focusBorder);
        transition: background-color 0.1s ease-out;
        transition-delay: 0.2s;
    }
</style>

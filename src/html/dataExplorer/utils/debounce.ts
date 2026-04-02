/**
 * Reusable debounce utility for scheduling delayed actions with cleanup.
 */
export class Debouncer {
    private id: number | undefined;

    constructor(private readonly delayMs: number) {}

    schedule(fn: () => void): void {
        if (this.id !== undefined) {
            window.clearTimeout(this.id);
        }
        this.id = window.setTimeout(() => {
            this.id = undefined;
            fn();
        }, this.delayMs);
    }

    cancel(): void {
        if (this.id !== undefined) {
            window.clearTimeout(this.id);
            this.id = undefined;
        }
    }
}

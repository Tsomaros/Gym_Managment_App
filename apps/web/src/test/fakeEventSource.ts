type Listener = (e: { data?: string }) => void;

/** A stand-in for EventSource: tests open, fail and feed it by hand. */
export class FakeEventSource {
  static instances: FakeEventSource[] = [];
  static reset(): void {
    FakeEventSource.instances = [];
  }
  static get last(): FakeEventSource {
    return FakeEventSource.instances.at(-1)!;
  }

  closed = false;
  private listeners = new Map<string, Listener[]>();

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, fn: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  removeEventListener(type: string, fn: Listener): void {
    this.listeners.set(
      type,
      (this.listeners.get(type) ?? []).filter((l) => l !== fn),
    );
  }
  close(): void {
    this.closed = true;
  }

  /** The server sent `type`; `data` is JSON-encoded like a real event. */
  emit(type: string, data?: unknown): void {
    if (this.closed) return;
    for (const fn of this.listeners.get(type) ?? []) {
      fn(data === undefined ? {} : { data: JSON.stringify(data) });
    }
  }
}

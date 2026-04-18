import type { Page, Route } from "@playwright/test";

type JsonValue =
  | boolean
  | null
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

async function fulfillJson(route: Route, payload: JsonValue, status = 200) {
  await route.fulfill({
    contentType: "application/json",
    json: payload,
    status,
  });
}

export async function installEventSourceMock(page: Page) {
  await page.addInitScript(() => {
    const eventSourceUrls = [];

    class MockEventSource {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSED = 2;

      readyState = MockEventSource.CONNECTING;
      url;
      withCredentials = false;
      onerror = null;
      onmessage = null;
      onopen = null;
      listeners = new Map();

      constructor(url) {
        this.url = String(url);
        eventSourceUrls.push(this.url);

        setTimeout(() => {
          if (this.readyState === MockEventSource.CLOSED) {
            return;
          }

          this.readyState = MockEventSource.OPEN;
          const openEvent = new Event("open");
          if (typeof this.onopen === "function") {
            this.onopen(openEvent);
          }
          this.emit("open", openEvent);
        }, 0);
      }

      addEventListener(type, listener) {
        const listeners = this.listeners.get(type) ?? [];
        listeners.push(listener);
        this.listeners.set(type, listeners);
      }

      removeEventListener(type, listener) {
        const listeners = this.listeners.get(type) ?? [];
        this.listeners.set(
          type,
          listeners.filter((candidate) => candidate !== listener),
        );
      }

      close() {
        this.readyState = MockEventSource.CLOSED;
      }

      emit(type, event) {
        const listeners = this.listeners.get(type) ?? [];
        listeners.forEach((listener) => {
          if (typeof listener === "function") {
            listener(event);
          } else if (listener && typeof listener.handleEvent === "function") {
            listener.handleEvent(event);
          }
        });
      }
    }

    window.__eventSourceUrls = eventSourceUrls;
    window.EventSource = MockEventSource;
  });
}

export async function getEventSourceUrls(page: Page): Promise<string[]> {
  return page.evaluate(() => window.__eventSourceUrls ?? []);
}

export async function mockJson(page: Page, pattern: string | RegExp, payload: JsonValue) {
  await page.route(pattern, async (route) => {
    await fulfillJson(route, payload);
  });
}

export async function mockJsonHandler(
  page: Page,
  pattern: string | RegExp,
  handler: (route: Route) => Promise<void> | void,
) {
  await page.route(pattern, async (route) => {
    await handler(route);
  });
}

export { fulfillJson };

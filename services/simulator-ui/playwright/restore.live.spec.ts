import { expect, test, type APIRequestContext } from "@playwright/test";

async function waitForProxyReadiness(request: APIRequestContext) {
  await expect
    .poll(async () => {
      const [coreResponse, dataResponse] = await Promise.all([
        request.get("/core/health"),
        request.get("/data/health"),
      ]);
      return {
        core: coreResponse.status(),
        data: dataResponse.status(),
      };
    })
    .toEqual({
      core: 200,
      data: 200,
    });
}

async function waitForRestoreSessionHistory(request: APIRequestContext) {
  await expect
    .poll(async () => {
      const response = await request.get(
        "/core/api/paper/sessions?q=restore-session&limit=20&offset=0",
      );

      if (!response.ok()) {
        return null;
      }

      const payload = (await response.json()) as {
        sessions?: Array<{ session_id: string }>;
      };
      return payload.sessions?.find((session) => session.session_id === "restore-session")
        ?.session_id;
    })
    .toBe("restore-session");
}

test("dashboard and historical routes stay coherent after core restart restore", async ({
  page,
  request,
}) => {
  await waitForProxyReadiness(request);
  await waitForRestoreSessionHistory(request);

  await page.goto("/dashboard");

  await expect(page.getByRole("heading", { name: "Current-session live monitor" })).toBeVisible();
  await expect(page.getByText("restore-session", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("table", { name: "Current positions" }).getByRole("cell", { name: "BTCUSDT" }),
  ).toBeVisible();
  await expect(page.getByText("Recent order flow available")).toBeVisible();

  await page.goto("/sessions?q=restore-session&selected=restore-session");

  await expect(
    page.getByRole("main").getByRole("heading", {
      level: 1,
      name: "Historical review workspace",
    }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "restore-session" })).toBeVisible();
  await page.getByRole("link", { name: "Open selected session" }).click();

  await expect(
    page.getByRole("heading", { name: "Historical detail for restore-session" }),
  ).toBeVisible();
  await expect(page.getByText("No SSE")).toBeVisible();
});

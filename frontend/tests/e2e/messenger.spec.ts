import { expect, test } from "@playwright/test";

const waitForMessenger = async (page: import("@playwright/test").Page) => {
  await expect(page.locator("main.app-canvas")).toHaveAttribute(
    "data-hydrated",
    "true",
  );
};

test.describe("ChatWave messenger", () => {
  test("switches chats and preserves a draft conversation", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name.startsWith("mobile"), "Desktop navigation");
    await page.goto("/");
    await waitForMessenger(page);

    await page.getByRole("button", { name: /Дизайн · core/ }).click();
    await expect(
      page.getByText("Добро пожаловать в Дизайн · core"),
    ).toBeVisible();
    await expect(
      page.getByPlaceholder("Сообщение в Дизайн · core"),
    ).toBeVisible();

    const message = `Проверка навигации ${Date.now()}`;
    await page.getByRole("textbox", { name: "Новое сообщение" }).fill(message);
    await page.getByLabel("Отправить").click();
    await expect(page.locator(".messages-pane").getByText(message)).toBeVisible();

    await page.getByRole("button", { name: /Алексей Ветров/ }).click();
    await expect(page.getByText("Начало диалога с Алексей Ветров")).toBeVisible();
    await page.getByRole("button", { name: /Дизайн · core/ }).click();
    await expect(page.locator(".messages-pane").getByText(message)).toBeVisible();
  });

  test("filters the left menu and changes theme", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.startsWith("mobile"), "Desktop navigation");
    await page.goto("/");
    await waitForMessenger(page);

    await page.getByRole("button", { name: "Команды" }).click();
    const chatList = page.locator(".chat-list");
    await expect(
      chatList.getByRole("button", { name: /Release room/ }),
    ).toBeVisible();
    await expect(
      chatList.getByRole("button", { name: /Алексей Ветров/ }),
    ).toHaveCount(0);

    const canvas = page.locator("main.app-canvas");
    await expect(canvas).toHaveAttribute("data-theme", "dark");
    await page.getByRole("button", { name: "Сменить тему" }).click();
    await expect(canvas).toHaveAttribute("data-theme", "light");
  });

  test("opens and closes mobile chat navigation", async ({ page }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith("mobile"), "Mobile-only check");
    await page.goto("/");
    await waitForMessenger(page);

    await page.getByRole("button", { name: "Открыть список чатов" }).click();
    await expect(page.locator(".chat-sidebar")).toHaveClass(/mobile-open/);
    await page.getByRole("button", { name: "Закрыть список чатов" }).click();
    await expect(page.locator(".chat-sidebar")).not.toHaveClass(/mobile-open/);
  });
});

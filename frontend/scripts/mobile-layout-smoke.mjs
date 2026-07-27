import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";

const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
const uiStateSource = await readFile(
  new URL("../app/hooks/use-ui-state.ts", import.meta.url),
  "utf8",
);
const pageSource = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

assert.match(
  uiStateSource,
  /const \[detailsOpen, setDetailsOpen\] = useState\(false\)/,
);
assert.match(
  pageSource,
  /setAddMembersOpen\(false\);\s+setDetailsOpen\(false\);/,
);

const browser = await chromium.launch({ channel: "chrome", headless: true });

try {
  for (const { width, height, name } of [
    { width: 320, height: 780, name: "compact-320" },
    { width: 375, height: 812, name: "iphone-13-mini" },
    { width: 390, height: 780, name: "mobile-390" },
    { width: 430, height: 780, name: "mobile-430" },
    { width: 720, height: 780, name: "mobile-720" },
  ]) {
    const page = await browser.newPage({
      viewport: { width, height },
      deviceScaleFactor: 1,
      isMobile: true,
      hasTouch: true,
    });
    await page.setContent(`
      <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
      <style>${css}</style>
      <main class="app-canvas" data-theme="dark">
        <section class="messenger-shell">
          <aside class="chat-sidebar mobile-open">
            <header class="sidebar-header">
              <img class="sidebar-brand-logo" alt="ChatWave" />
              <div class="sidebar-header-actions">
                <button class="sidebar-profile-avatar">CW</button>
                <button class="icon-button">+</button>
              </div>
            </header>
            <div class="search-box"><input placeholder="Поиск" /></div>
            <div class="chat-filters"><button class="active">Все</button><button>Непрочитанные</button></div>
            <div class="chat-list">
              <div class="chat-row active">
                <button class="chat-row-main">
                  <span class="avatar">CW</span>
                  <span class="chat-copy"><span class="chat-title-row"><strong>ChatWave</strong></span><span class="chat-preview-row">Последнее сообщение</span></span>
                </button>
              </div>
            </div>
          </aside>
          <section class="conversation">
            <header class="conversation-header">
              <button class="mobile-menu">←</button>
              <div class="conversation-identity"><strong>Тестовый чат</strong></div>
              <div class="header-actions"><button class="icon-button">☎</button><button class="icon-button">⌕</button><button class="icon-button">ⓘ</button></div>
            </header>
            <div class="conversation-content">
              <div class="messages-pane">
                <div class="messages-scroll">
                  <article class="message group-start">
                    <span class="avatar">CW</span>
                    <div class="message-body"><div class="message-meta"><strong>ChatWave</strong><time>12:00</time></div><p>Проверка мобильного сообщения без горизонтального переполнения.</p></div>
                    <button class="mobile-message-more">•••</button>
                    <div class="message-actions"><button>☺</button><button>↩</button></div>
                  </article>
                </div>
                <div class="composer"><div class="composer-field"><input aria-label="Новое сообщение" /><span><button>☺</button></span></div><button class="send-button">➤</button></div>
              </div>
            </div>
          </section>
        </section>
      </main>
    `);

    const sidebar = page.locator(".chat-sidebar");
    const sidebarBox = await sidebar.boundingBox();
    assert.equal(Math.round(sidebarBox?.width ?? 0), width);
    assert.equal(Math.round(sidebarBox?.x ?? -1), 0);
    assert.equal(
      await page.locator(".composer-field input").evaluate(
        (element) => getComputedStyle(element).fontSize,
      ),
      "16px",
    );

    await sidebar.evaluate((element) => element.classList.remove("mobile-open"));
    await page.waitForTimeout(260);
    const layout = await page.evaluate(() => ({
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      conversationWidth:
        document.querySelector(".conversation")?.getBoundingClientRect().width,
      composerBottom:
        document.querySelector(".composer")?.getBoundingClientRect().bottom,
      viewportHeight: window.innerHeight,
    }));
    assert.ok(layout.documentWidth <= layout.viewportWidth);
    assert.equal(Math.round(layout.conversationWidth ?? 0), width);
    assert.ok((layout.composerBottom ?? 0) <= layout.viewportHeight);

    if (name === "iphone-13-mini") {
      const compactLayout = await page.evaluate(() => ({
        headerHeight:
          document.querySelector(".conversation-header")?.getBoundingClientRect()
            .height ?? Number.POSITIVE_INFINITY,
        messageFontSize: Number.parseFloat(
          getComputedStyle(document.querySelector(".message-body p")).fontSize,
        ),
        composerHeight:
          document.querySelector(".composer")?.getBoundingClientRect().height ??
          Number.POSITIVE_INFINITY,
        headerActionsRight:
          document.querySelector(".header-actions")?.getBoundingClientRect()
            .right ?? Number.POSITIVE_INFINITY,
        headerActionsWidth:
          document.querySelector(".header-actions")?.getBoundingClientRect()
            .width ?? Number.POSITIVE_INFINITY,
      }));
      assert.ok(compactLayout.headerHeight >= 88);
      assert.ok(compactLayout.headerHeight <= 96);
      assert.ok(compactLayout.messageFontSize <= 15);
      assert.ok(compactLayout.composerHeight <= 49);
      assert.ok(compactLayout.headerActionsRight <= width);
      assert.ok(compactLayout.headerActionsWidth <= 110);
    }

    await page.locator(".message-actions").evaluate((element) =>
      element.classList.add("mobile-open"),
    );
    assert.equal(
      await page.locator(".message-actions").evaluate(
        (element) => getComputedStyle(element).pointerEvents,
      ),
      "auto",
    );

    await page.locator(".conversation-content").evaluate((element) => {
      element.insertAdjacentHTML(
        "beforeend",
        '<aside class="details-panel open"><div class="details-head"><strong>Информация</strong><button>×</button></div></aside>',
      );
    });
    assert.equal(
      Math.round(
        (await page.locator(".details-panel.open").boundingBox())?.width ?? 0,
      ),
      width,
    );
    await page
      .locator(".details-panel.open")
      .evaluate((element) => element.remove());

    await page.locator("body").evaluate((element) => {
      element.insertAdjacentHTML(
        "beforeend",
        `<div class="call-backdrop">
          <section class="call-window video-call">
            <div class="call-copy"><span>Активный звонок</span><h2>ChatWave</h2></div>
            <div class="call-controls">
              ${Array.from({ length: 8 }, (_, index) => `<button class="call-button neutral"><span>${index + 1}</span></button>`).join("")}
            </div>
          </section>
        </div>`,
      );
    });
    const callLayout = await page.evaluate(() => {
      const callWindow = document.querySelector(".call-window");
      const controls = document.querySelector(".call-controls");
      const callRect = callWindow?.getBoundingClientRect();
      const controlsRect = controls?.getBoundingClientRect();
      return {
        callLeft: callRect?.left ?? -1,
        callRight: callRect?.right ?? Number.POSITIVE_INFINITY,
        controlsLeft: controlsRect?.left ?? -1,
        controlsRight: controlsRect?.right ?? Number.POSITIVE_INFINITY,
        controlsOverflowX: controls
          ? getComputedStyle(controls).overflowX
          : "",
      };
    });
    assert.ok(callLayout.callLeft >= 0 && callLayout.callRight <= width);
    assert.ok(
      callLayout.controlsLeft >= 0 && callLayout.controlsRight <= width,
    );
    const usesCompactPhoneLayout = width <= 390 && height <= 850;
    assert.equal(
      callLayout.controlsOverflowX,
      usesCompactPhoneLayout ? "visible" : "auto",
    );

    if (name === "iphone-13-mini") {
      await page
        .locator(".call-backdrop")
        .evaluate((element) => element.remove());
      await page.screenshot({
        path: "/tmp/chatwave-iphone-13-mini-layout.png",
        fullPage: false,
      });
    }
    await page.close();
  }
} finally {
  await browser.close();
}

console.log(
  "Mobile layout smoke passed for iPhone 13 mini and 320–720 px widths.",
);

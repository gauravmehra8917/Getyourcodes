/**
 * Frontend-only browser regression suite. Uses the existing Playwright runtime
 * and installed Chrome; no package installation is performed.
 * Run: PLAYWRIGHT_MODULE=/path/to/playwright node tests/mobile-frontend.mjs
 * Optional: M1_QA_DIR, M1_APP_PORT, M1_FIXTURE_PORT, BROWSER_EXECUTABLE.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { startFixtureServer, code } from "./mobile-fixtures.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = process.env.M1_REPO_ROOT || join(dirname(fileURLToPath(import.meta.url)), "..");
const output = process.env.M1_QA_DIR || join(tmpdir(), "getyourcodes-mobile-m1-qa");
const appPort = Number(process.env.M1_APP_PORT || 4317);
const fixturePort = Number(process.env.M1_FIXTURE_PORT || 4318);
const origin = `http://127.0.0.1:${appPort}`;
const fixtureOrigin = `http://127.0.0.1:${fixturePort}`;
const viewports = [
  [320, 568],
  [360, 740],
  [390, 844],
  [428, 926],
  [768, 1024],
  [1280, 800],
];
const routes = [
  "/",
  "/coupons",
  "/deals",
  "/stores",
  "/categories",
  "/search?q=fashion",
  "/loragal-coupons",
  "/fashion-offers",
];
await mkdir(output, { recursive: true });
const { server, writes } = await startFixtureServer(fixturePort);
const vite = spawn(
  process.execPath,
  [
    join(root, "node_modules/vite/bin/vite.js"),
    "--host",
    "127.0.0.1",
    "--port",
    String(appPort),
    "--strictPort",
  ],
  {
    cwd: root,
    env: {
      ...process.env,
      VITE_SUPABASE_URL: fixtureOrigin,
      VITE_SUPABASE_PUBLISHABLE_KEY: "qa-publishable",
      SUPABASE_URL: fixtureOrigin,
      SUPABASE_PUBLISHABLE_KEY: "qa-publishable",
    },
  },
);
let viteLog = "";
vite.stdout.on("data", (data) => {
  viteLog += data;
});
vite.stderr.on("data", (data) => {
  viteLog += data;
});
const matrix = [];
const interactions = [];
const errors = [];
const hydrationWarnings = [];
const dateCases = [];
const resizeCases = [];
let modalWaitSequence = 0;
let suiteStatus = "FAIL";
let browser;
let activePage;

function observeRuntime(page) {
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (
      ["error", "warning"].includes(message.type()) &&
      /hydrat|server rendered.*match/i.test(message.text())
    ) {
      hydrationWarnings.push(message.text());
    }
  });
}

async function isolate(context) {
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (
      url.origin === origin ||
      url.origin === fixtureOrigin ||
      url.protocol === "data:" ||
      (["fonts.googleapis.com", "fonts.gstatic.com"].includes(url.hostname) &&
        route.request().method() === "GET")
    )
      return route.continue();
    return route.abort();
  });
}

async function modalGeometry(dialog) {
  return dialog.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return {
      viewport: { width: innerWidth, height: innerHeight, visualHeight: visualViewport?.height },
      rect: { x: r.x, y: r.y, width: r.width, height: r.height, bottom: r.bottom },
      clientHeight: el.clientHeight,
      scrollHeight: el.scrollHeight,
      maxHeight: style.maxHeight,
      animations: el.getAnimations().map((animation) => ({
        kind: animation.constructor.name,
        property: animation.transitionProperty,
        state: animation.playState,
      })),
    };
  });
}

async function waitForStableModal(page, viewport) {
  const token = ++modalWaitSequence;
  await page.waitForFunction(
    ({ width, height, token }) => {
      const modal = document.querySelector('[role="dialog"]');
      if (!modal || innerWidth !== width || innerHeight !== height) return false;
      const r = modal.getBoundingClientRect();
      const style = getComputedStyle(modal);
      const key = JSON.stringify([
        r.x,
        r.y,
        r.width,
        r.height,
        style.maxHeight,
        modal.scrollHeight,
        visualViewport?.height,
      ]);
      const previous = window.__m1ModalStability;
      const idle = modal.getAnimations().every((animation) => animation.playState !== "running");
      const frames =
        previous?.token === token && previous.key === key && idle ? previous.frames + 1 : 0;
      window.__m1ModalStability = { token, key, frames };
      return idle && frames >= 3;
    },
    { ...viewport, token },
    { polling: "raf", timeout: 5000 },
  );
}

async function renderedExpiryDates(page, html) {
  if (html !== undefined) {
    return page.evaluate((source) => {
      const doc = new DOMParser().parseFromString(source, "text/html");
      const roots = [
        doc,
        ...[...doc.querySelectorAll("template")].map((template) => template.content),
      ];
      return roots.flatMap((root) =>
        [...root.querySelectorAll("article[id]")].map((card) => ({
          id: card.id,
          date: [...card.querySelectorAll("span")]
            .find((span) => span.textContent.trim().startsWith("Expires "))
            ?.textContent.trim(),
        })),
      );
    }, html);
  }
  return page.locator("main article[id]").evaluateAll((cards) =>
    cards.map((card) => ({
      id: card.id,
      date: [...card.querySelectorAll("span")]
        .find((span) => span.textContent.trim().startsWith("Expires "))
        ?.textContent.trim(),
    })),
  );
}

async function dateChecks() {
  for (const [locale, timezoneId] of [
    ["en-US", "UTC"],
    ["en-GB", "Europe/London"],
    ["hi-IN", "Asia/Kolkata"],
    ["ja-JP", "Asia/Tokyo"],
    ["en-US", "America/Los_Angeles"],
    ["fr-FR", "Pacific/Kiritimati"],
  ]) {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      locale,
      timezoneId,
      reducedMotion: "reduce",
    });
    await isolate(context);
    const page = await context.newPage();
    activePage = page;
    observeRuntime(page);
    const response = await page.goto(origin + "/loragal-coupons");
    const html = await response.text();
    await page.waitForLoadState("networkidle");
    const serverDates = await renderedExpiryDates(page, html);
    const clientDates = await renderedExpiryDates(page);
    assert.ok(serverDates.length > 0, "The server must actually render expiry dates");
    assert.deepEqual(clientDates, serverDates, "SSR and hydrated dates must match exactly");
    assert.ok(
      clientDates.every(({ date }) => date === "Expires Dec 31, 2035"),
      "Expiry day must remain Dec 31 in UTC, including timezones west of UTC",
    );
    const trigger = page.getByRole("button", { name: "Get Code", exact: true }).first();
    await trigger.click();
    assert.equal(
      await page.getByRole("dialog").getByText("Valid until Dec 31, 2035", { exact: true }).count(),
      1,
    );
    await page.keyboard.press("Escape");
    dateCases.push({ locale, timezoneId, serverDates, clientDates, result: "PASS" });
    await context.close();
  }
  console.log(
    `PASS ${dateCases.length} deterministic-date cases: exact SSR/client equality across locales and timezones`,
  );
}

async function shortHeightChecks() {
  for (const width of [390, 320]) {
    for (const theme of ["dark", "light"]) {
      const context = await browser.newContext({ viewport: { width, height: 844 } });
      await isolate(context);
      await context.addInitScript((theme) => localStorage.setItem("gyc-theme", theme), theme);
      const page = await context.newPage();
      activePage = page;
      observeRuntime(page);
      await page.goto(origin + "/coupons");
      await page.waitForLoadState("networkidle");
      const trigger = page.getByRole("button", { name: "Get Code", exact: true }).first();
      await trigger.click();
      const dialog = page.getByRole("dialog");
      await page.evaluate(() => {
        navigator.clipboard.writeText = async () => {
          throw new DOMException("Denied for QA", "NotAllowedError");
        };
        document.execCommand = () => false;
      });
      await dialog.getByRole("button", { name: "Copy", exact: true }).click();
      await dialog.getByRole("alert").waitFor();
      assert.equal(await page.evaluate(() => getSelection().toString()), code);
      await waitForStableModal(page, { width, height: 844 });
      const before = await modalGeometry(dialog);
      await page.setViewportSize({ width, height: 360 });
      const immediate = await modalGeometry(dialog);
      await waitForStableModal(page, { width, height: 360 });
      const stable = await modalGeometry(dialog);
      await modalFits(page, { width, height: 360 });
      assert.ok(
        stable.scrollHeight > stable.clientHeight,
        "Short popup must have internal scrolling",
      );
      assert.equal(
        await dialog.locator(".select-text").evaluate((el) => getComputedStyle(el).userSelect),
        "text",
      );
      const copy = dialog.getByRole("button", { name: "Copy", exact: true });
      await usable(copy);
      await copy.focus();
      await page.keyboard.press("Enter");
      assert.equal(await page.evaluate(() => getSelection().toString()), code);
      await page.screenshot({ path: join(output, `popup-short-${width}-${theme}.png`) });
      const summary = dialog.locator("summary");
      await summary.focus();
      await page.keyboard.press("Enter");
      assert.equal(await dialog.locator("details").getAttribute("open"), "");
      const continuation = dialog.getByRole("link", { name: /Continue to/ });
      await usable(continuation);
      assert.equal(await continuation.getAttribute("href"), "https://affiliate.example.test/offer");
      await continuation.focus();
      await page.screenshot({ path: join(output, `popup-short-continue-${width}-${theme}.png`) });
      const topClose = dialog.getByRole("button", { name: "Close", exact: true }).last();
      await usable(topClose);
      await topClose.focus();
      for (let i = 0; i < 8; i++) {
        await page.keyboard.press("Tab");
        assert.equal(await dialog.evaluate((el) => el.contains(document.activeElement)), true);
      }
      const footerClose = dialog.getByRole("button", { name: "Close", exact: true }).first();
      await usable(footerClose);
      await footerClose.focus();
      await page.keyboard.press("Enter");
      await dialog.waitFor({ state: "hidden" });
      assert.equal(await trigger.evaluate((el) => el === document.activeElement), true);
      await trigger.click();
      await waitForStableModal(page, { width, height: 360 });
      await modalFits(page, { width, height: 360 });
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "hidden" });
      resizeCases.push({ width, height: 360, theme, before, immediate, stable, result: "PASS" });
      await context.close();
    }
  }
  console.log(
    `PASS ${resizeCases.length} short-height cases: 390x360 and 320x360 in both themes, Copy/Continue/Close and keyboard navigation`,
  );
}

async function usable(locator) {
  await locator.scrollIntoViewIfNeeded();
  assert.equal(await locator.isVisible(), true);
  assert.equal(
    await locator.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return !!hit && (el === hit || el.contains(hit));
    }),
    true,
    "Control must be reachable without an overlay",
  );
}

async function modalFits(page, viewport) {
  const dialog = page.getByRole("dialog");
  await dialog.waitFor();
  const rect = await dialog.boundingBox();
  assert.ok(
    rect.x >= -1 &&
      rect.y >= -1 &&
      rect.x + rect.width <= viewport.width + 1 &&
      rect.y + rect.height <= viewport.height + 1,
    "Dialog must fit the visible viewport",
  );
  assert.equal(
    await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    true,
    "Dialog content must not overflow horizontally",
  );
  return dialog;
}

async function popupChecks(page, viewport, theme) {
  const trigger = page.getByRole("button", { name: "Get Code", exact: true }).first();
  await usable(trigger);
  await trigger.click();
  const dialog = await modalFits(page, viewport);
  const copy = dialog.getByRole("button", { name: "Copy", exact: true });
  await usable(copy);
  assert.ok((await copy.boundingBox()).height >= 44);
  assert.equal(
    await page.evaluate(() => window.top === window.self),
    true,
    "Clipboard QA runs in a standalone page",
  );
  await copy.click();
  await dialog.getByRole("button", { name: "Copied", exact: true }).waitFor();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), code);
  assert.deepEqual(await dialog.locator("dt").allTextContents(), [
    "Minimum purchase",
    "Offer eligibility",
  ]);
  assert.match(await dialog.locator("dd").first().textContent(), /100/);
  assert.equal(
    await dialog.locator("dd").last().textContent(),
    "Selected product categories (not specified)",
  );
  await dialog.locator("summary").click();
  assert.ok(
    await dialog.evaluate((el) => el.scrollHeight > el.clientHeight),
    "Long terms must scroll inside the popup",
  );
  const continuation = dialog.getByRole("link", { name: /Continue to/ });
  await usable(continuation);
  assert.equal(await continuation.getAttribute("href"), "https://affiliate.example.test/offer");
  await continuation.click();
  assert.equal(
    await page.evaluate(() => window.__m1AffiliateClicks.at(-1)),
    "https://affiliate.example.test/offer",
  );
  await dialog.waitFor({ state: "hidden" });
  await trigger.click();
  const reopened = await modalFits(page, viewport);
  await reopened.getByRole("button", { name: "Close", exact: true }).last().focus();
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press("Tab");
    assert.equal(
      await reopened.evaluate((el) => el.contains(document.activeElement)),
      true,
      "Popup focus must remain trapped",
    );
  }
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Close", exact: true })
    .first()
    .click();
  await reopened.waitFor({ state: "hidden" });
  assert.equal(
    await trigger.evaluate((el) => el === document.activeElement),
    true,
    "Close must restore trigger focus",
  );
  await trigger.click();
  await page.getByRole("dialog").waitFor();
  await page.screenshot({ path: join(output, `popup-${viewport.width}-${theme}.png`) });
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  interactions.push({
    viewport,
    theme,
    popup: "PASS",
    clipboard: "PASS (standalone Chrome, granted permissions)",
    termsAndClose: "PASS",
    affiliate: "mocked",
  });
}

async function navigationChecks(page, viewport, theme) {
  await page.evaluate(() => window.scrollTo(0, 0));
  if (viewport.width < 768) {
    const toggle = page.getByRole("button", { name: "Open menu", exact: true });
    await usable(toggle);
    await toggle.click();
    const nav = page.getByRole("navigation", { name: "Mobile navigation", exact: true });
    assert.deepEqual(await nav.getByRole("link").allTextContents(), [
      "Home",
      "Categories",
      "Stores",
      "Coupons",
      "Deals",
      "Blog",
    ]);
    const search = page.locator("#site-mobile-menu input");
    await usable(search);
    await search.focus();
    await page.keyboard.press("Escape");
    await nav.waitFor({ state: "hidden" });
    assert.equal(await toggle.evaluate((el) => el === document.activeElement), true);
    await toggle.click();
    await page
      .locator("#site-mobile-menu")
      .getByRole("button", { name: "Ask Dealio", exact: true })
      .click();
  } else {
    assert.equal(
      await page.getByRole("navigation", { name: "Primary navigation", exact: true }).isVisible(),
      true,
    );
    await page.getByRole("button", { name: "Ask Dealio AI assistant", exact: true }).click();
  }
  const assistant = await modalFits(page, viewport);
  await assistant.getByText("Sign in to chat with Dealio", { exact: true }).waitFor();
  await usable(assistant.getByRole("button", { name: "Close", exact: true }));
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press("Tab");
    assert.equal(await assistant.evaluate((el) => el.contains(document.activeElement)), true);
  }
  await page.keyboard.press("Escape");
  await assistant.waitFor({ state: "hidden" });
  await page.waitForFunction(
    () =>
      document.activeElement?.getAttribute("aria-controls") === "site-mobile-menu" ||
      document.activeElement?.getAttribute("aria-label") === "Ask Dealio AI assistant",
  );
  assert.equal(await page.evaluate(() => document.body.style.overflow !== "hidden"), true);
  if (viewport.width < 1024)
    assert.equal(
      await page.locator('button[aria-label^="Open Ask Dealio"]').isVisible(),
      false,
      "Floating Dealio must not cover phone or tablet controls",
    );
  await usable(page.locator("header").getByRole("link", { name: "Sign in", exact: true }));
  interactions.push({
    viewport,
    theme,
    navigation: "PASS",
    assistant: "PASS (signed out, focus, Escape, scroll unlock)",
  });
}

try {
  let ready = false;
  for (let attempt = 0; attempt < 90; attempt++) {
    if (vite.exitCode !== null) throw new Error(`Vite exited early: ${viteLog}`);
    try {
      if ((await fetch(origin)).ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  assert.ok(ready, "Local server must start");
  browser = await chromium.launch(
    process.env.BROWSER_EXECUTABLE
      ? { executablePath: process.env.BROWSER_EXECUTABLE, headless: true }
      : { channel: "chrome", headless: true },
  );
  await dateChecks();
  for (const [width, height] of viewports) {
    const viewport = { width, height };
    const context = await browser.newContext({
      viewport,
      reducedMotion: "reduce",
      isMobile: width < 768,
      hasTouch: width < 768,
    });
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin });
    await context.route("**/*", (route) => {
      const url = new URL(route.request().url());
      if (
        url.origin === origin ||
        url.origin === fixtureOrigin ||
        url.protocol === "data:" ||
        (["fonts.googleapis.com", "fonts.gstatic.com"].includes(url.hostname) &&
          route.request().method() === "GET")
      )
        return route.continue();
      return route.abort();
    });
    await context.addInitScript(() => {
      window.__m1Opened = [];
      window.__m1AffiliateClicks = [];
      window.open = (...args) => {
        window.__m1Opened.push(args);
        return null;
      };
      document.addEventListener(
        "click",
        (event) => {
          const anchor = event.target.closest?.("a[href]");
          if (anchor && new URL(anchor.href).hostname.endsWith(".example.test")) {
            event.preventDefault();
            window.__m1AffiliateClicks.push(anchor.href);
          }
        },
        true,
      );
    });
    const page = await context.newPage();
    activePage = page;
    observeRuntime(page);
    for (const theme of ["dark", "light"]) {
      await page.goto(origin);
      await page.locator("main article[id]").first().waitFor();
      await page.waitForLoadState("networkidle");
      const toggle = page.getByRole("button", { name: `Switch to ${theme} theme`, exact: true });
      if (await toggle.count()) await toggle.click();
      await page.waitForFunction(
        (light) => document.documentElement.classList.contains("theme-light") === light,
        theme === "light",
      );
      for (const path of routes) {
        const response = await page.goto(origin + path);
        const serverHtml = path === "/loragal-coupons" ? await response.text() : undefined;
        await page
          .locator('main article, main a[href$="-coupons"], main a[href$="-offers"]')
          .first()
          .waitFor();
        await page.waitForLoadState("networkidle");
        await page.evaluate(() => document.fonts.ready);
        await page.waitForFunction(
          (light) => document.documentElement.classList.contains("theme-light") === light,
          theme === "light",
        );
        if (serverHtml !== undefined) {
          const serverDates = await renderedExpiryDates(page, serverHtml);
          assert.ok(serverDates.length > 0);
          assert.deepEqual(await renderedExpiryDates(page), serverDates);
        }
        const layout = await page.evaluate(() => ({
          fontLoaded: [...document.fonts].some(
            (font) => font.family.includes("Plus Jakarta Sans") && font.status === "loaded",
          ),
          documentWidth: document.documentElement.scrollWidth,
          viewportWidth: innerWidth,
          badCards: [...document.querySelectorAll("main article[id]")]
            .filter((el) => {
              const r = el.getBoundingClientRect();
              const parent = el.parentElement.getBoundingClientRect();
              return (
                r.width > parent.width + 1 ||
                r.left < parent.left - 1 ||
                r.right > parent.right + 1 ||
                el.scrollWidth > el.clientWidth + 1
              );
            })
            .map((el) => el.id),
        }));
        assert.ok(
          layout.documentWidth <= width + 1,
          `${path} ${width} ${theme}: document overflow ${layout.documentWidth}`,
        );
        assert.deepEqual(layout.badCards, [], `${path}: cards must fit their containers`);
        assert.equal(
          await page.evaluate(() => document.documentElement.classList.contains("theme-light")),
          theme === "light",
        );
        for (const action of (await page.locator("main article[id] button").all()).slice(0, 3))
          await usable(action);
        const pagination = page.getByRole("navigation", { name: "Pagination", exact: true });
        if (await pagination.count()) {
          const next = pagination.getByRole("link", { name: "Next", exact: true });
          await usable(next);
          assert.ok((await next.getAttribute("href")).includes("page=2"));
        }
        if (path === "/") {
          const featured = page.getByRole("heading", { name: "Featured Deals", exact: true });
          await featured.scrollIntoViewIfNeeded();
          const card = page.locator(".coupon-row").first();
          const title = card.locator("h3");
          assert.equal(await title.evaluate((el) => getComputedStyle(el).whiteSpace), "normal");
          const rowAction = await card.getByRole("button").boundingBox();
          const titleRect = await title.boundingBox();
          if (width < 640)
            assert.ok(
              rowAction.y >= titleRect.y + titleRect.height,
              "Phone CTA belongs below the offer",
            );
          if (width === 1280)
            assert.ok(rowAction.x > titleRect.x, "Desktop retains the horizontal card hierarchy");
          await page.screenshot({ path: join(output, `featured-${width}-${theme}.png`) });
          await card.screenshot({ path: join(output, `featured-card-${width}-${theme}.png`) });
        }
        if (path === "/categories") {
          assert.equal(
            await page
              .locator('main a[href$="-offers"] span.font-semibold')
              .first()
              .evaluate((el) => getComputedStyle(el).textOverflow),
            "clip",
          );
          if (width === 320)
            await page.screenshot({ path: join(output, `categories-${width}-${theme}.png`) });
        }
        if (path === "/coupons") {
          await popupChecks(page, viewport, theme);
          const warning = page.getByRole("status").filter({ hasText: "Verify discount" }).first();
          await warning.waitFor();
          assert.equal(await warning.count(), 1);
        }
        if (path === "/deals") {
          await page.getByRole("button", { name: "Get Deal", exact: true }).first().click();
          assert.equal(
            await page.evaluate(() => window.__m1Opened[0][0]),
            "https://affiliate.example.test/offer",
          );
          assert.equal(await page.getByRole("dialog").count(), 0);
        }
        matrix.push({ viewport, theme, path, ...layout, result: "PASS" });
      }
      await navigationChecks(page, viewport, theme);
    }
    await context.close();
    console.log(`PASS ${width}x${height}: 8 routes in light/dark, popup, navigation, assistant`);
  }
  const denialContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await denialContext.route("**/*", (route) => {
    const url = new URL(route.request().url());
    return url.origin === origin || url.origin === fixtureOrigin ? route.continue() : route.abort();
  });
  const denial = await denialContext.newPage();
  observeRuntime(denial);
  activePage = denial;
  await denial.goto(origin + "/coupons");
  await denial.getByRole("button", { name: "Get Code", exact: true }).first().click();
  await denial.evaluate(() => {
    navigator.clipboard.writeText = async () => {
      throw new DOMException("Denied for QA", "NotAllowedError");
    };
    document.execCommand = () => false;
  });
  await denial.getByRole("button", { name: "Copy", exact: true }).click();
  await denial.getByRole("alert").waitFor();
  assert.equal(await denial.getByRole("button", { name: "Copied", exact: true }).count(), 0);
  assert.equal(await denial.evaluate(() => getSelection().toString()), code);
  await denial.setViewportSize({ width: 390, height: 360 });
  await waitForStableModal(denial, { width: 390, height: 360 });
  await modalFits(denial, { width: 390, height: 360 });
  await usable(denial.getByRole("button", { name: "Close", exact: true }).first());
  await denial.keyboard.press("Escape");
  await denialContext.close();
  interactions.push({
    clipboardDenial: "PASS (simulated denial, accurate failure and selected code)",
    reducedViewport: "PASS 390x360",
  });
  await shortHeightChecks();
  assert.deepEqual(errors, [], "No browser runtime errors");
  assert.deepEqual(hydrationWarnings, [], "No browser hydration warnings");
  assert.ok(
    writes.some((row) => row.path === "/rest/v1/coupon_clicks"),
    "Affiliate analytics must reach only the fixture",
  );
  assert.ok(
    writes.every((row) => row.path.startsWith("/rest/v1/")),
    "Only fixture writes are permitted",
  );
  console.log(
    `PASS ${matrix.length} layout cases; ${interactions.length} interaction groups; all analytics and affiliates mocked`,
  );
  suiteStatus = "PASS";
} catch (error) {
  if (activePage && !activePage.isClosed())
    await activePage.screenshot({ path: join(output, "failure.png") }).catch(() => {});
  throw error;
} finally {
  await writeFile(
    join(output, "browser-results.json"),
    JSON.stringify(
      {
        suiteStatus,
        matrix,
        interactions,
        dateCases,
        resizeCases,
        errors,
        hydrationWarnings,
        mockedWrites: writes,
      },
      null,
      2,
    ) + "\n",
  );
  await writeFile(join(output, "vite-qa.log"), viteLog);
  await browser?.close();
  vite.kill("SIGTERM");
  await new Promise((resolve) => server.close(resolve));
}

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

type Element = { type: unknown; props: Record<string, unknown> };
type NavProps = { mobile?: boolean; onNavigate?: () => void };

const expectedGroups = [
  { title: "Overview", labels: ["Dashboard", "Reports", "Activity Log"] },
  { title: "Catalog", labels: ["Coupons", "Categories", "Stores"] },
  { title: "Content", labels: ["Posts", "Blog Categories"] },
  { title: "Audience", labels: ["Users", "Subscribers", "Newsletters"] },
  { title: "System", labels: ["Head Manager", "API Integrations", "Publishing Policies"] },
];
const hiddenItems = [
  ["Sub Categories", "/admin/subcategories"],
  ["Store Reviews", "/admin/reviews"],
  ["Comments", "/admin/comments"],
  ["Pages", "/admin/pages"],
  ["Sliders", "/admin/sliders"],
  ["Ads", "/admin/ads"],
  ["Menus", "/admin/menus"],
  ["Translations", "/admin/translations"],
  ["Theme", "/admin/theme"],
  ["Email Templates", "/admin/etemplates"],
  ["Settings", "/admin/settings"],
];

function elements(node: unknown): Element[] {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return Array.from(node).flatMap(elements);
  const element = node as Element;
  return [element, ...elements(element.props?.children)];
}

// Match the existing node:test component convention: real code with mocked hooks and JSX.
function loadComponent<T>(file: string, mocks: Record<string, unknown>): T {
  const source = readFileSync(new URL(file, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  });
  const exports = {};
  const jsx = (type: unknown, props: Element["props"]) => ({ type, props });
  const modules = { "react/jsx-runtime": { jsx, jsxs: jsx }, "lucide-react": {}, ...mocks };
  runInNewContext(outputText, {
    exports,
    require(id: string) {
      assert.ok(Object.hasOwn(modules, id), `Unexpected import: ${id}`);
      return modules[id as keyof typeof modules];
    },
  });
  return exports as T;
}

function harness(pathname = "/admin") {
  let menuOpen = false;
  const router = {
    Link: "router-link",
    useRouterState: ({ select }: { select: (state: unknown) => unknown }) =>
      select({ location: { pathname } }),
    useNavigate: () => () => {},
  };
  const sidebar = loadComponent<{
    AdminNavContent: (props: NavProps) => Element;
    AdminSidebar: () => Element;
  }>("./sidebar.tsx", {
    "@tanstack/react-router": router,
    "@/lib/seo": { SITE_URL: "https://example.test/", SITE_NAME: "Getyourcodes" },
  });
  const { AdminTopbar } = loadComponent<{ AdminTopbar: (props: object) => Element }>(
    "./topbar.tsx",
    {
      react: {
        useEffect: () => {},
        useState: () => [menuOpen, (open: boolean) => (menuOpen = open)],
      },
      "@tanstack/react-router": router,
      "@/integrations/supabase/client": {},
      "@/components/admin/sidebar": sidebar,
      "@/components/ui/sheet": {
        Sheet: "Sheet",
        SheetContent: "SheetContent",
        SheetDescription: "SheetDescription",
        SheetTitle: "SheetTitle",
        SheetTrigger: "SheetTrigger",
      },
    },
  );
  const topbar = AdminTopbar({});
  const sheet = elements(topbar).find((node) => node.type === "Sheet")!;
  const content = elements(topbar).find((node) => node.type === "SheetContent")!;
  return {
    render(mobile: boolean) {
      const container = mobile ? content : sidebar.AdminSidebar();
      const nav = elements(container).filter((node) => node.type === sidebar.AdminNavContent);
      assert.equal(nav.length, 1, "desktop and mobile must each use the shared AdminNavContent");
      assert.equal(nav[0].props.mobile === true, mobile);
      return sidebar.AdminNavContent(nav[0].props as NavProps);
    },
    openMenu: () => (sheet.props.onOpenChange as (open: boolean) => void)(true),
    menuOpen: () => menuOpen,
  };
}

function links(tree: Element) {
  return elements(tree).filter((node) => node.type === "router-link");
}

test("desktop and mobile share exactly the five production groups and 14 visible items", () => {
  const fixture = harness();
  for (const mobile of [false, true]) {
    const tree = fixture.render(mobile);
    const nav = elements(tree).find((node) => node.type === "nav")!;
    const groups = Array.from(nav.props.children as Element[]).map((group) => ({
      title: (group.props.children as Element[])[0].props.children,
      labels: links(group).map(
        (link) => elements(link).find((node) => node.type === "span")!.props.children,
      ),
    }));
    assert.deepEqual(groups, expectedGroups);
    assert.equal(links(tree).length, 14);
    for (const [label, route] of hiddenItems) {
      assert.ok(!groups.some((group) => group.labels.includes(label)), `${label} must be hidden`);
      assert.ok(!links(tree).some((link) => link.props.to === route), `${route} must be hidden`);
    }
  }
});

test("active navigation retains exact Dashboard matching and descendant route matching", () => {
  for (const [pathname, activeRoute] of [
    ["/admin", "/admin"],
    ["/admin/reports", "/admin/reports"],
    ["/admin/coupons/new", "/admin/coupons"],
    ["/admin/integrations", "/admin/integrations"],
    ["/admin/coupons-old", undefined],
    ["/admin/pages", undefined],
  ]) {
    const fixture = harness(pathname);
    for (const mobile of [false, true]) {
      for (const link of links(fixture.render(mobile))) {
        const active = link.props.to === activeRoute;
        assert.equal(link.props["aria-current"], active ? "page" : undefined);
        assert.equal(String(link.props.className).includes("border-emerald-400"), active);
        assert.equal(
          (link.props.activeOptions as { exact: boolean }).exact,
          link.props.to === "/admin",
        );
      }
    }
  }
});

test("each mobile destination and the homepage link close the Sheet through onNavigate", () => {
  const fixture = harness();
  const tree = fixture.render(true);
  const homepage = elements(tree).find((node) => node.type === "a")!;
  for (const link of [...links(tree), homepage]) {
    fixture.openMenu();
    assert.equal(fixture.menuOpen(), true);
    (link.props.onClick as () => void)();
    assert.equal(fixture.menuOpen(), false);
  }
});

test("navigation preserves accessible links, mobile touch height and the admin homepage logo", () => {
  const fixture = harness();
  for (const mobile of [false, true]) {
    const tree = fixture.render(mobile);
    const nav = elements(tree).find((node) => node.type === "nav")!;
    assert.equal(nav.props["aria-label"], "Admin");
    for (const link of links(tree)) {
      assert.match(String(link.props.className), /focus-visible:outline-emerald-400/);
      assert.equal(String(link.props.className).includes("min-h-11"), mobile);
    }
    const homepage = elements(tree).find((node) => node.type === "a")!;
    assert.equal(homepage.props.href, "https://example.test/");
    assert.equal(homepage.props["aria-label"], "Getyourcodes — go to homepage");
    assert.equal(
      homepage.props.className,
      "font-display text-xl font-extrabold tracking-tight text-white",
    );
    assert.equal((homepage.props.children as unknown[])[0], "GET");
    assert.equal(
      elements(homepage).find((node) => node.type === "span")!.props.children,
      "YOURCODES",
    );
    assert.equal(elements(homepage).find((node) => node.type === "sup")!.props.children, "®");
  }
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { z } from "zod";
import type { AdminUserRow } from "./admin.functions";

type Profile = Omit<AdminUserRow, "is_admin"> & Record<string, unknown>;
type Role = { user_id: string; role: string };

// Exercise the real server handler, stubbing TanStack and both clients to avoid live requests.
function harness(
  options: {
    admin?: boolean;
    authError?: boolean;
    profiles?: Profile[];
    roles?: Role[];
    profilesErrorAt?: number;
    rolesErrorAt?: number;
  } = {},
) {
  const middleware = {};
  const calls: unknown[][] = [];
  let authorized = false;
  let privilegedLoads = 0;
  const profiles = options.profiles ?? [
    { id: "caller", display_name: "Admin", created_at: "2026-10-07", private_metadata: "secret" },
    { id: "other-user", display_name: null, created_at: "2026-10-06", auth_token: "secret" },
    { id: "other-admin", display_name: "Other Admin", created_at: "2026-10-05" },
  ];
  const roles = options.roles ?? [
    { user_id: "caller", role: "admin" },
    { user_id: "other-admin", role: "admin" },
    { user_id: "other-user", role: "user" },
  ];
  const authClient = {
    from(table: string) {
      assert.equal(table, "user_roles");
      const query = {
        select(columns: string) {
          assert.equal(columns, "user_id");
          return query;
        },
        eq(column: string, value: string) {
          calls.push(["auth", column, value]);
          return query;
        },
        async maybeSingle() {
          authorized = options.admin !== false && !options.authError;
          return {
            data: authorized ? { user_id: "caller" } : null,
            error: options.authError ? { message: "private auth error" } : null,
          };
        },
      };
      return query;
    },
  };
  const serviceClient = {
    from(table: string) {
      assert.ok(authorized, "no privileged query before authorization");
      assert.ok(["profiles", "user_roles"].includes(table));
      const query = {
        select(columns: string) {
          assert.equal(columns, table === "profiles" ? "id, display_name, created_at" : "user_id");
          calls.push(["select", table, columns]);
          return query;
        },
        eq(column: string, value: string) {
          assert.equal(column, "role");
          assert.equal(value, "admin");
          calls.push(["filter", table, column, value]);
          return query;
        },
        order(column: string, settings?: unknown) {
          calls.push(["order", table, column, settings]);
          return query;
        },
        async range(start: number, end: number) {
          calls.push(["range", table, start, end]);
          const errorAt = table === "profiles" ? options.profilesErrorAt : options.rolesErrorAt;
          if (errorAt !== undefined && start >= errorAt)
            return { data: null, error: { message: "private DB failure" } };
          const rows =
            table === "profiles" ? profiles : roles.filter((row) => row.role === "admin");
          return { data: rows.slice(start, end + 1), error: null };
        },
      };
      return query;
    },
  };
  const source = readFileSync(new URL("./admin.functions.ts", import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const exports: Record<string, unknown> = {};
  runInNewContext(outputText, {
    exports,
    require(id: string) {
      if (id === "zod") return { z };
      if (id === "@/integrations/supabase/auth-middleware")
        return { requireSupabaseAuth: middleware };
      if (id === "@/integrations/supabase/client.server") {
        assert.ok(authorized, "privileged module must not load before authorization");
        privilegedLoads++;
        return { supabaseAdmin: serviceClient };
      }
      if (id === "@tanstack/react-start")
        return {
          createServerFn({ method }: { method: string }) {
            const builder = {
              middleware(items: unknown[]) {
                assert.equal(items.length, 1);
                assert.equal(items[0], middleware);
                return builder;
              },
              inputValidator() {
                return builder;
              },
              handler(handler: unknown) {
                assert.ok(["GET", "POST"].includes(method));
                calls.push(["method", method]);
                return handler;
              },
            };
            return builder;
          },
        };
      throw new Error(`Unexpected import: ${id}`);
    },
  });
  const handler = exports.listAdminUsers as (input: {
    context: { supabase: typeof authClient; userId: string };
  }) => Promise<AdminUserRow[]>;
  return {
    load: () => handler({ context: { supabase: authClient, userId: "caller" } }),
    privilegedLoads: () => privilegedLoads,
    calls,
  };
}

test("Users GET checks the authenticated caller's admin role before privileged access", async () => {
  const fixture = harness();
  await fixture.load();
  assert.ok(fixture.calls.some((call) => call[0] === "method" && call[1] === "GET"));
  assert.ok(
    fixture.calls.some(
      (call) => call[0] === "auth" && call[1] === "user_id" && call[2] === "caller",
    ),
  );
  assert.ok(
    fixture.calls.some((call) => call[0] === "auth" && call[1] === "role" && call[2] === "admin"),
  );
  assert.equal(fixture.privilegedLoads(), 1);
});

test("Users rejects a non-admin without loading the privileged client", async () => {
  const fixture = harness({ admin: false });
  await assert.rejects(fixture.load(), /Forbidden: admin only/);
  assert.equal(fixture.privilegedLoads(), 0);
});

test("authorization query failures fail closed with a safe error", async () => {
  const fixture = harness({ authError: true });
  await assert.rejects(fixture.load(), /Forbidden: admin only/);
  assert.equal(fixture.privilegedLoads(), 0);
});

test("Users returns all server-visible profiles with exactly the safe shape and correct admin flags", async () => {
  const rows = await harness().load();
  assert.deepEqual(JSON.parse(JSON.stringify(rows)), [
    { id: "caller", display_name: "Admin", created_at: "2026-10-07", is_admin: true },
    { id: "other-user", display_name: null, created_at: "2026-10-06", is_admin: false },
    { id: "other-admin", display_name: "Other Admin", created_at: "2026-10-05", is_admin: true },
  ]);
  for (const row of rows)
    assert.deepEqual(Object.keys(row).sort(), ["created_at", "display_name", "id", "is_admin"]);
});

test("Users pages profiles and admin IDs beyond Supabase's default row limit", async () => {
  const profiles = Array.from({ length: 1201 }, (_, index) => ({
    id: `user-${index}`,
    display_name: null,
    created_at: "2026-10-07",
  }));
  const roles = profiles.map((row) => ({ user_id: row.id, role: "admin" }));
  const fixture = harness({ profiles, roles });
  const rows = await fixture.load();
  assert.equal(rows.length, 1201);
  assert.equal(rows.at(-1)?.id, "user-1200");
  assert.ok(rows.every((row) => row.is_admin));
  assert.equal(fixture.calls.filter((call) => call[0] === "range").length, 6);
});

for (const profilesErrorAt of [0, 500]) {
  test(`profile failure at offset ${profilesErrorAt} throws instead of returning an empty or partial list`, async () => {
    const profiles = Array.from({ length: 501 }, (_, index) => ({
      id: String(index),
      display_name: null,
      created_at: "2026-10-07",
    }));
    await assert.rejects(harness({ profiles, profilesErrorAt }).load(), /Could not load users/);
  });
}

for (const rolesErrorAt of [0, 500]) {
  test(`role failure at offset ${rolesErrorAt} throws instead of returning an empty or incorrect list`, async () => {
    const roles = Array.from({ length: 501 }, (_, index) => ({
      user_id: String(index),
      role: "admin",
    }));
    await assert.rejects(harness({ roles, rolesErrorAt }).load(), /Could not load user roles/);
  });
}

test("a successful empty profile query returns an empty list", async () => {
  const rows = await harness({ profiles: [], roles: [] }).load();
  assert.equal(rows.length, 0);
});

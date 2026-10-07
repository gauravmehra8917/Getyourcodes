import assert from "node:assert/strict";
import test from "node:test";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { blogCategoryErrorMessage, runAdminSecondaryAction } from "./admin-secondary-actions.ts";

function fixture() {
  const pending = new Set<string>();
  const events: string[] = [];
  const options = {
    key: "row",
    pending,
    mutate: async (): Promise<{ error: unknown }> => {
      events.push("write");
      return { error: null };
    },
    failureMessage: "Write failed safely.",
    refreshFailureMessage: "Saved, but refresh failed.",
    refresh: async () => {
      events.push("refresh");
    },
    onBusyChange: () => {
      events.push(pending.has("row") ? "busy" : "idle");
    },
    onError: (message: string) => {
      events.push(message);
    },
    onStart: () => {
      events.push("start");
    },
    onSuccess: () => {
      events.push("saved");
    },
  };
  return { options, pending, events };
}

test("a confirmed write succeeds before refresh, then releases busy state", async () => {
  const f = fixture();
  await runAdminSecondaryAction(f.options);
  assert.deepEqual(f.events, ["busy", "start", "write", "saved", "refresh", "idle"]);
  assert.equal(f.pending.size, 0);
});

for (const thrown of [false, true]) {
  test(`${thrown ? "thrown" : "returned"} mutation failure never runs success or refresh`, async () => {
    const f = fixture();
    f.options.mutate = async () => {
      if (thrown) throw new Error("private SQL details");
      return { error: { message: "private SQL details" } };
    };
    await runAdminSecondaryAction(f.options);
    assert.deepEqual(f.events, ["busy", "start", "Write failed safely.", "idle"]);
    assert.equal(f.pending.size, 0);
  });
}

test("refresh rejection keeps the mutation successful and uses the refresh-specific reporter", async () => {
  const f = fixture();
  f.options.refresh = async () => {
    throw new Error("private refresh details");
  };
  await runAdminSecondaryAction({
    ...f.options,
    onRefreshError: (message) => {
      f.events.push(`warning: ${message}`);
    },
  });
  assert.deepEqual(f.events, [
    "busy",
    "start",
    "write",
    "saved",
    "warning: Saved, but refresh failed.",
    "idle",
  ]);
});

test("duplicate invocations are blocked synchronously through the refresh and can retry after completion", async () => {
  const f = fixture();
  let release!: () => void;
  f.options.refresh = () =>
    new Promise<void>((resolve) => {
      release = resolve;
    });
  const first = runAdminSecondaryAction(f.options);
  await runAdminSecondaryAction(f.options);
  assert.equal(f.events.filter((event) => event === "write").length, 1);
  assert.ok(f.pending.has("row"));
  release();
  await first;
  f.options.refresh = async () => {};
  await runAdminSecondaryAction(f.options);
  assert.equal(f.events.filter((event) => event === "write").length, 2);
});

test("cancelled confirmation never writes or sets busy state", async () => {
  const f = fixture();
  await runAdminSecondaryAction({ ...f.options, confirm: () => false });
  assert.deepEqual(f.events, []);
  assert.equal(f.pending.size, 0);
});

test("different rows may proceed independently", async () => {
  const f = fixture();
  await Promise.all([
    runAdminSecondaryAction(f.options),
    runAdminSecondaryAction({ ...f.options, key: "other" }),
  ]);
  assert.equal(f.events.filter((event) => event === "write").length, 2);
  assert.equal(f.pending.size, 0);
});

test("blog category constraint and permission messages do not expose SQL details", () => {
  assert.equal(
    blogCategoryErrorMessage("save", { code: "23505", message: "private_unique" }),
    "A blog category with that name or slug already exists.",
  );
  assert.equal(
    blogCategoryErrorMessage("delete", { code: "23503", message: "private_fk" }),
    "This blog category is still referenced by one or more posts and cannot be deleted.",
  );
  for (const action of ["save", "delete"] as const) {
    assert.equal(
      blogCategoryErrorMessage(action, { code: "42501" }),
      `You do not have permission to ${action} this blog category.`,
    );
    assert.equal(
      blogCategoryErrorMessage(action, new Error("private details")),
      `Could not ${action} this blog category. Please try again.`,
    );
  }
});

test("real QueryClient refresh failure reaches the saved-change reporter with throwOnError", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(["list"], []);
  const observer = new QueryObserver(client, {
    queryKey: ["list"],
    staleTime: Infinity,
    queryFn: async () => {
      throw new Error("load failed");
    },
  });
  const unsubscribe = observer.subscribe(() => {});
  const f = fixture();
  try {
    await runAdminSecondaryAction({
      ...f.options,
      refresh: () => client.invalidateQueries({ queryKey: ["list"] }, { throwOnError: true }),
    });
    assert.ok(f.events.includes("saved"));
    assert.ok(f.events.includes("Saved, but refresh failed."));
    assert.ok(!f.events.includes("Write failed safely."));
    assert.equal(client.getQueryState(["list"])?.status, "error");
  } finally {
    unsubscribe();
    client.clear();
  }
});

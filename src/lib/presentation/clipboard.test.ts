import assert from "node:assert/strict";
import test from "node:test";
import { copyWithFallback, copyInEmbeddedFrame } from "./clipboard.ts";

test("modern clipboard success reports success and does not invoke fallback", async () => {
  let fallbackCalls = 0;
  const copied: string[] = [];
  const result = await copyWithFallback("SS40", {
    writeText: async (text) => {
      copied.push(text);
    },
    legacyCopy: () => {
      fallbackCalls++;
      return true;
    },
  });
  assert.equal(result, true);
  assert.deepEqual(copied, ["SS40"]);
  assert.equal(fallbackCalls, 0);
});

test("denied clipboard permission falls back to selection-based copy", async () => {
  const result = await copyWithFallback("SS40", {
    writeText: async () => {
      throw new Error("NotAllowedError");
    },
    legacyCopy: (text) => text === "SS40",
  });
  assert.equal(result, true);
});

test("unavailable modern API uses fallback", async () => {
  assert.equal(
    await copyWithFallback("CODE10", {
      legacyCopy: (text) => text === "CODE10",
    }),
    true,
  );
});

test("both clipboard methods denied reports failure, never false success", async () => {
  assert.equal(
    await copyWithFallback("SS40", {
      writeText: async () => {
        throw new Error("blocked");
      },
      legacyCopy: () => false,
    }),
    false,
  );
  assert.equal(
    await copyWithFallback("SS40", {
      legacyCopy: () => {
        throw new Error("denied");
      },
    }),
    false,
  );
});

test("empty code does not interact with either clipboard method", async () => {
  let called = false;
  assert.equal(
    await copyWithFallback("", {
      writeText: async () => {
        called = true;
      },
      legacyCopy: () => {
        called = true;
        return true;
      },
    }),
    false,
  );
  assert.equal(called, false);
});

test("embedded preview confirms success from resolved clipboard write, without clipboard read", async () => {
  let clipboard = "";
  const wrote = await copyInEmbeddedFrame("NY80", async (text) => {
    clipboard = text;
  });
  assert.equal(wrote, true);
  assert.equal(clipboard, "NY80");
});

test("embedded preview does not require clipboard-read permission", async () => {
  // This intentionally supplies only writeText; no readText capability.
  assert.equal(await copyInEmbeddedFrame("SS40", async () => {}), true);
});

test("embedded preview refuses false success when clipboard write is denied", async () => {
  assert.equal(
    await copyInEmbeddedFrame("NY80", async () => {
      throw new Error("NotAllowedError");
    }),
    false,
  );
  assert.equal(await copyInEmbeddedFrame("NY80"), false);
  assert.equal(await copyInEmbeddedFrame("", async () => {}), false);
});

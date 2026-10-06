import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import {
  DefaultChatTransport,
  convertToModelMessages,
  stepCountIs,
  tool,
  type UIMessage,
  type ModelMessage,
} from "ai";
import { z } from "zod";
import { applyPublicOfferVisibility, excludeLifecycleHiddenStores } from "./catalog-visibility.ts";
import { normalizeSearchTerm } from "./search-normalization.ts";
import {
  MAX_CHAT_BODY_BYTES,
  parseBearerToken,
  prepareChatRequest,
} from "./chat-request.server.ts";

function userMessage(text = "Nike deals", id = "user-1"): UIMessage {
  return { id, role: "user", parts: [{ type: "text", text }] };
}

function request(
  body: unknown = { messages: [userMessage()] },
  authorization: string | null = "Bearer valid.jwt.token",
) {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (authorization !== null) headers.set("Authorization", authorization);
  return new Request("https://example.test/api/chat", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

async function expectStatus(input: Request, status: number, verify = async () => true) {
  const result = await prepareChatRequest(input, verify);
  assert.ok(result instanceof Response);
  assert.equal(result.status, status);
  assert.equal(
    await result.text(),
    status === 401 ? "Unauthorized" : status === 413 ? "Payload Too Large" : "Bad Request",
  );
}

test("missing and malformed Bearer headers reject before auth or body reading", async () => {
  for (const header of [
    null,
    "",
    "Basic abc",
    "Bearer",
    "Bearer ",
    "Bearer one two",
    "Bearer  abc",
    "Bearer abc,def",
    "Bearer abc\tdef",
    "Bearer abc:",
  ]) {
    assert.equal(parseBearerToken(header), null);
    const input = request(undefined, header);
    await expectStatus(input, 401, async () => {
      assert.fail("verification must not run");
    });
    assert.equal(input.bodyUsed, false);
  }
  assert.equal(parseBearerToken("bearer valid.jwt.token"), "valid.jwt.token");
  assert.equal(parseBearerToken("Bearer token\n"), null);
  assert.equal(parseBearerToken("Bearer token\r"), null);
});

test("invalid user verification and verification failures return a redacted 401", async () => {
  await expectStatus(request(), 401, async () => false);
  await expectStatus(request(), 401, async () => {
    throw new Error("sensitive auth failure");
  });
});

test("valid verified requests proceed and only the header token is passed to verification", async () => {
  const result = await prepareChatRequest(
    request({ messages: [userMessage()], user_id: "untrusted-user" }),
    async (jwt) => {
      assert.equal(jwt, "valid.jwt.token");
      return true;
    },
  );
  assert.deepEqual(result, [userMessage()]);
});

test("malformed JSON, UTF-8 and invalid request shapes return a generic 400", async () => {
  const headers = { Authorization: "Bearer valid.jwt.token" };
  await expectStatus(
    new Request("https://example.test/api/chat", { method: "POST", headers, body: "{not-json" }),
    400,
  );
  await expectStatus(
    new Request("https://example.test/api/chat", {
      method: "POST",
      headers,
      body: new Uint8Array([0xff]),
    }),
    400,
  );
  for (const body of [
    null,
    [],
    {},
    { messages: null },
    { messages: {} },
    { messages: [] },
    { messages: [null] },
    { messages: [{ ...userMessage(), id: 1 }] },
    { messages: [{ ...userMessage(), parts: [] }] },
    { messages: [{ ...userMessage(), parts: [{ type: "text", text: 1 }] }] },
  ]) {
    await expectStatus(request(body), 400);
  }
});

test("oversized Content-Length rejects without reading the body", async () => {
  const input = request();
  input.headers.set("Content-Length", String(MAX_CHAT_BODY_BYTES + 1));
  await expectStatus(input, 413);
  assert.equal(input.bodyUsed, false);
});

test("streaming byte limit cannot be bypassed by absent, spoofed or malformed Content-Length", async () => {
  const data = new TextEncoder().encode(
    JSON.stringify({ messages: [userMessage()], padding: "€".repeat(40_000) }),
  );
  for (const length of [null, "1", "invalid", "999999999999999999999999"]) {
    let cancelled = false;
    const chunks = [data.slice(0, 50_000), data.slice(50_000, 100_000), data.slice(100_000)];
    const stream = new ReadableStream({
      pull(controller) {
        const chunk = chunks.shift();
        if (chunk) controller.enqueue(chunk);
        else controller.close();
      },
      cancel() {
        cancelled = true;
      },
    });
    const headers = new Headers({ Authorization: "Bearer valid.jwt.token" });
    if (length) headers.set("Content-Length", length);
    const input = new Request("https://example.test/api/chat", {
      method: "POST",
      headers,
      body: stream,
      duplex: "half",
    } as RequestInit);
    await expectStatus(input, 413);
    assert.equal(cancelled, true);
  }
});

test("a complete body of exactly 96 KiB is accepted", async () => {
  const body = { messages: [userMessage()], padding: "" };
  body.padding = "x".repeat(
    MAX_CHAT_BODY_BYTES - new TextEncoder().encode(JSON.stringify(body)).length,
  );
  const input = request(body);
  input.headers.set("Content-Length", String(MAX_CHAT_BODY_BYTES));
  assert.deepEqual(await prepareChatRequest(input, async () => true), body.messages);
});

test("received history is capped at 40 messages, rejecting client system and other roles", async () => {
  await expectStatus(
    request({ messages: Array.from({ length: 41 }, (_, i) => userMessage("hi", `${i}`)) }),
    400,
  );
  for (const role of ["system", "tool", "developer", "unknown"]) {
    await expectStatus(request({ messages: [{ ...userMessage(), role }] }), 400);
  }
});

test("user text parts cap at 2000 characters and the total caps at 8000 before truncation", async () => {
  await expectStatus(request({ messages: [userMessage("x".repeat(2001))] }), 400);
  await expectStatus(
    request({
      messages: Array.from({ length: 5 }, (_, i) => userMessage("x".repeat(1601), `${i}`)),
    }),
    400,
  );
  const boundary = Array.from({ length: 4 }, (_, i) => userMessage("x".repeat(2000), `${i}`));
  assert.deepEqual(
    await prepareChatRequest(request({ messages: boundary }), async () => true),
    boundary,
  );
  const messages = Array.from({ length: 40 }, (_, i) => userMessage("hi", `${i}`));
  messages[0] = userMessage("x".repeat(2001));
  await expectStatus(request({ messages }), 400);
});

test("unreasonable part counts and non-text user parts are rejected", async () => {
  await expectStatus(
    request({
      messages: [
        {
          ...userMessage(),
          parts: Array.from({ length: 33 }, () => ({ type: "text", text: "x" })),
        },
      ],
    }),
    400,
  );
  for (const part of [
    { type: "file", url: "https://example.test/file", mediaType: "image/png" },
    { type: "tool-searchCoupons", input: {} },
  ]) {
    await expectStatus(request({ messages: [{ ...userMessage(), parts: [part] }] }), 400);
  }
});

test("latest 24 messages are retained without mutating history or assistant tool results", async () => {
  const messages = Array.from({ length: 40 }, (_, i) => userMessage("hi", `${i}`));
  const assistant: UIMessage = {
    id: "assistant-tool",
    role: "assistant",
    parts: [
      { type: "step-start" },
      {
        type: "tool-searchCoupons",
        toolCallId: "tool-1",
        state: "output-available",
        input: { query: "Nike" },
        output: { results: [{ title: "10% off" }] },
      },
      { type: "text", text: "Here is a deal." },
    ],
  };
  messages[38] = assistant;
  const recent = await prepareChatRequest(request({ messages }), async () => true);
  assert.ok(Array.isArray(recent));
  assert.equal(recent.length, 24);
  assert.equal(recent[0].id, "16");
  assert.deepEqual(recent[22], assistant);
  assert.equal(messages.length, 40);
  const modelMessages = await convertToModelMessages(recent);
  assert.ok(modelMessages.some((message) => message.role === "tool"));
});

type ToolFixture = {
  inputSchema: z.ZodType;
  execute(args: {
    query?: string;
    name?: string;
    couponType?: string;
    limit?: number;
  }): Promise<unknown>;
};
type StreamFixture = { messages: ModelMessage[]; tools: Record<string, ToolFixture> };

function routeHarness(
  options: {
    auth?: "invalid" | "missing" | "throws";
    database?: "error" | "throws";
    conversionFailure?: boolean;
    missingKey?: boolean;
  } = {},
) {
  const exports: Record<string, unknown> = {};
  const authTokens: string[] = [];
  const dbCalls: Array<[string, ...unknown[]]> = [];
  const stepLimits: number[] = [];
  let streamed: StreamFixture | undefined;
  let streamError: ((error: unknown) => string) | undefined;
  const query = {
    select: (...args: unknown[]) => {
      dbCalls.push(["select", ...args]);
      return query;
    },
    eq: (...args: unknown[]) => {
      dbCalls.push(["eq", ...args]);
      return query;
    },
    or: (...args: unknown[]) => {
      dbCalls.push(["or", ...args]);
      return query;
    },
    order: (...args: unknown[]) => {
      dbCalls.push(["order", ...args]);
      return query;
    },
    limit: (...args: unknown[]) => {
      dbCalls.push(["limit", ...args]);
      return query;
    },
    ilike: (...args: unknown[]) => {
      dbCalls.push(["ilike", ...args]);
      return query;
    },
    then(resolve: (value: unknown) => void, reject: (error: unknown) => void) {
      if (options.database === "throws")
        reject(new Error("private database credentials SQL stack"));
      else
        resolve({
          data: [{ id: "result" }],
          error:
            options.database === "error" ? { message: "private SQL/PostgREST internals" } : null,
        });
    },
  };
  const client = {
    auth: {
      async getUser(jwt: string) {
        authTokens.push(jwt);
        if (options.auth === "throws") throw new Error("private auth internals");
        return {
          data: { user: options.auth ? null : { id: "verified-user" } },
          error: options.auth === "invalid" ? { message: "private invalid token" } : null,
        };
      },
    },
    from(table: string) {
      dbCalls.push(["from", table]);
      return query;
    },
  };
  const source = readFileSync(new URL("../routes/api/chat.ts", import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  runInNewContext(outputText, {
    exports,
    Response,
    Headers,
    process: {
      env: {
        SUPABASE_URL: "https://supabase.example.test",
        SUPABASE_PUBLISHABLE_KEY: "public-fixture",
        LOVABLE_API_KEY: options.missingKey ? undefined : "gateway-fixture",
      },
    },
    require(id: string) {
      if (id === "@tanstack/react-router")
        return { createFileRoute: () => (route: unknown) => route };
      if (id === "@supabase/supabase-js")
        return {
          createClient(url: string, key: string, config: unknown) {
            assert.equal(url, "https://supabase.example.test");
            assert.equal(key, "public-fixture");
            assert.match(JSON.stringify(config), /"persistSession":false/);
            return client;
          },
        };
      if (id === "zod") return { z };
      if (id === "@/lib/chat-request.server") return { prepareChatRequest };
      if (id === "@/lib/search-normalization") return { normalizeSearchTerm };
      if (id === "@/lib/catalog-visibility")
        return { applyPublicOfferVisibility, excludeLifecycleHiddenStores };
      if (id === "@/lib/ai-gateway.server")
        return {
          createLovableAiGatewayProvider: () => (model: string) => {
            assert.equal(model, "google/gemini-3-flash-preview");
            return "model-fixture";
          },
        };
      if (id === "ai")
        return {
          tool,
          convertToModelMessages: options.conversionFailure
            ? () => {
                throw new Error("private conversion internals");
              }
            : convertToModelMessages,
          stepCountIs(count: number) {
            stepLimits.push(count);
            return stepCountIs(count);
          },
          streamText(input: StreamFixture) {
            streamed = input;
            return {
              toUIMessageStreamResponse(settings: { onError: (error: unknown) => string }) {
                streamError = settings.onError;
                return new Response("stream-fixture");
              },
            };
          },
        };
      throw new Error(`Unexpected import ${id}`);
    },
  });
  const route = exports.Route as {
    server: { handlers: { POST(args: { request: Request }): Promise<Response> } };
  };
  return {
    post: (input = request()) => route.server.handlers.POST({ request: input }),
    authTokens,
    dbCalls,
    stepLimits,
    getStream: () => streamed,
    getStreamError: () => streamError,
  };
}

const plain = (value: unknown) => JSON.parse(JSON.stringify(value));

test("real chat route rejects missing, malformed, invalid and missing-user authorization before model use", async () => {
  for (const header of [null, "Basic bad"]) {
    const fixture = routeHarness();
    assert.equal((await fixture.post(request(undefined, header))).status, 401);
    assert.deepEqual(fixture.authTokens, []);
    assert.equal(fixture.getStream(), undefined);
  }
  for (const auth of ["invalid", "missing", "throws"] as const) {
    const fixture = routeHarness({ auth });
    const response = await fixture.post();
    assert.equal(response.status, 401);
    assert.equal(await response.text(), "Unauthorized");
    assert.equal(fixture.getStream(), undefined);
  }
});

test("authenticated route passes only recent context to the model and uses stopCount 6", async () => {
  const fixture = routeHarness();
  const messages = Array.from({ length: 40 }, (_, i) => userMessage(`message ${i}`, `${i}`));
  assert.equal((await fixture.post(request({ messages }))).status, 200);
  assert.deepEqual(fixture.authTokens, ["valid.jwt.token"]);
  assert.deepEqual(fixture.stepLimits, [6]);
  assert.equal(fixture.getStream()?.messages.length, 24);
  assert.deepEqual(
    fixture.getStream()?.messages,
    await convertToModelMessages(messages.slice(-24)),
  );
  assert.equal(messages.length, 40);
  assert.equal(
    fixture.getStreamError()?.(new Error("private model failure")),
    "Chat request failed",
  );
});

test("conversion and configuration failures are redacted", async () => {
  const malformed = await routeHarness({ conversionFailure: true }).post();
  assert.equal(malformed.status, 400);
  assert.equal(await malformed.text(), "Bad Request");
  const unavailable = await routeHarness({ missingKey: true }).post();
  assert.equal(unavailable.status, 500);
  assert.equal(await unavailable.text(), "Chat unavailable");
});

test("empty and wildcard-only tool searches never issue a database query", async () => {
  const fixture = routeHarness();
  await fixture.post();
  for (const value of ["", " ", "%", "___", " % _ \t ", '...()\\"']) {
    assert.deepEqual(
      plain(await fixture.getStream()!.tools.searchCoupons.execute({ query: value })),
      { results: [] },
    );
    assert.deepEqual(
      plain(await fixture.getStream()!.tools.searchStores.execute({ name: value })),
      { results: [] },
    );
  }
  assert.deepEqual(fixture.dbCalls, []);
});

test("tool searches normalize and cap keywords, bound results and retain catalog guards", async () => {
  const fixture = routeHarness();
  await fixture.post();
  const tools = fixture.getStream()!.tools;
  await tools.searchCoupons.execute({
    query: ` %_${"a".repeat(120)}_% `,
    couponType: "code",
    limit: 20,
  });
  assert.ok(
    fixture.dbCalls.some(
      (call) =>
        call[0] === "or" &&
        call[1] === `title.ilike.%${"a".repeat(100)}%,description.ilike.%${"a".repeat(100)}%`,
    ),
  );
  assert.ok(
    fixture.dbCalls.some(
      (call) => call[0] === "eq" && call[1] === "status" && call[2] === "active",
    ),
  );
  assert.ok(
    fixture.dbCalls.some(
      (call) => call[0] === "or" && JSON.stringify(call[2]) === '{"referencedTable":"stores"}',
    ),
  );
  assert.ok(
    fixture.dbCalls.some(
      (call) =>
        call[0] === "or" && String(call[1]).startsWith("start_date.is.null,start_date.lte."),
    ),
  );
  assert.ok(
    fixture.dbCalls.some(
      (call) =>
        call[0] === "or" && String(call[1]).startsWith("expiry_date.is.null,expiry_date.gte."),
    ),
  );
  assert.ok(fixture.dbCalls.some((call) => call[0] === "limit" && call[1] === 20));
  fixture.dbCalls.length = 0;
  await tools.searchStores.execute({ name: " \t Nike%_ \n ", limit: 10 });
  assert.ok(
    fixture.dbCalls.some(
      (call) => call[0] === "ilike" && call[1] === "name" && call[2] === "%Nike%",
    ),
  );
  assert.ok(fixture.dbCalls.some((call) => call[0] === "limit" && call[1] === 10));
  assert.equal(
    tools.searchCoupons.inputSchema.safeParse({ query: "Nike", limit: 21 }).success,
    false,
  );
  assert.equal(
    tools.searchStores.inputSchema.safeParse({ name: "Nike", limit: 11 }).success,
    false,
  );
});

test("model keywords cannot inject raw PostgREST expressions", async () => {
  const fixture = routeHarness();
  await fixture.post();
  await fixture
    .getStream()!
    .tools.searchCoupons.execute({ query: 'Nike%,status.eq.draft),or(title.neq.null)\\"' });
  const filter = fixture.dbCalls.find(
    (call) => call[0] === "or" && String(call[1]).startsWith("title.ilike."),
  )?.[1];
  assert.equal(
    filter,
    "title.ilike.%Nike status eq draft  or title neq null%,description.ilike.%Nike status eq draft  or title neq null%",
  );
});

test("database error results and thrown failures expose only a generic search failure", async () => {
  for (const database of ["error", "throws"] as const) {
    const fixture = routeHarness({ database });
    await fixture.post();
    for (const [toolName, input] of [
      ["searchCoupons", { query: "Nike" }],
      ["searchStores", { name: "Nike" }],
    ] as const) {
      assert.deepEqual(plain(await fixture.getStream()!.tools[toolName].execute(input)), {
        error: "search_failed",
        results: [],
      });
    }
  }
});

test("assistant transport reads the current session on every send without a fake or cached token", async () => {
  let currentToken: string | null = "first-session";
  let sessionReads = 0;
  const headersSent: Headers[] = [];
  const bodiesSent: Array<{ messages: UIMessage[] }> = [];
  let transport: DefaultChatTransport<UIMessage> | undefined;
  const source = readFileSync(new URL("../components/ai-assistant.tsx", import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  });
  const exports: Record<string, unknown> = {};
  runInNewContext(outputText, {
    exports,
    Headers,
    require(id: string) {
      if (id === "react")
        return {
          useState: (initial: unknown) => [initial, () => {}],
          useRef: () => ({ current: null }),
          useEffect() {},
        };
      if (id === "@ai-sdk/react")
        return {
          useChat(options: { transport: DefaultChatTransport<UIMessage> }) {
            transport = options.transport;
            return { messages: [], sendMessage() {}, status: "ready", setMessages() {} };
          },
        };
      if (id === "ai")
        return {
          DefaultChatTransport: class extends DefaultChatTransport<UIMessage> {
            constructor(options: ConstructorParameters<typeof DefaultChatTransport<UIMessage>>[0]) {
              super({
                ...options,
                fetch: async (_url, init) => {
                  headersSent.push(new Headers(init?.headers));
                  bodiesSent.push(JSON.parse(String(init?.body)));
                  return new Response("data: [DONE]\n\n", {
                    headers: { "Content-Type": "text/event-stream" },
                  });
                },
              });
            }
          },
        };
      if (id === "@/integrations/supabase/client")
        return {
          supabase: {
            auth: {
              async getSession() {
                sessionReads++;
                return { data: { session: currentToken ? { access_token: currentToken } : null } };
              },
            },
          },
        };
      if (
        [
          "react/jsx-runtime",
          "lucide-react",
          "@tanstack/react-router",
          "@/lib/coupon-actions",
          "@/lib/chat.functions",
        ].includes(id)
      )
        return {};
      throw new Error(`Unexpected import ${id}`);
    },
  });
  const component = exports.AIAssistant as (props: {
    open: boolean;
    onOpenChange: () => void;
  }) => unknown;
  assert.equal(component({ open: false, onOpenChange() {} }), null);
  const displayedHistory = Array.from({ length: 50 }, (_, i) => userMessage("hi", `${i}`));
  for (const token of ["first-session", "refreshed-session", null]) {
    currentToken = token;
    const stream = await transport!.sendMessages({
      chatId: "fixture",
      trigger: "submit-message",
      messages: displayedHistory,
      messageId: undefined,
      abortSignal: undefined,
    });
    await stream.cancel();
  }
  assert.equal(sessionReads, 3);
  assert.equal(displayedHistory.length, 50);
  for (const body of bodiesSent) {
    assert.deepEqual(body.messages, displayedHistory.slice(-24));
  }
  assert.deepEqual(
    headersSent.map((headers) => headers.get("Authorization")),
    ["Bearer first-session", "Bearer refreshed-session", null],
  );
});

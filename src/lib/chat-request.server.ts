import type { UIMessage } from "ai";

export const MAX_CHAT_BODY_BYTES = 96 * 1024;
export const MAX_CHAT_MESSAGES = 40;
export const MAX_CHAT_CONTEXT_MESSAGES = 24;
export const MAX_CHAT_PARTS = 32;
export const MAX_USER_PART_CHARACTERS = 2_000;
export const MAX_USER_TEXT_CHARACTERS = 8_000;

class ChatInputError extends Error {
  readonly status: 400 | 413;

  constructor(status: 400 | 413) {
    super(status === 413 ? "Payload Too Large" : "Bad Request");
    this.status = status;
  }
}

/** Accept one token using the HTTP Bearer token character set, without extra fields. */
export function parseBearerToken(header: string | null): string | null {
  const match = header?.match(/^Bearer ([A-Za-z0-9\-._~+/]+=*)$/i);
  return match && match[0] === header ? match[1] : null;
}

async function readBoundedJson(request: Request): Promise<unknown> {
  const lengthHeader = request.headers.get("content-length");
  if (lengthHeader && /^\d+$/.test(lengthHeader)) {
    const length = Number(lengthHeader);
    if (Number.isSafeInteger(length) && length > MAX_CHAT_BODY_BYTES) {
      throw new ChatInputError(413);
    }
  }
  if (!request.body) throw new ChatInputError(400);

  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_CHAT_BODY_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new ChatInputError(413);
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text);
  } catch (error) {
    if (error instanceof ChatInputError) throw error;
    throw new ChatInputError(400);
  } finally {
    reader.releaseLock();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateMessages(body: unknown): UIMessage[] {
  if (
    !isRecord(body) ||
    !Array.isArray(body.messages) ||
    body.messages.length < 1 ||
    body.messages.length > MAX_CHAT_MESSAGES
  ) {
    throw new ChatInputError(400);
  }

  let userCharacters = 0;
  for (const message of body.messages) {
    if (
      !isRecord(message) ||
      typeof message.id !== "string" ||
      (message.role !== "user" && message.role !== "assistant") ||
      !Array.isArray(message.parts) ||
      message.parts.length < 1 ||
      message.parts.length > MAX_CHAT_PARTS
    ) {
      throw new ChatInputError(400);
    }

    for (const part of message.parts) {
      if (!isRecord(part) || typeof part.type !== "string") throw new ChatInputError(400);
      if ((part.type === "text" || part.type === "reasoning") && typeof part.text !== "string") {
        throw new ChatInputError(400);
      }
      // Dealio accepts text input only. Assistant SDK tool results remain intact.
      if (message.role === "user") {
        if (part.type !== "text" || typeof part.text !== "string") throw new ChatInputError(400);
        if (part.text.length > MAX_USER_PART_CHARACTERS) throw new ChatInputError(400);
        userCharacters += part.text.length;
        if (userCharacters > MAX_USER_TEXT_CHARACTERS) throw new ChatInputError(400);
      }
    }
  }

  return body.messages as UIMessage[];
}

/** Authenticate before consuming input; the caller supplies authoritative Supabase verification. */
export async function prepareChatRequest(
  request: Request,
  verifyUser: (jwt: string) => Promise<boolean>,
): Promise<UIMessage[] | Response> {
  const token = parseBearerToken(request.headers.get("authorization"));
  if (!token) return new Response("Unauthorized", { status: 401 });
  try {
    if (!(await verifyUser(token))) return new Response("Unauthorized", { status: 401 });
  } catch {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    return validateMessages(await readBoundedJson(request)).slice(-MAX_CHAT_CONTEXT_MESSAGES);
  } catch (error) {
    const status = error instanceof ChatInputError ? error.status : 400;
    return new Response(status === 413 ? "Payload Too Large" : "Bad Request", { status });
  }
}

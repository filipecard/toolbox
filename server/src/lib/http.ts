import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { z } from "zod";
import type { ApiErrorBody } from "@toolbox/shared";

/** Thrown anywhere in a handler; the app's error handler turns it into
 * `{ error: { code, message } }` with this status. */
export class ApiError extends Error {
  constructor(
    public status: ContentfulStatusCode,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, code = "invalid_request") => new ApiError(400, code, message);
export const unauthorized = (message = "Faça login para continuar.", code = "unauthorized") =>
  new ApiError(401, code, message);
export const forbidden = (message = "Você não tem permissão para isso.", code = "forbidden") =>
  new ApiError(403, code, message);
export const notFound = (message = "Não encontrado.", code = "not_found") => new ApiError(404, code, message);
export const conflict = (message: string, code = "conflict") => new ApiError(409, code, message);

export function errorBody(code: string, message: string): ApiErrorBody {
  return { error: { code, message } };
}

/** Parses and validates a JSON body; a 400 with the first problem otherwise. */
export async function readJson<T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw badRequest("Corpo da requisição inválido.");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw badRequest(issue?.message ?? "Dados inválidos.");
  }
  return parsed.data;
}

export function clientIp(c: Context): string | null {
  return c.req.header("cf-connecting-ip") ?? null;
}

export function userAgent(c: Context): string | null {
  return c.req.header("user-agent")?.slice(0, 300) ?? null;
}

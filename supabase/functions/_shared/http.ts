const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, apikey, content-type, x-client-info, x-inventory-id, x-device-id, x-device-token, x-item-id, x-file-id",
};

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function env(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new HttpError(500, "Backend configuration is incomplete");
  return value;
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

export function serve(
  handler: (request: Request, body: Record<string, unknown>) => Promise<unknown>,
): void {
  serveRequest(async (request) => handler(request, await readBody(request)));
}

export function serveRequest(
  handler: (request: Request) => Promise<unknown>,
): void {
  Deno.serve(async (request: Request) => {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }
    if (request.method !== "POST") {
      return json({ error: "Method not allowed" }, 405);
    }
    try {
      return json(await handler(request));
    } catch (error) {
      if (error instanceof HttpError) {
        return json({ error: error.message }, error.status);
      }
      // Do not log request headers, bodies, or database error details: they contain credentials.
      console.error("Unhandled backend request failure");
      return json({ error: "Internal server error" }, 500);
    }
  });
}

export async function readBytes(request: Request, maxLength: number): Promise<Uint8Array> {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxLength) {
    throw new HttpError(413, "Request body is too large");
  }
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  if (reader) {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxLength) {
        await reader.cancel();
        throw new HttpError(413, "Request body is too large");
      }
      chunks.push(value);
    }
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function readBody(request: Request): Promise<Record<string, unknown>> {
  const bytes = await readBytes(request, 16_384);
  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder().decode(bytes) || "{}");
  } catch {
    throw new HttpError(400, "Invalid JSON");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(400, "Expected a JSON object");
  }
  return body as Record<string, unknown>;
}

export function text(
  body: Record<string, unknown>,
  key: string,
  maxLength: number,
  optional = false,
): string {
  const value = body[key];
  if (optional && (value === undefined || value === null)) return "";
  if (
    typeof value !== "string" || value.length > maxLength ||
    (!optional && !value.trim())
  ) {
    throw new HttpError(400, `Invalid ${key}`);
  }
  return value.trim();
}

export function uuid(value: string, field: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new HttpError(400, `Invalid ${field}`);
  }
  return value.toLowerCase();
}

export async function rpc<T>(
  name: string,
  args: Record<string, unknown>,
  deviceHeaders?: Record<string, string>,
): Promise<T> {
  const key = env(deviceHeaders ? "SUPABASE_ANON_KEY" : "SUPABASE_SERVICE_ROLE_KEY");
  const response = await fetch(`${env("SUPABASE_URL")}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: ["Bearer", key].join(" "),
      "Content-Type": "application/json",
      ...deviceHeaders,
    },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    if (error.code === "28000") throw new HttpError(403, "Invalid or expired credentials");
    if (error.code === "22023") throw new HttpError(400, "Invalid request");
    console.error("Database RPC failed", name, response.status);
    throw new HttpError(503, "Backend temporarily unavailable");
  }
  return await response.json() as T;
}

export async function authenticate(request: Request): Promise<string> {
  const headers: Record<string, string> = {};
  for (const name of ["x-inventory-id", "x-device-id", "x-device-token"]) {
    const value = request.headers.get(name);
    if (!value || value.length > 256) throw new HttpError(401, "Device credentials required");
    headers[name] = value;
  }
  const inventoryId = await rpc<string | null>("current_inventory_id", {}, headers);
  if (!inventoryId) throw new HttpError(401, "Invalid or revoked device credentials");
  return inventoryId;
}

export async function serviceRequest(path: string, init: RequestInit = {}): Promise<Response> {
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  const headers = new Headers(init.headers);
  headers.set("apikey", key);
  headers.set("Authorization", ["Bearer", key].join(" "));
  return await fetch(`${env("SUPABASE_URL")}${path}`, {
    ...init,
    headers,
    signal: AbortSignal.timeout(15_000),
  });
}

export function storageSignedUrl(path: string): string {
  const base = env("SUPABASE_URL").replace(/\/$/, "");
  if (path.startsWith(`${base}/storage/v1/`)) return path;
  if (!path.startsWith("/object/sign/")) {
    throw new HttpError(503, "Invalid Storage response");
  }
  return `${base}/storage/v1${path}`;
}

export interface Credentials {
  inventory_id: string;
  device_id: string;
  device_token: string;
}

export function credentials(row: Credentials) {
  return {
    inventoryId: row.inventory_id,
    deviceId: row.device_id,
    deviceToken: row.device_token,
  };
}

export async function registrationRateLimit(
  request: Request,
  inventoryId: string,
): Promise<void> {
  // Supabase's gateway supplies forwarding headers. Other hosting must overwrite them.
  const address = request.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    request.headers.get("x-real-ip") || "unknown";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(address));
  const clientKey = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
  const allowed = await rpc<boolean>("consume_registration_attempt", {
    p_inventory_id: inventoryId,
    p_client_key: clientKey,
  });
  if (!allowed) throw new HttpError(429, "Too many registration attempts; try again later");
}

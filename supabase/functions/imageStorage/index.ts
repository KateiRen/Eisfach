import {
  authenticate,
  HttpError,
  readBody,
  readBytes,
  serveRequest,
  serviceRequest,
  storageSignedUrl,
  text,
  uuid,
} from "../_shared/http.ts";

const bucketPath = "/storage/v1/object";
const bucket = "inventory-images";
const maxImageBytes = 5 * 1024 * 1024;

async function requireItem(inventoryId: string, itemId: string): Promise<void> {
  const query = new URLSearchParams({
    select: "id",
    id: `eq.${itemId}`,
    inventory_id: `eq.${inventoryId}`,
  });
  const response = await serviceRequest(`/rest/v1/items?${query}`);
  if (!response.ok) throw new HttpError(503, "Backend temporarily unavailable");
  const items = await response.json();
  if (!Array.isArray(items) || items.length !== 1 || items[0].id !== itemId) {
    throw new HttpError(404, "Item not found");
  }
}

function imagePath(inventoryId: string, itemId: string, fileId: string): string {
  return `${inventoryId}/${itemId}/${fileId}.webp`;
}

function parsePath(path: string, inventoryId: string): string {
  const segments = path.split("/");
  if (segments.length !== 3 || segments[0] !== inventoryId || !segments[2].endsWith(".webp")) {
    throw new HttpError(400, "Invalid image path");
  }
  const itemId = uuid(segments[1], "image path");
  const fileId = uuid(segments[2].slice(0, -5), "image path");
  if (path !== imagePath(inventoryId, itemId, fileId)) {
    throw new HttpError(400, "Invalid image path");
  }
  return itemId;
}

function validateWebP(bytes: Uint8Array): void {
  const decode = (start: number, end: number) =>
    new TextDecoder().decode(bytes.subarray(start, end));
  if (
    bytes.length < 20 || decode(0, 4) !== "RIFF" || decode(8, 12) !== "WEBP" ||
    !["VP8 ", "VP8L", "VP8X"].includes(decode(12, 16)) ||
    new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4, true) !==
      bytes.length - 8
  ) {
    throw new HttpError(415, "Expected a WebP image");
  }
}

async function checkStorage(response: Response): Promise<void> {
  if (response.ok) return;
  // Storage sometimes reports object failures as HTTP 400 with a nested statusCode.
  const error = await response.json().catch(() => ({}));
  const status = Number(error?.statusCode ?? response.status);
  if (status === 404) throw new HttpError(404, "Image not found");
  if (status === 409) throw new HttpError(409, "Image already exists");
  throw new HttpError(503, "Storage temporarily unavailable");
}

serveRequest(async (request) => {
  const inventoryId = await authenticate(request);
  const contentType = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  if (contentType === "image/webp") {
    const itemId = uuid(request.headers.get("x-item-id") || "", "x-item-id");
    const fileId = uuid(request.headers.get("x-file-id") || "", "x-file-id");
    await requireItem(inventoryId, itemId);
    const bytes = await readBytes(request, maxImageBytes);
    validateWebP(bytes);
    const path = imagePath(inventoryId, itemId, fileId);
    const response = await serviceRequest(`${bucketPath}/${bucket}/${path}`, {
      method: "POST",
      headers: { "Content-Type": "image/webp", "x-upsert": "false" },
      body: new Uint8Array(bytes),
    });
    await checkStorage(response);
    return { path };
  }
  if (contentType !== "application/json") {
    throw new HttpError(415, "Expected application/json or image/webp");
  }
  const body = await readBody(request);
  const action = text(body, "action", 10);
  if (action !== "sign" && action !== "delete") throw new HttpError(400, "Invalid action");
  const path = text(body, "path", 160);
  const itemId = parsePath(path, inventoryId);
  await requireItem(inventoryId, itemId);
  if (action === "sign") {
    const response = await serviceRequest(`${bucketPath}/sign/${bucket}/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expiresIn: 120 }),
    });
    await checkStorage(response);
    const data = await response.json();
    if (typeof data?.signedURL !== "string") throw new HttpError(503, "Invalid Storage response");
    return { signedURL: storageSignedUrl(data.signedURL) };
  }
  const response = await serviceRequest(`${bucketPath}/${bucket}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prefixes: [path] }),
  });
  await checkStorage(response);
  return { ok: true };
});

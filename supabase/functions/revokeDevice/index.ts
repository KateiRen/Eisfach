import { authenticate, rpc, serve, text } from "../_shared/http.ts";

serve(async (request, body) => {
  const inventoryId = await authenticate(request);
  await rpc<null>("revoke_device", {
    p_inventory_id: inventoryId,
    p_device_id: text(body, "deviceId", 128),
    p_caller_device_id: request.headers.get("x-device-id"),
    p_caller_device_token: request.headers.get("x-device-token"),
  });
  return { ok: true };
});

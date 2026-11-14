import { authenticate, rpc, serve } from "../_shared/http.ts";

serve(async (request) => {
  const inventoryId = await authenticate(request);
  const rows = await rpc<{ join_token: string; expires_at: string }[]>("issue_join_token", {
    p_inventory_id: inventoryId,
    p_caller_device_id: request.headers.get("x-device-id"),
    p_caller_device_token: request.headers.get("x-device-token"),
  });
  return { joinToken: rows[0].join_token, expiresAt: rows[0].expires_at };
});

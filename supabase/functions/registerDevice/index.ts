import {
  credentials,
  type Credentials,
  publicRateLimit,
  rpc,
  serve,
  text,
  uuid,
} from "../_shared/http.ts";

serve(async (request, body) => {
  const inventoryId = uuid(text(body, "inventoryId", 36), "inventoryId");
  const joinToken = text(body, "joinToken", 64);
  const deviceName = text(body, "deviceName", 200);
  await publicRateLimit(request, "register");
  const rows = await rpc<Credentials[]>("register_device", {
    p_inventory_id: inventoryId,
    p_join_token: joinToken,
    p_device_name: deviceName,
  });
  return credentials(rows[0]);
});

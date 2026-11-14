import { credentials, type Credentials, rpc, serve, text } from "../_shared/http.ts";

serve(async (_request, body) => {
  const rows = await rpc<Credentials[]>("setup_inventory", {
    p_name: text(body, "name", 200),
    p_description: text(body, "description", 4000, true),
    p_device_name: text(body, "deviceName", 200),
  });
  return credentials(rows[0]);
});

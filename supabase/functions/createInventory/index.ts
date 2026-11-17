import { credentials, type Credentials, publicRateLimit, rpc, serve, text } from "../_shared/http.ts";

serve(async (request, body) => {
  const invitationToken = text(body, "invitationToken", 64);
  await publicRateLimit(request, "create");
  const rows = await rpc<Credentials[]>("setup_inventory", {
    p_invitation_token: invitationToken,
    p_name: text(body, "name", 200),
    p_description: text(body, "description", 4000, true),
    p_device_name: text(body, "deviceName", 200),
  });
  return credentials(rows[0]);
});

import { redirect } from "next/navigation";

// Servers are viewed via /servers/[id] (picked from the workspace tree); a bare
// /servers has nothing to show, so send it to the workspace entry point.
export default function ServersIndexPage() {
  redirect("/projects");
}

import { can } from "../api";
import { useAuth } from "../App";

// On a page someone may only look at: say so, before they fill a form the server will refuse
export default function ViewOnlyNote({ module, page }: { module: string; page: string }) {
  const { user } = useAuth();
  if (can(user, module, "edit")) return null;
  return <div className="notice small view-only">View only: changing the {page} needs its Edit tick in Users. Ask your admin.</div>;
}

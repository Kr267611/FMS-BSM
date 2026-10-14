import { useAuth } from "../App";

// On the report pages: when the user's data reaches only themselves, say so – an empty list is then not a fault
export default function ScopeNote() {
  const { user } = useAuth();
  if (user?.reach !== "self") return null;
  return <div className="scope-note small">You see only your own tasks and score here. To see other people, an admin can change "Whose data they see" in Users.</div>;
}

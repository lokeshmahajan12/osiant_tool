import { useAuth } from "../context/AuthContext";
import { UserDashboard } from "./UserDashboard";
import { Dashboard } from "./Dashboard";

export function HomeRouter() {
  const { user } = useAuth();
  if (user?.role === "USER") return <UserDashboard />;
  return <Dashboard />;
}
import { Navigate } from "react-router-dom";
import type { ReactNode } from "react";
import { useAuth } from "../context/AuthContext";
import type { Role } from "../types";

export function RoleGate({ roles, children, fallback = "/dashboard" }: { roles: readonly Role[]; children: ReactNode; fallback?: string }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user || !roles.includes(user.role)) return <Navigate to={fallback} replace />;
  return <>{children}</>;
}
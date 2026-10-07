import React from "react";
import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "./AuthProvider";
import { getHomePathForRole, UserRole } from "../types";

interface RequireRoleProps {
  allowed: UserRole[];
  redirectTo?: string;
}

export const RequireRole: React.FC<RequireRoleProps> = ({ allowed, redirectTo }) => {
  const { currentUser } = useAuth();

  if (!currentUser) {
    return <Navigate to="/login" replace />;
  }

  const role = currentUser.role ?? "owner";
  if (!allowed.includes(role)) {
    return <Navigate to={redirectTo ?? getHomePathForRole(role)} replace />;
  }

  return <Outlet />;
};

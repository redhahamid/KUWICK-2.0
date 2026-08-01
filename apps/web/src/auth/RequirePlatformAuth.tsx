import { Navigate, Outlet } from 'react-router-dom';
import { usePlatformAuthStore } from '../core/platform-auth-store';

export function RequirePlatformAuth() {
  const accessToken = usePlatformAuthStore((state) => state.accessToken);

  // D-049 — one login for everyone: the unified /login form signs platform
  // admins in too, so that's where an unauthenticated platform visit lands
  // (/platform/login still exists as a direct-URL fallback).
  if (!accessToken) {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
}

import { Navigate, Outlet } from 'react-router-dom';
import { usePlatformAuthStore } from '../core/platform-auth-store';

export function RequirePlatformAuth() {
  const accessToken = usePlatformAuthStore((state) => state.accessToken);

  if (!accessToken) {
    return <Navigate to="/platform/login" replace />;
  }

  return <Outlet />;
}

import { createContext, useCallback, useContext } from 'react';
import { Navigate, Outlet, useLocation, useNavigate } from 'react-router';
import type { AdminUser } from '../../../contracts/types';
import { isApiClientError } from '../lib/api/client';
import { authApi } from '../lib/api/endpoints';
import { useAsync } from '../hooks/useAsync';
import { ErrorState, LoadingState } from '../components/States';
import { Seo } from '../components/Seo';

interface AdminSession {
  user: AdminUser;
}

const AdminSessionContext = createContext<AdminSession | null>(null);

export function useAdminSession(): AdminSession {
  const ctx = useContext(AdminSessionContext);
  if (!ctx) throw new Error('useAdminSession must be used inside <RequireAdmin>');
  return ctx;
}

/**
 * Returns a function admin pages call with any caught error. A 401 means the session
 * expired mid-visit, so it sends the admin back to the login page and returns true.
 */
export function useHandleUnauthorized(): (err: unknown) => boolean {
  const navigate = useNavigate();
  const location = useLocation();
  return useCallback(
    (err: unknown) => {
      if (isApiClientError(err) && err.status === 401) {
        navigate('/admin/login', { replace: true, state: { from: location.pathname, expired: true } });
        return true;
      }
      return false;
    },
    [navigate, location.pathname],
  );
}

/** useAsync for admin data: a 401 from the loader redirects to the login page. */
export function useAdminAsync<T>(load: (signal: AbortSignal) => Promise<T>, deps: readonly unknown[]) {
  const handle401 = useHandleUnauthorized();
  return useAsync(async (signal) => {
    try {
      return await load(signal);
    } catch (err) {
      handle401(err);
      throw err;
    }
  }, deps);
}

/**
 * Route guard for /admin/*. Asks the server who is logged in.
 * The server still checks every admin request; this only saves a pointless round trip.
 */
export function RequireAdmin() {
  const location = useLocation();
  const session = useAsync((signal) => authApi.me({ signal }), []);

  if (session.status === 'loading') {
    return (
      <div className="admin-gate">
        <Seo title="Admin" noindex />
        <LoadingState label="Checking your session" />
      </div>
    );
  }

  if (session.status === 'error') {
    if (isApiClientError(session.error) && session.error.status === 401) {
      return <Navigate to="/admin/login" replace state={{ from: location.pathname }} />;
    }
    return (
      <div className="admin-gate">
        <Seo title="Admin" noindex />
        <ErrorState title="Couldn't check your session." error={session.error} onRetry={session.reload} />
      </div>
    );
  }

  return (
    <AdminSessionContext.Provider value={{ user: session.data.user }}>
      <Outlet />
    </AdminSessionContext.Provider>
  );
}

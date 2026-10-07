import { useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router';
import { authApi } from '../lib/api/endpoints';
import { Seo } from '../components/Seo';
import { BrandMark } from '../components/Icons';
import { BRAND } from '../content/copy';
import { useAdminSession } from './RequireAdmin';

export function AdminLayout() {
  const { user } = useAdminSession();
  const navigate = useNavigate();
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);

  async function logout() {
    setLoggingOut(true);
    setLogoutError(null);
    try {
      await authApi.logout();
      navigate('/admin/login', { replace: true });
    } catch {
      setLoggingOut(false);
      setLogoutError("Couldn't log out. Check your connection and try again.");
    }
  }

  return (
    <div className="admin">
      {/* Robots tag stays in <head> for as long as any admin page is mounted. */}
      <Seo noindex />
      <a className="skip-link" href="#admin-main">
        Skip to content
      </a>
      <header className="admin-bar">
        <Link to="/admin" className="admin-bar__brand">
          <BrandMark width={24} height={24} />
          <span>{BRAND.name} admin</span>
        </Link>
        <nav aria-label="Admin" className="admin-bar__nav">
          <NavLink to="/admin" end>
            Shirts
          </NavLink>
          <NavLink to="/admin/products/new">New shirt</NavLink>
          <a href="/" target="_blank" rel="noopener noreferrer">
            View site
          </a>
        </nav>
        <div className="admin-bar__user">
          <span className="admin-bar__email" title={user.email}>
            {user.email}
          </span>
          <button type="button" className="btn btn--small btn--ghost" onClick={logout} disabled={loggingOut}>
            {loggingOut ? 'Logging out…' : 'Log out'}
          </button>
        </div>
      </header>
      {logoutError ? (
        <p className="notice notice--error admin-bar__error" role="alert">
          {logoutError}
        </p>
      ) : null}
      <main id="admin-main" tabIndex={-1} className="admin-main">
        <Outlet />
      </main>
    </div>
  );
}

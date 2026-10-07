import { Link, NavLink, Outlet } from 'react-router';
import { BRAND, FOOTER } from '../content/copy';
import { BrandMark } from '../components/Icons';
import { ScrollToTop } from './ScrollToTop';

const NAV = [
  { to: '/shop', label: 'Shop' },
  { to: '/about', label: 'About' },
  { to: '/size-guide', label: 'Size guide' },
];

export function PublicLayout() {
  return (
    <div className="site">
      <ScrollToTop />
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="site-header">
        <div className="site-header__inner">
          <Link to="/" className="brand" aria-label={`${BRAND.name} home`}>
            <BrandMark className="brand__mark" width={28} height={28} />
            <span className="brand__name">{BRAND.name}</span>
          </Link>
          <nav aria-label="Main" className="site-nav">
            <ul>
              {NAV.map((item) => (
                <li key={item.to}>
                  <NavLink to={item.to} className="site-nav__link">
                    {item.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </header>

      <main id="main" tabIndex={-1} className="site-main">
        <Outlet />
      </main>

      <footer className="site-footer">
        <div className="site-footer__inner">
          <div className="site-footer__brand">
            <BrandMark width={36} height={36} />
            <p className="site-footer__name">{BRAND.name}</p>
            <p className="site-footer__note">{FOOTER.note}</p>
          </div>
          <nav aria-label="Footer" className="site-footer__nav">
            <ul>
              {NAV.map((item) => (
                <li key={item.to}>
                  <Link to={item.to}>{item.label}</Link>
                </li>
              ))}
            </ul>
          </nav>
          <p className="site-footer__ack">{FOOTER.acknowledgement}</p>
          <p className="site-footer__fine">
            <span>
              © {new Date().getFullYear()} {BRAND.legalName}
            </span>
            <span className="site-footer__coords">{BRAND.coordinates}</span>
          </p>
        </div>
      </footer>
    </div>
  );
}

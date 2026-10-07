import { Link } from 'react-router';
import { Seo } from '../components/Seo';
import { ArrowRight } from '../components/Icons';

interface NotFoundProps {
  title?: string;
  body?: string;
}

export function NotFoundPage({
  title = 'Nothing at this address.',
  body = 'The page may have moved, or the link has a typo in it.',
}: NotFoundProps) {
  return (
    <div className="page not-found container">
      <Seo title="Not found" />
      <p className="eyebrow">404</p>
      <h1 className="page-title">{title}</h1>
      <p className="not-found__body">{body}</p>
      <div className="not-found__actions">
        <Link to="/shop" className="btn btn--primary">
          Browse the shop <ArrowRight />
        </Link>
        <Link to="/" className="btn btn--link">
          Go to the home page
        </Link>
      </div>
    </div>
  );
}

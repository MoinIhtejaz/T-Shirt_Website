import { Link } from 'react-router';
import { Seo } from '../components/Seo';
import { Waterline } from '../components/Waterline';
import { ArrowRight } from '../components/Icons';
import { ABOUT, BRAND } from '../content/copy';

export function AboutPage() {
  return (
    <div className="page about">
      <Seo title="About" description={ABOUT.intro} />
      <header className="about__head">
        <div className="container">
          <p className="eyebrow">About us</p>
          <h1 className="page-title about__title">{ABOUT.title}</h1>
          <p className="about__intro">{ABOUT.intro}</p>
        </div>
        <Waterline className="about__waterline" />
      </header>
      <div className="about__body">
        <div className="container prose">
          {ABOUT.paragraphs.map((p) => (
            <p key={p.slice(0, 24)}>{p}</p>
          ))}
          <p className="about__signoff">{ABOUT.signoff}</p>
          <p className="about__sig">
            {BRAND.name}, {BRAND.place}
          </p>
          <Link to="/shop" className="btn btn--on-dark">
            See the shirts <ArrowRight />
          </Link>
        </div>
      </div>
    </div>
  );
}

import { useEffect } from 'react';
import { BRAND } from '../content/copy';

const SITE_NAME = BRAND.name;

interface SeoProps {
  /** Page name. Rendered as "<title> · 2A Marketing". Omit to leave the title alone. */
  title?: string;
  description?: string;
  /** Adds <meta name="robots" content="noindex"> while the page is mounted. */
  noindex?: boolean;
}

/** Sets the document title, meta description and robots tag for the current page. */
export function Seo({ title, description, noindex = false }: SeoProps) {
  useEffect(() => {
    if (!title) return;
    document.title = title === SITE_NAME ? title : `${title} · ${SITE_NAME}`;
  }, [title]);

  useEffect(() => {
    if (!description) return;
    let meta = document.head.querySelector<HTMLMetaElement>('meta[name="description"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'description';
      document.head.appendChild(meta);
    }
    meta.content = description;
  }, [description]);

  useEffect(() => {
    if (!noindex) return;
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex';
    meta.dataset.seo = 'noindex';
    document.head.appendChild(meta);
    return () => meta.remove();
  }, [noindex]);

  return null;
}

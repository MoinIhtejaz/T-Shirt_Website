import { Seo } from '../components/Seo';
import { SIZE_CHART, SIZE_GUIDE } from '../content/copy';

export function SizeGuidePage() {
  return (
    <div className="page size-guide container">
      <Seo title="Size guide" description="Chest and length measurements in centimetres for 2A Marketing shirts, S to XXL." />
      <header className="page-head page-head--flush">
        <p className="eyebrow">Fit</p>
        <h1 className="page-title">{SIZE_GUIDE.title}</h1>
        <p className="page-head__lede">{SIZE_GUIDE.intro}</p>
      </header>

      <div className="size-guide__layout">
        <div className="size-table-wrap">
          <table className="size-table">
            <caption>Shirt measurements in centimetres, laid flat</caption>
            <thead>
              <tr>
                <th scope="col">Size</th>
                <th scope="col">
                  Chest <span className="size-table__unit">cm</span>
                </th>
                <th scope="col">
                  Length <span className="size-table__unit">cm</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {SIZE_CHART.map((row) => (
                <tr key={row.size}>
                  <th scope="row">{row.size}</th>
                  <td>{row.chestCm}</td>
                  <td>{row.lengthCm}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <section className="measure" aria-labelledby="measure-title">
          <h2 id="measure-title" className="measure__title">
            How to measure
          </h2>
          <svg className="measure__diagram" viewBox="0 0 200 200" role="img" aria-labelledby="measure-svg-title">
            <title id="measure-svg-title">
              A t-shirt outline with the chest measured across from armpit to armpit and the length measured from shoulder
              to hem
            </title>
            <path
              className="measure__shirt"
              d="M70 22 L42 34 L14 66 L36 84 L52 70 L52 182 L148 182 L148 70 L164 84 L186 66 L158 34 L130 22 C124 36 112 42 100 42 C88 42 76 36 70 22 Z"
            />
            <line className="measure__line" x1="54" y1="80" x2="146" y2="80" />
            <path className="measure__tick" d="M54 74v12M146 74v12" />
            <text className="measure__text" x="100" y="74" textAnchor="middle">
              Chest
            </text>
            <line className="measure__line" x1="168" y1="28" x2="168" y2="182" />
            <path className="measure__tick" d="M162 28h12M162 182h12" />
            <text className="measure__text" x="176" y="112" textAnchor="middle" transform="rotate(90 176 112)">
              Length
            </text>
          </svg>
          <dl className="measure__tips">
            {SIZE_GUIDE.tips.map((t) => (
              <div key={t.term} className="measure__tip">
                <dt>{t.term}</dt>
                <dd>{t.text}</dd>
              </div>
            ))}
          </dl>
          <p className="measure__note">{SIZE_GUIDE.amazonNote}</p>
        </section>
      </div>
    </div>
  );
}

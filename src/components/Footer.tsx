// R-X-02, R-X-03, R-X-05, R-X-06.
import { DISCLAIMER_TEXT, FEEDBACK_EMAIL, PRIVACY_TEXT } from '../config'
import { GLOSSARY } from '../glossary'

export function Footer() {
  return (
    <footer className="foot">
      <p data-testid="footer-disclaimer">{DISCLAIMER_TEXT}</p>
      <p>{PRIVACY_TEXT}</p>
      <p>
        <a href={`mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent('Deal Ops Toolkit feedback')}`}>Send feedback by email</a>{' '}
        <span className="warn-text">Please don&apos;t send real investor information.</span>
      </p>
      <details className="glossary">
        <summary>Glossary</summary>
        <dl>
          {Object.entries(GLOSSARY).map(([term, text]) => (
            <div key={term}>
              <dt>{term}</dt>
              <dd>{text}</dd>
            </div>
          ))}
        </dl>
      </details>
    </footer>
  )
}

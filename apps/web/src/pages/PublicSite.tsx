import { Brand, TAGLINE } from '../components/brand';
import { RiskMatrix } from '../components/charts';
import { Link } from '../lib/router';
import { DEFAULT_RISK_MATRIX } from '@forgehse/shared';
import { LightField, Tilt, Reveal } from '../components/fx';

// Illustrative distribution for the hero graphic only (clearly captioned as an example).
const EXAMPLE_CELLS = [
  { likelihood: 4, severity: 5, count: 2 }, { likelihood: 3, severity: 4, count: 5 }, { likelihood: 2, severity: 5, count: 1 },
  { likelihood: 3, severity: 3, count: 7 }, { likelihood: 4, severity: 2, count: 4 }, { likelihood: 2, severity: 3, count: 6 },
  { likelihood: 1, severity: 4, count: 2 }, { likelihood: 2, severity: 2, count: 9 }, { likelihood: 1, severity: 2, count: 3 },
];

const FEATURES = [
  ['Observations & hazards', 'Report unsafe acts and conditions in under a minute, with photos, location and a risk rating calculated the same way every time.'],
  ['Corrective actions', 'Assign an owner and a due date, collect evidence, and close only after an independent verification. Overdue items surface on their own.'],
  ['Live command centre', 'Open items, overdue actions and the open-risk matrix, computed from your records — filtered to the projects and sites you are responsible for.'],
  ['Registers & reports', 'Print-ready PDF registers and spreadsheet exports with filters, timestamps, page numbers and the source of every figure.'],
  ['Field app', 'An Android app for site teams that keeps working without signal and syncs once connectivity returns, without creating duplicates.'],
  ['AI Studio', 'Ask in text or by voice and get fast answers grounded in your own records, with references. Generate checklists, toolbox talks, method statements, posters and flowcharts from one line.'],
  ['Document review', 'Upload a method statement or procedure and get a structured gap review against good HSE practice. Every AI output is a draft a competent person reviews.'],
];

export function PublicSite() {
  return (
    <div className="public">
      <nav className="pub-nav" aria-label="Site">
        <Brand />
        <span className="spacer" />
        <a className="link" href="#features">Features</a>
        <a className="link" href="#workflow">How it works</a>
        <a className="link" href="#security">Security</a>
        <a className="link" href="#contact">Contact</a>
        <Link to="/login" className="btn btn-primary btn-sm">Sign in</Link>
      </nav>

      <header className="hero has-lightfield">
        <LightField />
        <div>
          <h1>Every hazard, seen and <span className="grad">closed out.</span></h1>
          <p className="lede">FORGEHSE is the AI-powered HSE workspace for construction and infrastructure teams. Report on site, assign the fix, verify it — and ask AI Studio for answers, checklists, documents and posters in seconds.</p>
          <p className="tag">{TAGLINE}</p>
          <div className="row">
            <Link to="/login" className="btn btn-primary btn-lg">Sign in to your workspace</Link>
            <a href="#contact" className="btn btn-lg">Request a walkthrough</a>
          </div>
        </div>
        <Tilt className="hero-matrix-wrap" max={8}><figure className="hero-matrix" aria-label="Example open-risk matrix" style={{ margin: 0 }}>
          <div className="caption"><span>Open observations by risk</span><span>Example</span></div>
          <RiskMatrix size={DEFAULT_RISK_MATRIX.size} bands={DEFAULT_RISK_MATRIX.bands} cells={EXAMPLE_CELLS} />
          <figcaption className="note">The dashboard plots every open item by likelihood and severity, so the top-right corner never goes unnoticed.</figcaption>
        </figure></Tilt>
      </header>

      <section className="section" id="features">
        <div className="section-head">
          <h2>Built around how site HSE actually runs</h2>
          <p>Daily observations, weekly registers and monthly reviews draw on the same records, so nobody re-types data into a spreadsheet at month end.</p>
        </div>
        <div className="feature-list cards">
          {FEATURES.map(([t, d], i) => <Reveal key={t} delay={i * 60}><Tilt className="feature" max={5}><h3>{t}</h3><p>{d}</p></Tilt></Reveal>)}
        </div>
      </section>

      <section className="section alt" id="workflow">
        <div className="section-head">
          <h2>From report to verified close-out</h2>
          <p>Each step is recorded with who did it and when, so the history stands up to an audit or a client review.</p>
        </div>
        <ol className="flow">
          <li><h3>Report</h3><p>Anyone on site records what they saw, where, and what they did about it immediately.</p></li>
          <li><h3>Rate</h3><p>Likelihood × severity on your organisation's matrix gives a consistent risk band.</p></li>
          <li><h3>Assign</h3><p>An HSE officer sets the corrective action, owner and due date.</p></li>
          <li><h3>Act</h3><p>The owner submits what was done, with photo evidence.</p></li>
          <li><h3>Verify</h3><p>A different, authorised person checks it on site and closes it.</p></li>
        </ol>
      </section>

      <section className="section" id="security">
        <div className="section-head">
          <h2>Security your client will ask about</h2>
          <p>Incident and personnel records are sensitive. FORGEHSE treats them that way by default.</p>
        </div>
        <div className="security-grid">
          <div><h3>Server-side permissions</h3><p>Every request is checked against the user's role for that organisation, project and site. Hiding a button is never the control.</p></div>
          <div><h3>Separated organisations</h3><p>Records are bound to one organisation in the database itself; one tenant cannot reach another's data.</p></div>
          <div><h3>Tamper-evident audit trail</h3><p>Approvals, status changes, permission changes and exports are written to an append-only log.</p></div>
          <div><h3>AI that stays on the server</h3><p>AI requests go through the backend with only the records you are allowed to see. Generated documents are drafts until a competent person reviews them, and exports say so.</p></div>
        </div>
      </section>

      <section className="section alt" id="contact">
        <div className="section-head">
          <h2>Talk to us</h2>
          <p>For a walkthrough with your own projects and procedures, contact BRITTO'S AI FORGE.</p>
        </div>
        <p><a href="mailto:hello@forgehse.example">hello@forgehse.example</a></p>
        <p className="muted small" style={{ marginTop: 6 }}>Replace this address with your sales contact before going live.</p>
      </section>

      <footer className="pub-foot">
        <Brand />
        <span className="spacer" />
        <span>© {new Date().getFullYear()} BRITTO'S AI FORGE</span>
      </footer>
    </div>
  );
}

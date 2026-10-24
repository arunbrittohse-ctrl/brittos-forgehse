import { useState } from 'react';

export type TelemetrySeverity = 'critical' | 'high' | 'medium' | 'low';

export interface TelemetryEventCardProps {
  /** Event values must come from an authorized application data source, never demo constants. */
  eventId: string;
  title: string;
  description: string;
  severity: TelemetrySeverity;
  sourceLabel?: string;
  /** Resolve only after the server confirms the authorized acknowledgement. */
  onAcknowledge?: () => Promise<void>;
  /** Open the application's real event detail/log route. */
  onViewLog: () => void;
}

/**
 * Reusable BRITTO'S FORGEHSE telemetry alert card.
 * This presentational component does not fetch data, grant permissions, or
 * acknowledge an event by itself. Connect callbacks to existing authorized APIs.
 */
export function TelemetryEventCard({
  eventId,
  title,
  description,
  severity,
  sourceLabel = 'Telemetry event',
  onAcknowledge,
  onViewLog,
}: TelemetryEventCardProps) {
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ state: 'success' | 'error'; message: string } | null>(null);

  async function acknowledge() {
    if (!onAcknowledge || busy) return;
    setBusy(true);
    setFeedback(null);
    try {
      await onAcknowledge();
      setFeedback({ state: 'success', message: 'Acknowledgement confirmed.' });
    } catch {
      setFeedback({ state: 'error', message: 'Acknowledgement failed. The event remains unconfirmed; please retry or open the log.' });
    } finally {
      setBusy(false);
    }
  }

  const severityLabel = severity === 'critical' ? 'CRITICAL EXPOSURE'
    : severity === 'high' ? 'HIGH PRIORITY'
    : severity === 'medium' ? 'MEDIUM PRIORITY' : 'LOW PRIORITY';

  return (
    <article className="telemetry-card" aria-labelledby={`telemetry-title-${eventId}`}>
      <header className="telemetry-card__header">
        <span className="telemetry-card__feed">
          <span className="telemetry-card__pulse" aria-hidden="true" />
          {sourceLabel}
        </span>
        <span className="telemetry-card__id">{eventId}</span>
      </header>
      <div className="telemetry-card__body">
        <h3 id={`telemetry-title-${eventId}`} className="telemetry-card__title">{title}</h3>
        <p className="telemetry-card__description">{description}</p>
        <span className="telemetry-card__classification" data-severity={severity} role="status">
          {severityLabel}
        </span>
      </div>
      <footer className="telemetry-card__actions">
        {onAcknowledge && (
          <button className="btn btn-primary" type="button" onClick={() => void acknowledge()} disabled={busy}>
            {busy ? 'Confirming…' : 'Acknowledge Event'}
          </button>
        )}
        <button className="btn btn-telemetry-secondary" type="button" onClick={onViewLog} disabled={busy}>
          View Log
        </button>
      </footer>
      {feedback && (
        <p className="telemetry-card__feedback" data-state={feedback.state} role={feedback.state === 'error' ? 'alert' : 'status'}>
          {feedback.message}
        </p>
      )}
    </article>
  );
}

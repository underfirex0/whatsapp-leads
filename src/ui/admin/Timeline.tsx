import type { ActivityEntry } from '../../core/types';
import { fmt } from '../components';

const TONE: Record<string, string> = {
  demand_created: 'accent',
  distributed: 'success',
  distribution_resent: 'success',
  distribution_failed: 'danger',
  delivery_failed: 'danger',
  consent_refused: 'danger',
  consent_accepted: 'success',
  status_changed: 'accent',
  outcome: 'success',
  awaiting_admin: 'warning',
  subscription_changed: 'accent',
  subscription_requested: 'warning',
  duplicate_event: 'warning',
  stale_button: 'warning',
};

export function Timeline({ entries, limit }: { entries: ActivityEntry[]; limit?: number }) {
  const sorted = [...entries].sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
  if (sorted.length === 0) return <div className="subtle small">Aucune activité.</div>;
  return (
    <ol className="timeline">
      {sorted.map((e) => (
        <li key={e.id}>
          <span className={`pt ${TONE[e.action] ?? ''}`} />
          <div>
            <div className="what">{e.label}</div>
            <div className="meta">
              {fmt.dateTime(e.at)} · {e.actor}
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}

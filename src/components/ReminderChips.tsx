import { Link } from 'react-router-dom'
import { SectionHeading } from './SectionHeading'

export interface Reminder { id: string; label: string; overdue: boolean }

/** The open todos, as one horizontal run of pills. Every chip lands on Bookings. */
export function ReminderChips({ reminders }: { reminders: Reminder[] }) {
  return (
    <section className="home-row">
      <SectionHeading icon="sparkle" className="home-row__heading">Reminders</SectionHeading>
      {reminders.length === 0 ? (
        <p className="caption home-row__empty">Nothing left to book</p>
      ) : (
        <ul className="reminder-chips">
          {reminders.map(r => (
            <li key={r.id} className="reminder-chips__item">
              <Link
                to="/tickets"
                className={`reminder-chip${r.overdue ? ' reminder-chip--overdue' : ''}`}
              >
                {r.label}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

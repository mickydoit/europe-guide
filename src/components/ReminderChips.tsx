import { Link } from 'react-router-dom'

export interface Reminder { id: string; label: string; overdue: boolean }

/** The open todos, as one horizontal run of pills. Every chip lands on Bookings. */
export function ReminderChips({ reminders }: { reminders: Reminder[] }) {
  return (
    <section className="home-row">
      <h2 className="h5 home-row__heading">Reminders</h2>
      {reminders.length === 0 ? (
        <p className="caption home-row__empty">Nothing left to book</p>
      ) : (
        <ul className="reminder-chips">
          {reminders.map(r => (
            <li key={r.id} className="reminder-chips__item">
              <Link
                to="/bookings"
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

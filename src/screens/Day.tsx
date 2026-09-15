import { Fragment } from 'react'
import { useParams, useNavigate, Navigate } from 'react-router-dom'
import { useTrip } from '../lib/trip'
import { useChecks } from '../lib/state'
import { currentAndNext, currentBlock, dayIndex, fmtDay, nowInTz, todayInTrip } from '../lib/time'
import { TripPicker } from '../components/TripPicker'
import { NowNext } from '../components/NowNext'
import { RouteStrip } from '../components/RouteStrip'
import { StopCard } from '../components/StopCard'
import { Md } from '../components/Md'
import type { Block, ItemRow } from '../lib/types'

const BLOCK_ORDER: Block[] = ['morning', 'midday', 'evening', null]
const BLOCK_LABEL: Record<string, string> = { morning: 'Morning', midday: 'Midday', evening: 'Evening' }

export function Day() {
  const { date: dateParam } = useParams<{ date?: string }>()
  const navigate = useNavigate()
  const { trips, slug, content, loading, error, setSlug } = useTrip()
  const { done, toggle } = useChecks(content?.trip.slug ?? '')

  if (loading && !content) {
    return <main className="screen"><p className="caption">Loading…</p></main>
  }
  if (trips.length === 0) {
    return <main className="screen"><p className="caption">No trips yet. Run the import on your laptop.</p></main>
  }
  if (error && !content) {
    return <main className="screen"><p className="caption">{error}</p></main>
  }
  if (!content) return null

  const trip = content.trip
  const days = content.days
  const today = todayInTrip(trip)
  const resolvedDate = dateParam ?? today ?? days[0]?.date ?? null

  if (!dateParam && resolvedDate) {
    return <Navigate to={`/day/${resolvedDate}`} replace />
  }
  if (!resolvedDate) {
    return <main className="screen"><p className="caption">No days yet.</p></main>
  }

  const date = resolvedDate
  const idx = dayIndex(days, date)
  const day = idx >= 0 ? days[idx] : null
  const prevDay = idx > 0 ? days[idx - 1] : null
  const nextDay = idx >= 0 && idx < days.length - 1 ? days[idx + 1] : null

  const dayItems = content.items.filter(i => i.date === date)
  const optionsByParent = new Map<string, ItemRow[]>()
  for (const i of dayItems) {
    if (i.kind === 'option' && i.parent_item) {
      const arr = optionsByParent.get(i.parent_item) ?? []
      arr.push(i)
      optionsByParent.set(i.parent_item, arr)
    }
  }
  const mainItems = dayItems.filter(i => i.kind !== 'option').sort((a, b) => a.sort - b.sort)
  const blocks = BLOCK_ORDER
    .map(block => ({ block, items: mainItems.filter(i => i.block === block) }))
    .filter(g => g.items.length > 0)

  const dayRoutes = content.routes.filter(r => r.date === date)

  const isToday = date === today
  const nowMinutes = nowInTz(trip.timezone).minutes
  const activeBlock = isToday ? currentBlock(nowMinutes) : null
  const { current, next, minutesToNext } = isToday
    ? currentAndNext(content.alerts, date, nowMinutes)
    : { current: null, next: null, minutesToNext: null }

  function goTrip(newSlug: string) {
    setSlug(newSlug)
    navigate('/day')
  }

  return (
    <main className="screen day">
      <TripPicker trips={trips} active={slug} onSelect={goTrip} />

      <div className="day-header">
        <button
          type="button"
          className="day-nav__arrow"
          aria-label="Previous day"
          disabled={!prevDay}
          onClick={() => prevDay && navigate(`/day/${prevDay.date}`)}
        >
          ‹
        </button>
        <div className="day-title-row">
          <h1 className="day-title">
            {fmtDay(date)}
            {day?.title ? ` — ${day.title}` : ''}
          </h1>
          {day?.status === 'locked' && <span className="status-pill status-pill--locked">LOCKED</span>}
          {day?.status === 'locked_except_dinner' && (
            <span className="status-pill status-pill--dinner">LOCKED except dinner</span>
          )}
        </div>
        <button
          type="button"
          className="day-nav__arrow"
          aria-label="Next day"
          disabled={!nextDay}
          onClick={() => nextDay && navigate(`/day/${nextDay.date}`)}
        >
          ›
        </button>
        {today && !isToday && (
          <button type="button" className="btn--text day-nav__today" onClick={() => navigate(`/day/${today}`)}>
            Today
          </button>
        )}
      </div>

      {isToday && <NowNext current={current} next={next} minutesToNext={minutesToNext} />}

      {blocks.map((g, gi) => (
        <Fragment key={g.block ?? 'none'}>
          {gi === 0 && <RouteStrip routes={dayRoutes} />}
          <section className={`day-block${isToday && g.block === activeBlock ? ' day-block--current' : ''}`}>
            {g.block && <h2 className="h5 day-block__heading">{BLOCK_LABEL[g.block]}</h2>}
            {g.items.map(item => {
              if (item.kind === 'stop') {
                return (
                  <StopCard
                    key={item.id}
                    item={item}
                    options={optionsByParent.get(item.id) ?? []}
                    tripName={trip.name}
                    done={done.has(item.id)}
                    onToggle={() => toggle(item.id)}
                  />
                )
              }
              if (item.kind === 'note') {
                return <p key={item.id} className="note"><Md text={item.plan} /></p>
              }
              if (item.kind === 'route_link') {
                return (
                  <p key={item.id} className="route-link">
                    <a href={item.url ?? undefined} target="_blank" rel="noopener noreferrer">{item.plan}</a>
                    {item.details ? ` — ${item.details}` : ''}
                  </p>
                )
              }
              return null
            })}
          </section>
        </Fragment>
      ))}
    </main>
  )
}

import { lazy, Suspense } from 'react'
import { Routes, Route, Outlet, Navigate } from 'react-router-dom'
import { AuthProvider, RequireAuth } from './lib/auth'
import { TripProvider } from './lib/trip'
import { TabBar } from './components/TabBar'
import { ScrollReset } from './components/ScrollReset'
import { SignIn } from './screens/SignIn'
import { ResetPassword } from './screens/ResetPassword'
import { More } from './screens/More'
import { Home } from './screens/Home'
import { Day } from './screens/Day'
import { Tickets } from './screens/Tickets'
import { TicketDetail } from './screens/TicketDetail'
import { PlaceDetail } from './screens/PlaceDetail'
import { Routes as RoutesScreen } from './screens/Routes'
const MapScreen = lazy(() => import('./screens/Map'))
function Shell() { return <><ScrollReset /><Outlet /><TabBar /></> }
export const bookingsRedirect = <Navigate to="/tickets" replace />
export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/signin" element={<SignIn />} />
        <Route path="/reset" element={<ResetPassword />} />
        <Route element={<RequireAuth><TripProvider><Shell /></TripProvider></RequireAuth>}>
          <Route path="/" element={<Home />} />
          <Route path="/day" element={<Day />} />
          <Route path="/day/:date" element={<Day />} />
          <Route path="/map/:date?" element={
            <Suspense fallback={<main className="screen"><p className="caption">Loading map…</p></main>}>
              <MapScreen />
            </Suspense>
          } />
          <Route path="/tickets" element={<Tickets />} />
          <Route path="/ticket/:trip/:id" element={<TicketDetail />} />
          <Route path="/place/:id" element={<PlaceDetail />} />
          <Route path="/bookings" element={bookingsRedirect} />
          <Route path="/routes" element={<RoutesScreen />} />
          <Route path="/more" element={<More />} />
        </Route>
      </Routes>
    </AuthProvider>
  )
}

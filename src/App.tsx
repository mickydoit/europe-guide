import { Routes, Route, Outlet } from 'react-router-dom'
import { AuthProvider, RequireAuth } from './lib/auth'
import { TabBar } from './components/TabBar'
import { Placeholder } from './screens/Placeholder'
import { SignIn } from './screens/SignIn'
import { ResetPassword } from './screens/ResetPassword'
import { More } from './screens/More'
function Shell() { return <><Outlet /><TabBar /></> }
export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/signin" element={<SignIn />} />
        <Route path="/reset" element={<ResetPassword />} />
        <Route element={<RequireAuth><Shell /></RequireAuth>}>
          <Route path="/" element={<Placeholder title="Home" />} />
          <Route path="/day" element={<Placeholder title="Day" />} />
          <Route path="/map" element={<Placeholder title="Map" />} />
          <Route path="/bookings" element={<Placeholder title="Bookings" />} />
          <Route path="/more" element={<More />} />
        </Route>
      </Routes>
    </AuthProvider>
  )
}

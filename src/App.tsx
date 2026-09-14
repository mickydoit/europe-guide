import { Routes, Route } from 'react-router-dom'
import { TabBar } from './components/TabBar'
import { Placeholder } from './screens/Placeholder'
export default function App() {
  return (
    <>
      <Routes>
        <Route path="/" element={<Placeholder title="Home" />} />
        <Route path="/day" element={<Placeholder title="Day" />} />
        <Route path="/map" element={<Placeholder title="Map" />} />
        <Route path="/bookings" element={<Placeholder title="Bookings" />} />
        <Route path="/more" element={<Placeholder title="More" />} />
      </Routes>
      <TabBar />
    </>
  )
}

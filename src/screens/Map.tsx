import { useNavigate } from 'react-router-dom'

export default function Map() {
  const navigate = useNavigate()
  const close = () => {
    if (window.history.length <= 1) navigate('/day')
    else navigate(-1)
  }
  return (
    <main className="map-screen">
      <button type="button" className="map-close" aria-label="Close map" onClick={close}>Close</button>
      <p className="caption">Map loading…</p>
    </main>
  )
}

import { pointsFromGoogleUrl, extractPlace } from '../../scripts/import/places'
import { tripMeta } from '../../scripts/import/timezones'

test('points in order from a dir url', () => {
  const u = 'https://www.google.com/maps/dir/?api=1&origin=Time+Out+Market+Lisboa&destination=Miradouro+de+Santa+Catarina%2C+Lisboa&waypoints=R.+da+Bica+de+Duarte+Belo%2C+Lisboa%7CManteigaria%2C+Rua+do+Loreto+2%2C+Lisboa&travelmode=walking'
  expect(pointsFromGoogleUrl(u)).toEqual({ names: ['Time Out Market Lisboa', 'R. da Bica de Duarte Belo, Lisboa', 'Manteigaria, Rua do Loreto 2, Lisboa', 'Miradouro de Santa Catarina, Lisboa'], travelmode: 'walking' })
})
test('url without waypoints', () => {
  expect(pointsFromGoogleUrl('https://www.google.com/maps/dir/?api=1&origin=A&destination=B&travelmode=driving').names).toEqual(['A', 'B'])
})
test('extractPlace cases', () => {
  expect(extractPlace('**Senzi**, R. da Moeda 12')).toEqual({ place_name: 'Senzi', address: 'R. da Moeda 12' })
  expect(extractPlace('**Time Out Market**')).toEqual({ place_name: 'Time Out Market', address: null })
  expect(extractPlace('Lunch: **Miolo**, R. de Belém 36')).toEqual({ place_name: 'Miolo', address: 'R. de Belém 36' })
  expect(extractPlace('**Mesa de Frades** — fado show with dinner — **BOOKED**')).toEqual({ place_name: 'Mesa de Frades', address: null })
  expect(extractPlace('Walk to the meeting point')).toEqual({ place_name: null, address: null })
  expect(extractPlace('**Tell the guide what to skip**')).toEqual({ place_name: null, address: null })
})
test('extractPlace: bold name followed by plain text with no separator', () => {
  expect(extractPlace('**Castello Alto** viewpoint')).toEqual({ place_name: 'Castello Alto', address: null })
  expect(extractPlace('**Portas do Sol / Graça** golden hour')).toEqual({ place_name: 'Portas do Sol / Graça', address: null })
  expect(extractPlace('**Early start.** Long day')).toEqual({ place_name: null, address: null })
  expect(extractPlace('**Book before you fly:** Ponto Final')).toEqual({ place_name: null, address: null })
})
test('tripMeta', () => {
  expect(tripMeta('Lisbon', {})).toEqual({ timezone: 'Europe/Lisbon', country: 'Portugal', country_code: 'pt' })
  expect(tripMeta('Valle', { timezone: 'Europe/Rome', country: 'Italy' })).toEqual({ timezone: 'Europe/Rome', country: 'Italy', country_code: 'it' })
  expect(() => tripMeta('Nowhere', {})).toThrow(/timezone/)
})

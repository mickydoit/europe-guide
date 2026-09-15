import { slug, itemId } from '../../scripts/import/ids'
test('slug folds accents and punctuation', () => {
  expect(slug('**Senzi**, R. da Moeda 12')).toBe('senzi-r-da-moeda-12')
  expect(slug('Miradouro de Santa Catarina')).toBe('miradouro-de-santa-catarina')
  expect(slug('Praça do Comércio')).toBe('praca-do-comercio')
})
test('itemId uses HHMM when timed, zero-padded seq otherwise', () => {
  expect(itemId('valle', '2026-11-02', '08:00', 3, '**Senzi**, R. da Moeda 12')).toBe('valle/2026-11-02/0800/senzi-r-da-moeda-12')
  expect(itemId('valle', '2026-11-02', null, 3, 'Tell the guide')).toBe('valle/2026-11-02/003/tell-the-guide')
})

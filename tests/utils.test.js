const { daysInclusive } = require('../lib/utils');

test('daysInclusive returns correct inclusive days for same day', () => {
  expect(daysInclusive('2025-12-09', '2025-12-09')).toBe(1);
});

test('daysInclusive returns correct inclusive days for multi-day range', () => {
  expect(daysInclusive('2025-12-09', '2025-12-11')).toBe(3);
});

test('daysInclusive returns 0 for invalid dates', () => {
  expect(daysInclusive('invalid', '2025-12-11')).toBe(0);
});

test('daysInclusive returns 0 for end before start', () => {
  expect(daysInclusive('2025-12-12', '2025-12-11')).toBe(0);
});

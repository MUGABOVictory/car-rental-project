function daysInclusive(startDate, endDate) {
  const start = new Date(startDate);
  const end = new Date(endDate);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return 0;
  if (end < start) return 0;
  const msPerDay = 1000 * 60 * 60 * 24;
  const days = Math.ceil((end - start) / msPerDay) + 1;
  return Math.max(1, days);
}

module.exports = { daysInclusive };

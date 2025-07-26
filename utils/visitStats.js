// utils/visitStats.js
function calculateVisitStats(visits = []) {
  let totalVisited = 0;
  let totalNotVisited = 0;
  let totalExtra = 0;

  // Single loop through visits for better performance
  visits.forEach(v => {
    if (v.status === 'visited') totalVisited++;
    if (v.status === 'not_visited') totalNotVisited++;
    if (v.isExtra) totalExtra++;
  });

  return {
    totalVisits: visits.length,
    totalVisited,
    totalNotVisited,
    totalExtra
  };
}

module.exports = calculateVisitStats;
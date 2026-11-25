export function formatInterval(minutes: number): string {
  if (minutes >= 1440 && minutes % 1440 === 0) return `${minutes / 1440} 天`;
  if (minutes >= 60) return `${Math.round(minutes / 60)} 小时`;
  return `${minutes} 分钟`;
}

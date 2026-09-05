export function displayDate(value: string | undefined, timezone: string) {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const day = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  });
  return day.format(date) === day.format(new Date())
    ? date.toLocaleTimeString("en-GB", {
        timeZone: timezone,
        hour: "2-digit",
        minute: "2-digit",
      })
    : date.toLocaleDateString("en-GB", {
        timeZone: timezone,
        day: "numeric",
        month: "short",
      });
}

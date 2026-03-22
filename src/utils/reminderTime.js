/**
 * Reminder date/time from the app are "wall clock" values (what the user picked),
 * meant to be interpreted in one fixed zone — default Africa/Lagos (WAT, UTC+1).
 *
 * Using Date#setHours on the server uses the *host* TZ (often UTC on Railway/Render),
 * which shifts all reminders by several hours and can batch many sends when the
 * server wakes or when `now` finally crosses the wrong threshold.
 */

const DEFAULT_OFFSET = '+01:00'; // WAT — matches Africa/Lagos (no DST)

const pad2 = (n) => String(n).padStart(2, '0');

/**
 * @param {string} dateStr - YYYY-MM-DD
 * @param {string} timeStr - HH:mm or HH:mm:ss
 * @returns {Date | null}
 */
export function parseReminderWallClockToUtc(dateStr, timeStr) {
  if (!dateStr || !timeStr) return null;

  const dateParts = dateStr.split('-').map(Number);
  const [year, month, day] = dateParts;
  if (!year || !month || !day) return null;

  const timeParts = timeStr.split(':').map((p) => p.trim());
  const hour = Number(timeParts[0]);
  const minute = Number(timeParts[1] ?? 0);
  const second = Number(timeParts[2] ?? 0);

  if (Number.isNaN(hour) || Number.isNaN(minute) || Number.isNaN(second)) return null;

  const offset = process.env.REMINDER_TZ_OFFSET || DEFAULT_OFFSET;
  const isoLocal = `${year}-${pad2(month)}-${pad2(day)}T${pad2(hour)}:${pad2(minute)}:${pad2(second)}`;
  const d = new Date(`${isoLocal}${offset}`);
  return Number.isNaN(d.getTime()) ? null : d;
}

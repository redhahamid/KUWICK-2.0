// Prisma's @db.Time columns round-trip as JS Date objects with a fixed
// epoch date and the actual time-of-day in the UTC hour/minute/second
// getters — these helpers convert between that and "HH:MM[:SS]" strings.
export function parseTimeToDate(time: string): Date {
  const normalized = time.length === 5 ? `${time}:00` : time;
  return new Date(`1970-01-01T${normalized}.000Z`);
}

export function parseDateOnly(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

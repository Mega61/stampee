// The server's notion of "now", swappable in tests. Features that depend on
// calendar time (the advent calendar's doors) read it from here so a test can
// stand on any day without fake timers (which would stall Postgres I/O).
export const clock = {
  now: (): Date => new Date(),
};

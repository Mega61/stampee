// The server's notion of "now", swappable in tests. Features that depend on
// calendar time (the advent calendar's doors) read it from here so a test can
// stand on any day without fake timers (which would stall Postgres I/O).
//
// Outside production, FAKE_NOW=<ISO instant> starts the clock at that instant
// (it keeps ticking), so a local or staging run can walk through December
// before December. Production ignores it.
const fakeStart = process.env.NODE_ENV !== 'production' && process.env.FAKE_NOW ? Date.parse(process.env.FAKE_NOW) : NaN;
const offset = Number.isFinite(fakeStart) ? fakeStart - Date.now() : 0;

export const clock = {
  now: (): Date => new Date(Date.now() + offset),
};

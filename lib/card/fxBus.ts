import type { FxBus, FxBusEvents } from './types';

export const createFxBus = (): FxBus => {
  const handlers = new Map<keyof FxBusEvents, Set<(payload: never) => void>>();
  return {
    emit(type, payload) {
      handlers.get(type)?.forEach((handler) => (handler as (p: typeof payload) => void)(payload));
    },
    on(type, handler) {
      const set = handlers.get(type) ?? new Set();
      set.add(handler as (payload: never) => void);
      handlers.set(type, set);
      return () => set.delete(handler as (payload: never) => void);
    },
  };
};

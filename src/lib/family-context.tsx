"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, ApiFailure } from "./client";
import type { FamilyView, Item } from "./store";

// The family document, loaded once per page view and updated in place after each API
// call. Pages read it through useFamily(); nothing is cached in the browser beyond this.

type FamilyCtx = {
  family: FamilyView | null;
  loading: boolean;
  refresh: () => Promise<void>;
  setFamily: (f: FamilyView | null) => void;
  patchItem: (id: string, patch: Partial<Item> & Record<string, unknown>) => Promise<void>;
  removeItem: (id: string) => Promise<void>;
};

const Ctx = createContext<FamilyCtx | null>(null);

export function FamilyProvider({ children }: { children: ReactNode }) {
  const [family, setFamily] = useState<FamilyView | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await api.family();
      setFamily(res.family);
    } catch (e) {
      if (e instanceof ApiFailure && e.status === 404) setFamily(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load from the server
    void refresh();
  }, [refresh]);

  const patchItem = useCallback(async (id: string, patch: Partial<Item> & Record<string, unknown>) => {
    // Optimistic: apply locally, then reconcile with the server's copy.
    setFamily((f) => (f ? { ...f, items: f.items.map((it) => (it.id === id ? { ...it, ...patch } : it)) } : f));
    const res = await api.patchItem(id, patch);
    setFamily((f) => (f ? { ...f, items: f.items.map((it) => (it.id === id ? res.item : it)) } : f));
  }, []);

  const removeItem = useCallback(async (id: string) => {
    setFamily((f) => (f ? { ...f, items: f.items.filter((it) => it.id !== id) } : f));
    await api.deleteItem(id);
  }, []);

  const value = useMemo(() => ({ family, loading, refresh, setFamily, patchItem, removeItem }), [family, loading, refresh, patchItem, removeItem]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useFamily(): FamilyCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useFamily must be used inside FamilyProvider");
  return v;
}

import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { ModuleDef } from '../types';

let cache: ModuleDef[] | null = null;

export function useModules(): { modules: ModuleDef[]; loading: boolean } {
  const [modules, setModules] = useState<ModuleDef[]>(cache ?? []);
  const [loading, setLoading] = useState(cache === null);

  useEffect(() => {
    if (cache) return;
    let active = true;
    api<{ modules: ModuleDef[] }>('/api/modules')
      .then((data) => {
        cache = data.modules;
        if (active) setModules(data.modules);
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  return { modules, loading };
}

export function clearModulesCache(): void {
  cache = null;
}

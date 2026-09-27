import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { PublicSettings } from '../types';

const empty: PublicSettings = { system_name: 'TMS Event-Technik Lager', logo_url: '', support_email: '' };

export function usePublicSettings(): PublicSettings {
  const [settings, setSettings] = useState<PublicSettings>(empty);

  useEffect(() => {
    let alive = true;
    api<PublicSettings>('/api/settings/public')
      .then((data) => {
        if (alive) setSettings(data);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  return settings;
}
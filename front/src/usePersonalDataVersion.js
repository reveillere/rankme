import { useEffect, useState } from 'react';
import { LINKS_KEY, DECISIONS_KEY, PERSONAL_DATA_EVENT } from './personalData';

export function usePersonalDataVersion(key) {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const refresh = event => {
      const changed = event.type === 'storage' ? event.key : event.detail?.key;
      if (changed == null || (key ? changed === key : [LINKS_KEY, DECISIONS_KEY].includes(changed))) setVersion(value => value + 1);
    };
    window.addEventListener(PERSONAL_DATA_EVENT, refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener(PERSONAL_DATA_EVENT, refresh);
      window.removeEventListener('storage', refresh);
    };
  }, [key]);
  return version;
}

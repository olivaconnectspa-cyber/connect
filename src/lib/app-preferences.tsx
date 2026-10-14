import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Appearance } from 'react-native';

export type ThemePreference = 'system' | 'light' | 'dark';
export type MapPreference = 'inside' | 'google' | 'waze';
type PreferencesContextValue = {
  theme: ThemePreference;
  map: MapPreference;
  ready: boolean;
  setTheme: (theme: ThemePreference) => Promise<void>;
  setMap: (map: MapPreference) => Promise<void>;
};

const THEME_KEY = '@connect/preferences/theme';
const MAP_KEY = '@connect/preferences/map';
const PreferencesContext = createContext<PreferencesContextValue | null>(null);

export function AppPreferencesProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemePreference>('system');
  const [map, setMapState] = useState<MapPreference>('inside');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const [savedTheme, savedMap] = await Promise.all([AsyncStorage.getItem(THEME_KEY), AsyncStorage.getItem(MAP_KEY)]);
        if (savedTheme === 'system' || savedTheme === 'light' || savedTheme === 'dark') setThemeState(savedTheme);
        if (savedMap === 'inside' || savedMap === 'google' || savedMap === 'waze') setMapState(savedMap);
      } finally {
        setReady(true);
      }
    })();
  }, []);

  useEffect(() => {
    Appearance.setColorScheme(theme === 'system' ? 'unspecified' : theme);
  }, [theme]);

  const value = useMemo<PreferencesContextValue>(() => ({
    theme,
    map,
    ready,
    setTheme: async (next) => { setThemeState(next); await AsyncStorage.setItem(THEME_KEY, next); },
    setMap: async (next) => { setMapState(next); await AsyncStorage.setItem(MAP_KEY, next); },
  }), [theme, map, ready]);

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function useAppPreferences() {
  const value = useContext(PreferencesContext);
  if (!value) throw new Error('useAppPreferences must be used inside AppPreferencesProvider');
  return value;
}

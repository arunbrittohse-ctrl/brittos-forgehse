import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, View, Text, ActivityIndicator } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { api, loadToken, loadServer, clearToken, setSessionExpiredHandler, queueTransport } from './src/api';
import type { QueuedObservation, SyncSummary } from './src/offline/queue';
import { queue } from './src/offline/instance';
import { LoginScreen } from './src/screens/Login';
import { HomeScreen } from './src/screens/Home';
import { ReportScreen } from './src/screens/Report';
import { DetailScreen } from './src/screens/Detail';
import { AssistantScreen } from './src/screens/Assistant';
import { C, s } from './src/theme';
import type { Me, Meta } from './src/types';

const CACHE_ME = 'fhse.cache.me'; // projects/sites list + reference data, needed to report offline
const CACHE_META = 'fhse.cache.meta';

export type Route = { name: 'home' } | { name: 'report'; notes?: string } | { name: 'detail'; id: string } | { name: 'ai' };

export default function App() {
  const [booting, setBooting] = useState(true);
  const [me, setMe] = useState<Me | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [route, setRoute] = useState<Route>({ name: 'home' });
  const [online, setOnline] = useState(true);
  const [pending, setPending] = useState<QueuedObservation[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<SyncSummary | null>(null);
  const meRef = useRef<Me | null>(null);
  meRef.current = me;

  const refreshQueue = useCallback(async () => setPending(await queue.list()), []);

  const sync = useCallback(async (force = false) => {
    if (!meRef.current) return;
    setSyncing(true);
    try { setLastSync(await queue.sync(queueTransport, { force })); }
    finally { setSyncing(false); await refreshQueue(); }
  }, [refreshQueue]);

  const loadProfile = useCallback(async () => {
    try {
      const [m, mt] = await Promise.all([api<Me>('/auth/me'), api<Meta>('/observations/meta')]);
      setMe(m); setMeta(mt);
      await AsyncStorage.multiSet([[CACHE_ME, JSON.stringify(m)], [CACHE_META, JSON.stringify(mt)]]);
    } catch {
      // Offline start: fall back to the cached profile so field staff can still report.
      const [[, m], [, mt]] = await AsyncStorage.multiGet([CACHE_ME, CACHE_META]);
      if (m && mt) { setMe(JSON.parse(m)); setMeta(JSON.parse(mt)); }
    }
  }, []);

  const signOut = useCallback(async () => {
    try { await api('/auth/logout', { method: 'POST' }); } catch { /* offline is fine */ }
    await clearToken();
    await AsyncStorage.multiRemove([CACHE_ME, CACHE_META]); // queued drafts are kept for the next sign-in
    setMe(null); setRoute({ name: 'home' });
  }, []);

  useEffect(() => {
    setSessionExpiredHandler(() => { setMe(null); });
    (async () => {
      await loadServer();
      if (await loadToken()) await loadProfile();
      await refreshQueue();
      setBooting(false);
    })();
    const unsubNet = NetInfo.addEventListener((st) => {
      const isOnline = !!st.isConnected && st.isInternetReachable !== false;
      setOnline(isOnline);
      if (isOnline) void sync(true); // connectivity returned: flush the queue now
    });
    const appSub = AppState.addEventListener('change', (st) => { if (st === 'active') void sync(); });
    const timer = setInterval(() => void sync(), 60_000);
    return () => { unsubNet(); appSub.remove(); clearInterval(timer); };
  }, [loadProfile, refreshQueue, sync]);

  if (booting) return <View style={[s.screen, { justifyContent: 'center' }]}><ActivityIndicator color={C.electric} /></View>;

  return (
    <SafeAreaProvider>
      <SafeAreaView style={s.screen} edges={['top', 'bottom']}>
        <StatusBar style={me ? 'dark' : 'light'} />
        {!online && me && <Text style={{ backgroundColor: C.navy, color: C.white, textAlign: 'center', padding: 6, fontSize: 13 }}>Offline. New reports are saved on this phone and sent automatically.</Text>}
        {!me ? <LoginScreen onSignedIn={async () => { await loadProfile(); await sync(true); }} /> :
          route.name === 'home' ? <HomeScreen me={me} pending={pending} syncing={syncing} lastSync={lastSync} online={online}
            onReport={() => setRoute({ name: 'report' })} onAi={() => setRoute({ name: 'ai' })} onOpen={(id) => setRoute({ name: 'detail', id })} onSync={() => void sync(true)}
            onRetry={async (ref) => { await queue.retry(ref); await sync(true); }} onDiscard={async (ref) => { await queue.remove(ref); await refreshQueue(); }} onSignOut={signOut} /> :
          route.name === 'ai' ? <AssistantScreen online={online} onBack={() => setRoute({ name: 'home' })} onReportFromNotes={(notes) => setRoute({ name: 'report', notes })} /> :
          route.name === 'report' && meta ? <ReportScreen me={me} meta={meta} initialNotes={route.notes} onDone={async () => { await refreshQueue(); setRoute({ name: 'home' }); void sync(true); }} onCancel={() => setRoute({ name: 'home' })} /> :
          route.name === 'detail' ? <DetailScreen id={route.id} online={online} onBack={() => setRoute({ name: 'home' })} /> :
          <Text style={[s.pad, s.body]}>Reference data is not available yet. Connect once to download your projects.</Text>}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

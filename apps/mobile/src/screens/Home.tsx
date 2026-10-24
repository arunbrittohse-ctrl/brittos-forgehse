import { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, FlatList, RefreshControl } from 'react-native';
import { STATUS_LABELS } from '@forgehse/shared';
import { api, ApiError } from '../api';
import type { QueuedObservation, SyncSummary } from '../offline/queue';
import type { Me, ObservationItem } from '../types';
import { BAND_COLOR, C, s } from '../theme';

interface Props {
  me: Me; pending: QueuedObservation[]; syncing: boolean; lastSync: SyncSummary | null; online: boolean;
  onReport: () => void; onAi: () => void; onOpen: (id: string) => void; onSync: () => void; onRetry: (ref: string) => void; onDiscard: (ref: string) => void; onSignOut: () => void;
}

export function HomeScreen(p: Props) {
  const [tab, setTab] = useState<'mine' | 'recent'>('mine');
  const [items, setItems] = useState<ObservationItem[] | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Lists are fetched live (not stored on the phone) so sensitive records are not kept offline.
  const load = useCallback(async () => {
    if (!p.online) return;
    setLoading(true); setError('');
    try {
      const q = tab === 'mine' ? 'assignedToMe=true&status=active' : 'pageSize=30';
      setItems((await api<{ items: ObservationItem[] }>(`/observations?${q}`)).items);
    } catch (e) { setError(e instanceof ApiError ? e.message : 'Could not load observations.'); }
    finally { setLoading(false); }
  }, [tab, p.online]);
  useEffect(() => { void load(); }, [load]);

  const canReport = p.me.permissions.includes('observation.create');
  const failed = p.pending.filter((x) => x.state === 'failed');
  const waiting = p.pending.filter((x) => x.state === 'pending');

  return (
    <View style={s.screen}>
      <View style={[s.pad, { backgroundColor: C.white, borderBottomWidth: 1, borderColor: C.line }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <View style={{ flex: 1 }}><Text style={s.h1}>{p.me.user.fullName.split(' ')[0]}</Text><Text style={s.muted}>{p.me.organization.name}</Text></View>
          <Pressable onPress={p.onSignOut} accessibilityRole="button"><Text style={{ color: C.electric }}>Sign out</Text></Pressable>
        </View>
        {canReport && <Pressable style={[s.btn, { marginTop: 14 }]} onPress={p.onReport} accessibilityRole="button"><Text style={s.btnText}>Report a hazard</Text></Pressable>}
        {p.me.permissions.includes('ai.use') && <Pressable style={[s.btn, s.btnSecondary, { marginTop: 10 }]} onPress={p.onAi} accessibilityRole="button"><Text style={s.btnSecondaryText}>✦ Ask AI Studio</Text></Pressable>}
      </View>

      {(waiting.length > 0 || failed.length > 0 || p.lastSync?.sent.length) ? (
        <View style={[s.card, { margin: 16, marginBottom: 0 }]}>
          <Text style={s.h2}>Sync</Text>
          {waiting.length > 0 && <Text style={[s.body, { marginTop: 4 }]}>{waiting.length} report{waiting.length > 1 ? 's' : ''} waiting to send{p.syncing ? ', sending now…' : p.online ? '.' : ' when you are back online.'}</Text>}
          {!!p.lastSync?.sent.length && waiting.length === 0 && <Text style={[s.body, { marginTop: 4 }]}>Sent: {p.lastSync.sent.map((x) => x.refNo).join(', ')}</Text>}
          {failed.map((f) => (
            <View key={f.clientRef} style={{ marginTop: 10, padding: 10, backgroundColor: '#FDE4E2', borderRadius: 6 }}>
              <Text style={s.body}>Not accepted: {String(f.payload.location ?? '')}</Text>
              <Text style={s.muted}>{f.lastError}</Text>
              <View style={{ flexDirection: 'row', marginTop: 8 }}>
                <Pressable style={[s.chip]} onPress={() => p.onRetry(f.clientRef)}><Text>Try again</Text></Pressable>
                <Pressable style={[s.chip]} onPress={() => p.onDiscard(f.clientRef)}><Text>Discard</Text></Pressable>
              </View>
            </View>
          ))}
          {waiting.length > 0 && p.online && !p.syncing && <Pressable style={[s.chip, { alignSelf: 'flex-start', marginTop: 8 }]} onPress={p.onSync}><Text>Send now</Text></Pressable>}
        </View>
      ) : null}

      <View style={{ flexDirection: 'row', paddingHorizontal: 16, paddingTop: 16 }}>
        {(['mine', 'recent'] as const).map((t) => (
          <Pressable key={t} style={[s.chip, tab === t && s.chipOn]} onPress={() => setTab(t)} accessibilityRole="tab" accessibilityState={{ selected: tab === t }}>
            <Text style={{ color: tab === t ? C.white : C.ink }}>{t === 'mine' ? 'My actions' : 'Recent'}</Text>
          </Pressable>
        ))}
      </View>
      {!p.online ? <Text style={[s.pad, s.muted]}>Lists need a connection. You can still report hazards.</Text> : (
        <FlatList
          data={items ?? []}
          keyExtractor={(o) => o.id}
          contentContainerStyle={{ padding: 16 }}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
          ListEmptyComponent={!loading ? <Text style={s.muted}>{error || (tab === 'mine' ? 'No open actions assigned to you.' : 'No observations yet.')}</Text> : null}
          renderItem={({ item: o }) => (
            <Pressable style={s.card} onPress={() => p.onOpen(o.id)} accessibilityRole="button">
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ fontWeight: '600', color: C.ink }}>{o.refNo}</Text>
                <Text style={{ color: BAND_COLOR[o.riskBand], fontWeight: '600' }}>{o.riskScore} {o.riskBand}</Text>
              </View>
              <Text style={[s.body, { marginTop: 4 }]}>{o.hazardCategory}, {o.location}</Text>
              <Text style={s.muted} numberOfLines={2}>{o.description}</Text>
              <Text style={[s.muted, { marginTop: 6, color: o.overdue ? C.critical : C.muted }]}>{o.overdue ? 'Overdue' : STATUS_LABELS[o.status]}{o.dueDate ? `, due ${o.dueDate}` : ''}</Text>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

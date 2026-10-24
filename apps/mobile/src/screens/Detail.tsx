import { useCallback, useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, ActivityIndicator } from 'react-native';
import { STATUS_LABELS, type Transition } from '@forgehse/shared';
import { api, ApiError } from '../api';
import type { ObservationItem } from '../types';
import { BAND_COLOR, C, s } from '../theme';

interface Detail {
  observation: ObservationItem & { version: number; correctiveAction: string; actionTaken: string; immediateAction: string; projectCode: string };
  can: { transitions: Transition[] };
}

/** Viewing and submitting actions require a live connection — permissions are checked by the server at that moment. */
export function DetailScreen({ id, online, onBack }: { id: string; online: boolean; onBack: () => void }) {
  const [d, setD] = useState<Detail | null>(null);
  const [error, setError] = useState('');
  const [actionTaken, setActionTaken] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState('');

  const load = useCallback(async () => {
    setError('');
    try { setD(await api<Detail>(`/observations/${id}`)); } catch (e) { setError(e instanceof ApiError ? e.message : 'Could not load.'); }
  }, [id]);
  useEffect(() => { if (online) void load(); }, [load, online]);

  const submit = async () => {
    if (!d) return;
    setBusy(true); setError('');
    try {
      await api(`/observations/${id}/transitions`, { body: { transition: 'submit_action', version: d.observation.version, actionTaken } });
      setDone('Action submitted for verification. Add photo evidence from the web if needed.');
      setActionTaken('');
      await load();
    } catch (e) { setError(e instanceof ApiError ? e.message : 'Could not submit.'); }
    finally { setBusy(false); }
  };

  const o = d?.observation;
  return (
    <ScrollView style={s.screen} contentContainerStyle={{ padding: 16, paddingBottom: 48 }}>
      <Pressable onPress={onBack} accessibilityRole="button"><Text style={{ color: C.electric, marginBottom: 12 }}>Back</Text></Pressable>
      {!online && <Text style={s.muted}>Connect to view this observation.</Text>}
      {!o && online && !error && <ActivityIndicator color={C.electric} />}
      {!!error && <Text style={s.error}>{error}</Text>}
      {o && (
        <>
          <Text style={s.h1}>{o.refNo}</Text>
          <Text style={[s.muted, { marginTop: 2 }]}>{o.projectCode}, {o.siteName}</Text>
          <Text style={{ marginTop: 10, fontWeight: '600', color: BAND_COLOR[o.riskBand] }}>Risk {o.riskScore}, {o.riskBand}. {o.overdue ? 'Overdue' : STATUS_LABELS[o.status]}</Text>
          <View style={[s.card, { marginTop: 14 }]}>
            <Text style={s.h2}>{o.hazardCategory}</Text>
            <Text style={[s.muted, { marginTop: 2 }]}>{o.location}</Text>
            <Text style={[s.body, { marginTop: 8 }]}>{o.description}</Text>
          </View>
          {!!o.correctiveAction && <View style={s.card}><Text style={s.muted}>Required action{o.dueDate ? `, due ${o.dueDate}` : ''}</Text><Text style={[s.body, { marginTop: 4 }]}>{o.correctiveAction}</Text></View>}
          {!!o.actionTaken && <View style={s.card}><Text style={s.muted}>Action taken</Text><Text style={[s.body, { marginTop: 4 }]}>{o.actionTaken}</Text></View>}
          {!!done && <Text style={[s.body, { backgroundColor: '#E3F4F1', padding: 12, borderRadius: 6 }]}>{done}</Text>}
          {d.can.transitions.includes('submit_action') && (
            <View style={s.card}>
              <Text style={s.h2}>Submit the action taken</Text>
              <TextInput style={[s.input, { minHeight: 96, marginTop: 10, textAlignVertical: 'top' }]} multiline value={actionTaken} onChangeText={setActionTaken} accessibilityLabel="Action taken" placeholder="What was done to fix it?" />
              <Pressable style={[s.btn, { marginTop: 12, opacity: busy || actionTaken.trim().length < 5 ? 0.6 : 1 }]} disabled={busy || actionTaken.trim().length < 5 || !online} onPress={submit}>
                <Text style={s.btnText}>{busy ? 'Submitting…' : 'Submit for verification'}</Text>
              </Pressable>
            </View>
          )}
        </>
      )}
    </ScrollView>
  );
}

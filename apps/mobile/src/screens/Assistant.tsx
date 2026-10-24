import { useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import { api, ApiError } from '../api';
import { C, s } from '../theme';

/**
 * AI assistant for the field app. Uses the same server endpoint as the web AI Studio in JSON mode
 * (React Native fetch has no streaming body). Answers draw on records the user may see; the phone
 * never holds an API key. Voice: use the keyboard's dictation (microphone) key — no extra permission.
 */
interface Msg { role: 'user' | 'assistant'; text: string; citations?: { refNo: string; cited: boolean }[]; actions?: { type: string; kind?: string; notes?: string }[]; error?: boolean }

const SUGGESTIONS = ['What are the controls for hot work?', 'Which high-risk items are still open?', 'Make a toolbox talk on heat stress'];

export function AssistantScreen({ online, onBack, onReportFromNotes }: { online: boolean; onBack: () => void; onReportFromNotes: (notes: string) => void }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const conv = useRef<string | undefined>(undefined);
  const scroller = useRef<ScrollView>(null);

  const send = async (text = input) => {
    const t = text.trim();
    if (!t || busy) return;
    setInput('');
    setMsgs((m) => [...m, { role: 'user', text: t }]);
    setBusy(true);
    try {
      const r = await api<{ conversationId: string; text: string; citations: Msg['citations']; actions: Msg['actions'] }>(
        '/ai/chat?stream=0', { body: { message: t, conversationId: conv.current }, timeoutMs: 90_000 });
      conv.current = r.conversationId;
      setMsgs((m) => [...m, { role: 'assistant', text: r.text, citations: r.citations, actions: r.actions }]);
    } catch (e) {
      setMsgs((m) => [...m, { role: 'assistant', text: e instanceof ApiError ? e.message : 'The assistant is unavailable.', error: true }]);
    } finally {
      setBusy(false);
      setTimeout(() => scroller.current?.scrollToEnd({ animated: true }), 50);
    }
  };

  return (
    <KeyboardAvoidingView style={s.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={[s.pad, { backgroundColor: C.navy, flexDirection: 'row', alignItems: 'center' }]}>
        <Pressable onPress={onBack} accessibilityRole="button" style={{ marginRight: 12 }}><Text style={{ color: C.platinum, fontSize: 15 }}>‹ Back</Text></Pressable>
        <View style={{ flex: 1 }}><Text style={{ color: C.white, fontSize: 18, fontWeight: '600' }}>AI Studio</Text><Text style={{ color: C.platinum, fontSize: 12 }}>Answers are AI drafts — verify before relying on them</Text></View>
      </View>
      <ScrollView ref={scroller} contentContainerStyle={s.pad} keyboardShouldPersistTaps="handled">
        {msgs.length === 0 && (
          <View>
            <Text style={[s.body, { marginBottom: 12 }]}>Ask about HSE practice or your site's records. Tap the microphone on your keyboard to speak.</Text>
            {SUGGESTIONS.map((x) => <Pressable key={x} style={s.card} onPress={() => void send(x)} accessibilityRole="button"><Text style={s.body}>{x}</Text></Pressable>)}
          </View>
        )}
        {msgs.map((m, i) => (
          <View key={i} style={[{ marginBottom: 12, maxWidth: '92%' }, m.role === 'user' ? { alignSelf: 'flex-end' } : { alignSelf: 'flex-start' }]}>
            <View style={m.role === 'user' ? { backgroundColor: C.navy, borderRadius: 16, padding: 12 } : [s.card, m.error ? { borderColor: C.critical } : null]}>
              <Text style={[s.body, m.role === 'user' ? { color: C.white } : null]}>{m.text.replace(/\*\*/g, '').replace(/^#+\s/gm, '')}</Text>
            </View>
            {!!m.citations?.filter((c) => c.cited).length && <Text style={[s.muted, { marginTop: 4 }]}>Sources: {m.citations.filter((c) => c.cited).map((c) => c.refNo).join(', ')}</Text>}
            {m.actions?.map((a, j) => a.type === 'draft_observation' && a.notes
              ? <Pressable key={j} style={[s.btn, { marginTop: 6 }]} onPress={() => onReportFromNotes(a.notes!)}><Text style={s.btnText}>Review the observation draft</Text></Pressable>
              : a.type === 'generate' ? <Text key={j} style={[s.muted, { marginTop: 4 }]}>A {a.kind} draft can be generated from the web AI Studio.</Text> : null)}
          </View>
        ))}
        {busy && <ActivityIndicator color={C.electric} style={{ marginTop: 8 }} />}
      </ScrollView>
      <View style={[s.pad, { flexDirection: 'row', gap: 8, backgroundColor: C.white, borderTopWidth: 1, borderColor: C.line }]}>
        <TextInput style={[s.input, { flex: 1 }]} value={input} onChangeText={setInput} placeholder={online ? 'Ask or dictate…' : 'Offline — connect to ask'} editable={online && !busy} multiline maxLength={4000} accessibilityLabel="Message" />
        <Pressable style={[s.btn, { minWidth: 72 }, (!online || busy || !input.trim()) && { opacity: 0.5 }]} disabled={!online || busy || !input.trim()} onPress={() => void send()} accessibilityRole="button"><Text style={s.btnText}>Send</Text></Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

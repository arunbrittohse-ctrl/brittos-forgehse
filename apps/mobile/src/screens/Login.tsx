import { useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, ActivityIndicator, KeyboardAvoidingView } from 'react-native';
import { api, saveToken, ApiError, loadServer, saveServer, normaliseServer } from '../api';
import { C, s } from '../theme';

export function LoginScreen({ onSignedIn }: { onSignedIn: () => Promise<void> }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [serverUrl, setServerUrl] = useState('');
  useEffect(() => { void loadServer().then(setServerUrl); }, []);

  const submit = async () => {
    setBusy(true); setError('');
    try {
      if (!normaliseServer(serverUrl)) { setError('Enter your FORGEHSE server address (ask your administrator).'); return; }
      setServerUrl(await saveServer(serverUrl));
      const r = await api<{ token: string; mustChangePassword: boolean }>('/auth/login', { body: { email: email.trim(), password, client: 'mobile' } });
      if (r.mustChangePassword) { setError('Your administrator set a temporary password. Sign in on the web once to choose your own, then return here.'); return; }
      await saveToken(r.token);
      await onSignedIn();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Sign-in failed.');
    } finally { setBusy(false); }
  };

  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: C.midnight, justifyContent: 'center', padding: 24 }}>
      <Text style={{ color: '#8FB0FF', fontSize: 12, fontWeight: '500' }}>BRITTO'S AI FORGE</Text>
      <Text style={{ color: C.white, fontSize: 28, fontWeight: '600', marginTop: 4 }}>BRITTO'S FORGEHSE</Text>
      <Text style={{ color: '#C9D3E6', marginTop: 8, marginBottom: 24 }}>Report hazards from site, even without signal.</Text>
      <View style={{ backgroundColor: C.white, borderRadius: 12, padding: 18 }}>
        <Text style={[s.label, { marginTop: 0 }]}>Server address</Text>
        <TextInput style={s.input} value={serverUrl} onChangeText={setServerUrl} autoCapitalize="none" autoCorrect={false} keyboardType="url" placeholder="forgehse.yourcompany.com" accessibilityLabel="Server address" />
        <Text style={s.label}>Work email</Text>
        <TextInput style={s.input} value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" accessibilityLabel="Work email" />
        <Text style={s.label}>Password</Text>
        <TextInput style={s.input} value={password} onChangeText={setPassword} secureTextEntry autoComplete="password" accessibilityLabel="Password" />
        {!!error && <Text style={s.error} accessibilityRole="alert">{error}</Text>}
        <Pressable style={[s.btn, { marginTop: 18, opacity: busy || !email || !password ? 0.6 : 1 }]} disabled={busy || !email || !password} onPress={submit} accessibilityRole="button">
          {busy ? <ActivityIndicator color={C.white} /> : <Text style={s.btnText}>Sign in</Text>}
        </Pressable>
      </View>
      <Text style={{ color: '#7F8BAB', fontSize: 12, marginTop: 16 }}>Your administrator gives you the server address. It is saved on this phone.</Text>
    </KeyboardAvoidingView>
  );
}

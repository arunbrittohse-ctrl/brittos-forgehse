import { useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Image, Alert } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Crypto from 'expo-crypto';
import { calculateRisk, observationCreateSchema, OBSERVATION_TYPES, OBSERVATION_TYPE_LABELS, type ObservationType } from '@forgehse/shared';
import { queue } from '../offline/instance';
import type { Me, Meta } from '../types';
import { BAND_COLOR, C, s } from '../theme';

/**
 * Quick report. The form is validated with the same schema the server uses, then saved to the
 * offline queue immediately; the queue sends it now if online, or later when connectivity returns.
 */
export function ReportScreen({ me, meta, onDone, onCancel, initialNotes }: { me: Me; meta: Meta; onDone: () => void; onCancel: () => void; initialNotes?: string }) {
  const projects = me.projects;
  const [projectId, setProjectId] = useState(projects.length === 1 ? projects[0]!.id : '');
  const project = projects.find((p) => p.id === projectId);
  const [siteId, setSiteId] = useState(project?.sites.length === 1 ? project.sites[0]!.id : '');
  const [type, setType] = useState<ObservationType>('unsafe_condition');
  const [hazardCategory, setHazard] = useState('');
  const [location, setLocation] = useState('');
  // Pre-filled from the AI assistant; the reporter reviews and edits before saving.
  const [description, setDescription] = useState(initialNotes ?? '');
  const [immediateAction, setImmediate] = useState('');
  const [likelihood, setL] = useState(3);
  const [severity, setS] = useState(3);
  const [photos, setPhotos] = useState<{ uri: string; name: string; mimeType: string }[]>([]);
  const [error, setError] = useState('');
  const [clientRef] = useState(() => Crypto.randomUUID());
  const risk = useMemo(() => { try { return calculateRisk(likelihood, severity, meta.riskMatrix); } catch { return null; } }, [likelihood, severity, meta.riskMatrix]);

  const addPhoto = async (camera: boolean) => {
    const perm = camera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert('Permission needed', camera ? 'Allow camera access in Android settings to take photos.' : 'Allow photo access to attach pictures.'); return; }
    const r = camera
      ? await ImagePicker.launchCameraAsync({ quality: 0.6, exif: false })
      : await ImagePicker.launchImageLibraryAsync({ quality: 0.6, exif: false, mediaTypes: ['images'] });
    if (r.canceled || !r.assets[0]) return;
    // Copy into app storage so the queued upload survives the OS clearing the picker cache.
    const dest = `${FileSystem.documentDirectory}queue-${clientRef}-${photos.length}.jpg`;
    await FileSystem.copyAsync({ from: r.assets[0].uri, to: dest });
    setPhotos((p) => [...p, { uri: dest, name: `photo-${p.length + 1}.jpg`, mimeType: r.assets[0]!.mimeType ?? 'image/jpeg' }]);
  };

  const save = async () => {
    const payload = { clientRef, projectId, siteId, type, hazardCategory, location, activity: '', description, immediateAction, likelihood, severity, observedAt: new Date().toISOString() };
    const parsed = observationCreateSchema.safeParse(payload);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      setError(first ? `${first.path.join('.') || 'Form'}: ${first.message}` : 'Check the form.');
      return;
    }
    if (!hazardCategory) { setError('Choose a hazard category.'); return; }
    await queue.enqueue(payload, photos);
    onDone();
  };

  const Chips = <T extends string | number>({ values, value, onChange, label }: { values: T[]; value: T; onChange: (v: T) => void; label: (v: T) => string }) => (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
      {values.map((v) => (
        <Pressable key={String(v)} style={[s.chip, value === v && s.chipOn]} onPress={() => onChange(v)} accessibilityRole="radio" accessibilityState={{ selected: value === v }}>
          <Text style={{ color: value === v ? C.white : C.ink }}>{label(v)}</Text>
        </Pressable>
      ))}
    </View>
  );

  return (
    <ScrollView style={s.screen} contentContainerStyle={{ padding: 16, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
      <Text style={s.h1}>Report a hazard</Text>
      {projects.length > 1 && (<><Text style={s.label}>Project</Text><Chips values={projects.map((p) => p.id)} value={projectId} onChange={(v) => { setProjectId(v); setSiteId(''); }} label={(v) => projects.find((p) => p.id === v)!.code} /></>)}
      {project && (<><Text style={s.label}>Site</Text><Chips values={project.sites.map((x) => x.id)} value={siteId} onChange={setSiteId} label={(v) => project.sites.find((x) => x.id === v)!.name} /></>)}
      <Text style={s.label}>Type</Text>
      <Chips values={[...OBSERVATION_TYPES]} value={type} onChange={setType} label={(v) => OBSERVATION_TYPE_LABELS[v]} />
      <Text style={s.label}>Hazard category</Text>
      <Chips values={meta.hazardCategories} value={hazardCategory} onChange={setHazard} label={(v) => v} />
      <Text style={s.label}>Exact location</Text>
      <TextInput style={s.input} value={location} onChangeText={setLocation} placeholder="Level, grid line or chainage" accessibilityLabel="Exact location" />
      <Text style={s.label}>What did you see?</Text>
      <TextInput style={[s.input, { minHeight: 96, textAlignVertical: 'top' }]} multiline value={description} onChangeText={setDescription} accessibilityLabel="What did you see" />
      <Text style={s.label}>Immediate action taken (if any)</Text>
      <TextInput style={[s.input, { minHeight: 64, textAlignVertical: 'top' }]} multiline value={immediateAction} onChangeText={setImmediate} accessibilityLabel="Immediate action" />
      <Text style={s.label}>Likelihood</Text>
      <Chips values={Array.from({ length: meta.riskMatrix.size }, (_, i) => i + 1)} value={likelihood} onChange={setL} label={(v) => String(v)} />
      <Text style={s.label}>Severity</Text>
      <Chips values={Array.from({ length: meta.riskMatrix.size }, (_, i) => i + 1)} value={severity} onChange={setS} label={(v) => String(v)} />
      {risk && <Text style={{ marginTop: 6, fontWeight: '600', color: BAND_COLOR[risk.band] }}>Risk {risk.score}, {risk.band}</Text>}
      <Text style={s.label}>Photos</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {photos.map((p) => <Image key={p.uri} source={{ uri: p.uri }} style={{ width: 72, height: 72, borderRadius: 6, marginRight: 8, marginBottom: 8 }} accessibilityLabel={p.name} />)}
      </View>
      <View style={{ flexDirection: 'row' }}>
        <Pressable style={[s.chip]} onPress={() => addPhoto(true)}><Text>Take photo</Text></Pressable>
        <Pressable style={[s.chip]} onPress={() => addPhoto(false)}><Text>Choose photo</Text></Pressable>
      </View>
      {!!error && <Text style={s.error} accessibilityRole="alert">{error}</Text>}
      <Pressable style={[s.btn, { marginTop: 20 }]} onPress={save} accessibilityRole="button"><Text style={s.btnText}>Save report</Text></Pressable>
      <Pressable style={[s.btn, s.btnSecondary, { marginTop: 10 }]} onPress={onCancel} accessibilityRole="button"><Text style={s.btnSecondaryText}>Cancel</Text></Pressable>
    </ScrollView>
  );
}

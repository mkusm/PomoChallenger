import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { loadSettings, saveSettings } from '../storage/storage';
import { Settings, DEFAULT_SETTINGS } from '../types';

interface DurationFieldProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  description: string;
}

function DurationField({ label, value, onChange, description }: DurationFieldProps) {
  return (
    <View style={styles.field}>
      <View style={styles.fieldLeft}>
        <Text style={styles.fieldLabel}>{label}</Text>
        <Text style={styles.fieldDesc}>{description}</Text>
      </View>
      <View style={styles.fieldRight}>
        <TextInput
          style={styles.fieldInput}
          value={value}
          onChangeText={onChange}
          keyboardType="number-pad"
          maxLength={3}
        />
        <Text style={styles.fieldUnit}>min</Text>
      </View>
    </View>
  );
}

function parseMinutes(v: string, fallback: number): number {
  const n = parseInt(v, 10);
  if (isNaN(n) || n < 1) return fallback;
  return Math.min(n, 120);
}

export default function SettingsScreen() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [work, setWork] = useState(String(DEFAULT_SETTINGS.workDuration));
  const [shortBreak, setShortBreak] = useState(String(DEFAULT_SETTINGS.shortBreakDuration));
  const [longBreak, setLongBreak] = useState(String(DEFAULT_SETTINGS.longBreakDuration));
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    loadSettings().then((s) => {
      setSettings(s);
      setWork(String(s.workDuration));
      setShortBreak(String(s.shortBreakDuration));
      setLongBreak(String(s.longBreakDuration));
    });
  }, []);

  const handleChange = (setter: (v: string) => void) => (v: string) => {
    setter(v);
    setDirty(true);
  };

  const handleSave = async () => {
    const updated: Settings = {
      workDuration: parseMinutes(work, settings.workDuration),
      shortBreakDuration: parseMinutes(shortBreak, settings.shortBreakDuration),
      longBreakDuration: parseMinutes(longBreak, settings.longBreakDuration),
    };
    setWork(String(updated.workDuration));
    setShortBreak(String(updated.shortBreakDuration));
    setLongBreak(String(updated.longBreakDuration));
    setSettings(updated);
    await saveSettings(updated);
    setDirty(false);
    Alert.alert('Saved', 'Settings saved. New durations apply from the next session.');
  };

  const handleReset = async () => {
    setWork(String(DEFAULT_SETTINGS.workDuration));
    setShortBreak(String(DEFAULT_SETTINGS.shortBreakDuration));
    setLongBreak(String(DEFAULT_SETTINGS.longBreakDuration));
    setSettings(DEFAULT_SETTINGS);
    await saveSettings(DEFAULT_SETTINGS);
    setDirty(false);
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={styles.inner}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView>
          <Text style={styles.heading}>Settings</Text>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Timer Durations</Text>

            <DurationField
              label="Work"
              value={work}
              onChange={handleChange(setWork)}
              description="Focus session length"
            />
            <View style={styles.divider} />
            <DurationField
              label="Short Break"
              value={shortBreak}
              onChange={handleChange(setShortBreak)}
              description="Break after each session"
            />
            <View style={styles.divider} />
            <DurationField
              label="Long Break"
              value={longBreak}
              onChange={handleChange(setLongBreak)}
              description="Break after every 4 sessions"
            />
          </View>

          <View style={styles.btnGroup}>
            <TouchableOpacity
              style={[styles.saveBtn, !dirty && styles.saveBtnDisabled]}
              onPress={handleSave}
              disabled={!dirty}
            >
              <Text style={styles.saveBtnText}>Save</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.resetBtn} onPress={handleReset}>
              <Text style={styles.resetBtnText}>Reset to defaults</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F5F5' },
  inner: { flex: 1, padding: 20 },
  heading: {
    fontSize: 26,
    fontWeight: '700',
    color: '#1A1A1A',
    marginBottom: 24,
  },
  section: {
    backgroundColor: '#fff',
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: '#999',
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 6,
  },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  fieldLeft: { flex: 1 },
  fieldLabel: { fontSize: 16, fontWeight: '600', color: '#222' },
  fieldDesc: { fontSize: 12, color: '#999', marginTop: 2 },
  fieldRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  fieldInput: {
    width: 56,
    textAlign: 'center',
    fontSize: 18,
    fontWeight: '600',
    color: '#E53935',
    backgroundColor: '#FFF5F5',
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 4,
    borderWidth: 1,
    borderColor: '#FFCDD2',
  },
  fieldUnit: { fontSize: 14, color: '#aaa' },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#F0F0F0',
    marginLeft: 16,
  },
  btnGroup: { gap: 12 },
  saveBtn: {
    backgroundColor: '#E53935',
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
  },
  saveBtnDisabled: { backgroundColor: '#ccc' },
  saveBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  resetBtn: {
    borderRadius: 14,
    paddingVertical: 13,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#DDD',
  },
  resetBtnText: { color: '#888', fontWeight: '600', fontSize: 15 },
});

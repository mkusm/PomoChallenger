import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  Switch,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { loadSettings, saveSettings, saveChallenges, saveGroups } from '../storage/storage';
import { Settings, DEFAULT_SETTINGS, DEFAULT_CHALLENGES, DEFAULT_GROUPS } from '../types';

function parseMinutes(v: string, fallback: number): number {
  const n = parseInt(v, 10);
  if (isNaN(n) || n < 1) return fallback;
  return Math.min(n, 120);
}

interface DurationFieldProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onCommit: (v: string) => void;
  description: string;
}

function DurationField({ label, value, onChange, onCommit, description }: DurationFieldProps) {
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
          onEndEditing={() => onCommit(value)}
          keyboardType="number-pad"
          maxLength={3}
        />
        <Text style={styles.fieldUnit}>min</Text>
      </View>
    </View>
  );
}

export default function SettingsScreen() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [work, setWork] = useState(String(DEFAULT_SETTINGS.workDuration));
  const [shortBreak, setShortBreak] = useState(String(DEFAULT_SETTINGS.shortBreakDuration));
  const [longBreak, setLongBreak] = useState(String(DEFAULT_SETTINGS.longBreakDuration));

  useEffect(() => {
    loadSettings().then((s) => {
      setSettings(s);
      setWork(String(s.workDuration));
      setShortBreak(String(s.shortBreakDuration));
      setLongBreak(String(s.longBreakDuration));
    });
  }, []);

  const persist = (patch: Partial<Settings>) => {
    const updated = { ...settings, ...patch };
    setSettings(updated);
    saveSettings(updated);
    return updated;
  };

  const commitWork = (v: string) => {
    const n = parseMinutes(v, settings.workDuration);
    setWork(String(n));
    persist({ workDuration: n });
  };

  const commitShortBreak = (v: string) => {
    const n = parseMinutes(v, settings.shortBreakDuration);
    setShortBreak(String(n));
    persist({ shortBreakDuration: n });
  };

  const commitLongBreak = (v: string) => {
    const n = parseMinutes(v, settings.longBreakDuration);
    setLongBreak(String(n));
    persist({ longBreakDuration: n });
  };

  const handleFactoryReset = () => {
    Alert.alert(
      'Reset everything?',
      'This will clear all challenges, groups, and settings.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: async () => {
            await AsyncStorage.clear();
            await saveSettings(DEFAULT_SETTINGS);
            await saveChallenges(DEFAULT_CHALLENGES);
            await saveGroups(DEFAULT_GROUPS);
            setSettings(DEFAULT_SETTINGS);
            setWork(String(DEFAULT_SETTINGS.workDuration));
            setShortBreak(String(DEFAULT_SETTINGS.shortBreakDuration));
            setLongBreak(String(DEFAULT_SETTINGS.longBreakDuration));
          },
        },
      ]
    );
  };

  const handleReset = () => {
    setSettings(DEFAULT_SETTINGS);
    setWork(String(DEFAULT_SETTINGS.workDuration));
    setShortBreak(String(DEFAULT_SETTINGS.shortBreakDuration));
    setLongBreak(String(DEFAULT_SETTINGS.longBreakDuration));
    saveSettings(DEFAULT_SETTINGS);
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
              onChange={setWork}
              onCommit={commitWork}
              description="Focus session length"
            />
            <View style={styles.divider} />
            <DurationField
              label="Short Break"
              value={shortBreak}
              onChange={setShortBreak}
              onCommit={commitShortBreak}
              description="Break after each session"
            />
            <View style={styles.divider} />
            <DurationField
              label="Long Break"
              value={longBreak}
              onChange={setLongBreak}
              onCommit={commitLongBreak}
              description="Break after every 4 sessions"
            />
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Behaviour</Text>
            <View style={styles.field}>
              <View style={styles.fieldLeft}>
                <Text style={styles.fieldLabel}>Auto-start</Text>
                <Text style={styles.fieldDesc}>Start next session automatically</Text>
              </View>
              <Switch
                value={settings.autoStart}
                onValueChange={(v) => { persist({ autoStart: v }); }}
                trackColor={{ false: '#DDD', true: '#FFCDD2' }}
                thumbColor={settings.autoStart ? '#E53935' : '#fff'}
              />
            </View>
          </View>

          <TouchableOpacity style={styles.resetBtn} onPress={handleReset}>
            <Text style={styles.resetBtnText}>Reset to defaults</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.factoryResetBtn} onPress={handleFactoryReset}>
            <Text style={styles.factoryResetBtnText}>Clear all data</Text>
          </TouchableOpacity>
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
  resetBtn: {
    borderRadius: 14,
    paddingVertical: 13,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#DDD',
  },
  resetBtnText: { color: '#888', fontWeight: '600', fontSize: 15 },
  factoryResetBtn: {
    borderRadius: 14,
    paddingVertical: 13,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#FFCDD2',
  },
  factoryResetBtnText: { color: '#E53935', fontWeight: '600', fontSize: 15 },
});

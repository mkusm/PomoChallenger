import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { loadChallenges, saveChallenges } from '../storage/storage';

export default function ChallengesScreen() {
  const [challenges, setChallenges] = useState<string[]>([]);
  const [input, setInput] = useState('');

  useEffect(() => {
    loadChallenges().then(setChallenges);
  }, []);

  const persist = async (updated: string[]) => {
    setChallenges(updated);
    await saveChallenges(updated);
  };

  const addChallenge = async () => {
    const trimmed = input.trim();
    if (!trimmed) return;
    await persist([...challenges, trimmed]);
    setInput('');
  };

  const deleteChallenge = (index: number) => {
    Alert.alert('Delete challenge?', challenges[index], [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => persist(challenges.filter((_, i) => i !== index)),
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={styles.inner}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={80}
      >
        <Text style={styles.heading}>Break Challenges</Text>
        <Text style={styles.subheading}>
          A random challenge will appear at the start of each break.
        </Text>

        <FlatList
          data={challenges}
          keyExtractor={(_, i) => i.toString()}
          style={styles.list}
          contentContainerStyle={{ paddingBottom: 16 }}
          renderItem={({ item, index }) => (
            <View style={styles.row}>
              <Text style={styles.challengeText} numberOfLines={2}>
                {item}
              </Text>
              <TouchableOpacity onPress={() => deleteChallenge(index)} style={styles.deleteBtn}>
                <Text style={styles.deleteBtnText}>✕</Text>
              </TouchableOpacity>
            </View>
          )}
          ListEmptyComponent={
            <Text style={styles.empty}>No challenges yet. Add one below!</Text>
          }
        />

        <View style={styles.addRow}>
          <TextInput
            style={styles.input}
            value={input}
            onChangeText={setInput}
            placeholder="New challenge..."
            placeholderTextColor="#aaa"
            returnKeyType="done"
            onSubmitEditing={addChallenge}
          />
          <TouchableOpacity
            style={[styles.addBtn, !input.trim() && styles.addBtnDisabled]}
            onPress={addChallenge}
            disabled={!input.trim()}
          >
            <Text style={styles.addBtnText}>Add</Text>
          </TouchableOpacity>
        </View>
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
    marginBottom: 6,
  },
  subheading: {
    fontSize: 14,
    color: '#777',
    marginBottom: 20,
  },
  list: { flex: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  challengeText: {
    flex: 1,
    fontSize: 15,
    color: '#222',
  },
  deleteBtn: {
    padding: 6,
    marginLeft: 8,
  },
  deleteBtnText: {
    color: '#ccc',
    fontSize: 16,
    fontWeight: '700',
  },
  empty: {
    textAlign: 'center',
    color: '#aaa',
    marginTop: 40,
    fontSize: 15,
  },
  addRow: {
    flexDirection: 'row',
    gap: 10,
    paddingTop: 12,
  },
  input: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: '#222',
    borderWidth: 1,
    borderColor: '#E0E0E0',
  },
  addBtn: {
    backgroundColor: '#E53935',
    borderRadius: 12,
    paddingHorizontal: 20,
    justifyContent: 'center',
  },
  addBtnDisabled: {
    backgroundColor: '#ccc',
  },
  addBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 15,
  },
});

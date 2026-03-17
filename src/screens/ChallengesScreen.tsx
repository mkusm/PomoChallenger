import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  SectionList,
  StyleSheet,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { loadChallenges, saveChallenges, loadGroups, saveGroups } from '../storage/storage';
import { Challenge } from '../types';

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default function ChallengesScreen() {
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [groups, setGroups] = useState<string[]>([]);

  // Add-challenge modal state
  const [addingToGroup, setAddingToGroup] = useState<string | null>(null);
  const [challengeInput, setChallengeInput] = useState('');

  // Add-group modal state
  const [groupModalVisible, setGroupModalVisible] = useState(false);
  const [groupInput, setGroupInput] = useState('');

  useFocusEffect(
    useCallback(() => {
      loadChallenges().then(setChallenges);
      loadGroups().then(setGroups);
    }, [])
  );

  const persistChallenges = (updated: Challenge[]) => {
    setChallenges(updated);
    saveChallenges(updated);
  };

  const persistGroups = (updated: string[]) => {
    setGroups(updated);
    saveGroups(updated);
  };

  const addChallenge = () => {
    const text = challengeInput.trim();
    if (!text || !addingToGroup) return;
    persistChallenges([...challenges, { id: uid(), text, group: addingToGroup }]);
    setChallengeInput('');
    setAddingToGroup(null);
  };

  const deleteChallenge = (id: string, text: string) => {
    Alert.alert('Delete challenge?', text, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => persistChallenges(challenges.filter((c) => c.id !== id)) },
    ]);
  };

  const addGroup = () => {
    const name = groupInput.trim();
    if (!name || groups.includes(name)) return;
    persistGroups([...groups, name]);
    setGroupInput('');
    setGroupModalVisible(false);
  };

  const deleteGroup = (group: string) => {
    const count = challenges.filter((c) => c.group === group).length;
    Alert.alert(
      `Delete "${group}"?`,
      count > 0 ? `This will also delete ${count} challenge${count > 1 ? 's' : ''} in this group.` : 'This group is empty.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            persistGroups(groups.filter((g) => g !== group));
            persistChallenges(challenges.filter((c) => c.group !== group));
          },
        },
      ]
    );
  };

  // Build sections: one per group (including empty groups), plus orphaned challenges
  const allGroupNames = [
    ...groups,
    ...challenges.map((c) => c.group).filter((g) => !groups.includes(g)),
  ];
  const sections = allGroupNames.map((group) => ({
    group,
    data: challenges.filter((c) => c.group === group),
  }));

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={styles.inner}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={80}
      >
        <View style={styles.header}>
          <Text style={styles.heading}>Break Challenges</Text>
          <TouchableOpacity style={styles.addGroupBtn} onPress={() => setGroupModalVisible(true)}>
            <Text style={styles.addGroupBtnText}>+ Group</Text>
          </TouchableOpacity>
        </View>

        <SectionList
          sections={sections}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingBottom: 24 }}
          renderSectionHeader={({ section: { group, data } }) => (
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>{group}</Text>
              <View style={styles.sectionActions}>
                <Text style={styles.sectionCount}>{data.length}</Text>
                <TouchableOpacity onPress={() => setAddingToGroup(group)} style={styles.sectionAddBtn}>
                  <Text style={styles.sectionAddBtnText}>+ Add</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => deleteGroup(group)} style={styles.sectionDeleteBtn}>
                  <Text style={styles.sectionDeleteBtnText}>✕</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
          renderItem={({ item }) => (
            <View style={styles.row}>
              <Text style={styles.challengeText} numberOfLines={2}>{item.text}</Text>
              <TouchableOpacity onPress={() => deleteChallenge(item.id, item.text)} style={styles.deleteBtn}>
                <Text style={styles.deleteBtnText}>✕</Text>
              </TouchableOpacity>
            </View>
          )}
          renderSectionFooter={({ section: { data } }) =>
            data.length === 0 ? (
              <View style={styles.emptySection}>
                <Text style={styles.emptySectionText}>No challenges yet</Text>
              </View>
            ) : null
          }
          ListEmptyComponent={
            <Text style={styles.empty}>No groups yet. Tap "+ Group" to create one.</Text>
          }
        />
      </KeyboardAvoidingView>

      {/* Add challenge modal */}
      <Modal visible={!!addingToGroup} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Add to {addingToGroup}</Text>
            <TextInput
              style={styles.modalInput}
              value={challengeInput}
              onChangeText={setChallengeInput}
              placeholder="What's the challenge?"
              placeholderTextColor="#aaa"
              autoFocus
              returnKeyType="done"
              onSubmitEditing={addChallenge}
            />
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalCancel} onPress={() => { setAddingToGroup(null); setChallengeInput(''); }}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalConfirm, !challengeInput.trim() && styles.modalConfirmDisabled]}
                onPress={addChallenge}
                disabled={!challengeInput.trim()}
              >
                <Text style={styles.modalConfirmText}>Add</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Add group modal */}
      <Modal visible={groupModalVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>New Group</Text>
            <TextInput
              style={styles.modalInput}
              value={groupInput}
              onChangeText={setGroupInput}
              placeholder="Group name..."
              placeholderTextColor="#aaa"
              autoFocus
              returnKeyType="done"
              onSubmitEditing={addGroup}
            />
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalCancel} onPress={() => { setGroupModalVisible(false); setGroupInput(''); }}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalConfirm, !groupInput.trim() && styles.modalConfirmDisabled]}
                onPress={addGroup}
                disabled={!groupInput.trim()}
              >
                <Text style={styles.modalConfirmText}>Create</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F5F5' },
  inner: { flex: 1, paddingHorizontal: 20, paddingTop: 20 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  heading: { fontSize: 26, fontWeight: '700', color: '#1A1A1A' },
  addGroupBtn: {
    backgroundColor: '#E53935',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  addGroupBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 20,
    paddingBottom: 8,
  },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: '#888', textTransform: 'uppercase', letterSpacing: 1 },
  sectionActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sectionCount: { fontSize: 12, color: '#bbb', fontWeight: '600' },
  sectionAddBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: '#E53935',
  },
  sectionAddBtnText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  sectionDeleteBtn: { padding: 4 },
  sectionDeleteBtnText: { color: '#ccc', fontSize: 14, fontWeight: '700' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  challengeText: { flex: 1, fontSize: 15, color: '#222' },
  deleteBtn: { padding: 6, marginLeft: 8 },
  deleteBtnText: { color: '#ccc', fontSize: 15, fontWeight: '700' },
  emptySection: { paddingVertical: 12, paddingHorizontal: 4 },
  emptySectionText: { color: '#bbb', fontSize: 13, fontStyle: 'italic' },
  empty: { textAlign: 'center', color: '#aaa', marginTop: 60, fontSize: 15 },
  // Modals
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 28,
    paddingBottom: 40,
  },
  modalTitle: { fontSize: 18, fontWeight: '700', color: '#1A1A1A', marginBottom: 16 },
  modalInput: {
    backgroundColor: '#F5F5F5',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: '#222',
    marginBottom: 20,
  },
  modalActions: { flexDirection: 'row', gap: 12 },
  modalCancel: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#DDD',
  },
  modalCancelText: { color: '#888', fontWeight: '600', fontSize: 15 },
  modalConfirm: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
    backgroundColor: '#E53935',
  },
  modalConfirmDisabled: { backgroundColor: '#ccc' },
  modalConfirmText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});

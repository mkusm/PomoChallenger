import React, { useState, useCallback, useMemo } from 'react';
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
import { Challenge, CHALLENGE_TAGS, TAG_LABELS, TAG_COLORS, ChallengeTag } from '../types';

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function InputModal({
  visible,
  title,
  value,
  onChange,
  placeholder,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  visible: boolean;
  title: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal visible={visible} animationType="slide" transparent>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{title}</Text>
            <TextInput
              style={styles.modalInput}
              value={value}
              onChangeText={onChange}
              placeholder={placeholder}
              placeholderTextColor="#aaa"
              autoFocus
              returnKeyType="done"
              onSubmitEditing={onConfirm}
            />
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalCancel} onPress={onCancel}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalConfirm, !value.trim() && styles.modalConfirmDisabled]}
                onPress={onConfirm}
                disabled={!value.trim()}
              >
                <Text style={styles.modalConfirmText}>{confirmLabel}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// Edit modal: change challenge name + toggle tags
function EditChallengeModal({
  visible,
  name,
  tags,
  onChangeName,
  onToggleTag,
  onSave,
  onCancel,
}: {
  visible: boolean;
  name: string;
  tags: string[];
  onChangeName: (v: string) => void;
  onToggleTag: (tag: string) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal visible={visible} animationType="slide" transparent>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Edit Challenge</Text>
            <TextInput
              style={styles.modalInput}
              value={name}
              onChangeText={onChangeName}
              placeholder="Challenge name..."
              placeholderTextColor="#aaa"
              autoFocus
              returnKeyType="done"
            />
            <Text style={styles.tagSectionLabel}>Tags</Text>
            <View style={styles.tagRow}>
              {CHALLENGE_TAGS.map((tag) => {
                const active = tags.includes(tag);
                return (
                  <TouchableOpacity
                    key={tag}
                    style={[styles.tagPill, active && { backgroundColor: TAG_COLORS[tag] }]}
                    onPress={() => onToggleTag(tag)}
                  >
                    <Text style={[styles.tagPillText, active && styles.tagPillTextActive]}>
                      {TAG_LABELS[tag]}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalCancel} onPress={onCancel}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalConfirm, !name.trim() && styles.modalConfirmDisabled]}
                onPress={onSave}
                disabled={!name.trim()}
              >
                <Text style={styles.modalConfirmText}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
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

  // Edit-challenge modal state
  const [editingChallenge, setEditingChallenge] = useState<Challenge | null>(null);
  const [editText, setEditText] = useState('');
  const [editTags, setEditTags] = useState<string[]>([]);

  useFocusEffect(
    useCallback(() => {
      Promise.all([loadChallenges(), loadGroups()]).then(([c, g]) => {
        setChallenges(c);
        setGroups(g);
      });
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

  const openEdit = (item: Challenge) => {
    setEditingChallenge(item);
    setEditText(item.text);
    setEditTags(item.tags ?? []);
  };

  const toggleEditTag = (tag: string) => {
    setEditTags((prev) => {
      if (prev.includes(tag)) return prev.filter((t) => t !== tag);
      // Turning on one break-type tag clears the other
      if (tag === 'long-break-only') return [...prev.filter((t) => t !== 'short-break-only'), tag];
      if (tag === 'short-break-only') return [...prev.filter((t) => t !== 'long-break-only'), tag];
      return [...prev, tag];
    });
  };

  const saveEdit = () => {
    if (!editingChallenge || !editText.trim()) return;
    persistChallenges(challenges.map((c) =>
      c.id === editingChallenge.id ? { ...c, text: editText.trim(), tags: editTags.length > 0 ? editTags : undefined } : c
    ));
    setEditingChallenge(null);
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
  const sections = useMemo(() => {
    const allGroupNames = [
      ...groups,
      ...challenges.map((c) => c.group).filter((g) => !groups.includes(g)),
    ];
    return allGroupNames.map((group) => ({
      group,
      data: challenges.filter((c) => c.group === group),
    }));
  }, [groups, challenges]);

  return (
    // edges excludes bottom to avoid double safe-area padding with the tab bar
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <View style={styles.inner}>
        <View style={styles.header}>
          <Text style={styles.heading}>Break Challenges</Text>
          <TouchableOpacity style={styles.addGroupBtn} onPress={() => setGroupModalVisible(true)}>
            <Text style={styles.addGroupBtnText}>+ Group</Text>
          </TouchableOpacity>
        </View>

        <SectionList
          sections={sections}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingBottom: 16 }}
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
            <TouchableOpacity
              style={styles.row}
              onPress={() => openEdit(item)}
              activeOpacity={0.8}
            >
              <View style={styles.rowContent}>
                <Text style={styles.challengeText} numberOfLines={2}>{item.text}</Text>
                {(item.tags ?? []).length > 0 && (
                  <View style={styles.rowTagRow}>
                    {item.tags!.map((tag) => (
                      <View
                        key={tag}
                        style={[styles.rowTagPill, { backgroundColor: TAG_COLORS[tag as ChallengeTag] ?? '#999' }]}
                      >
                        <Text style={styles.rowTagText}>{TAG_LABELS[tag as ChallengeTag] ?? tag}</Text>
                      </View>
                    ))}
                  </View>
                )}
              </View>
              <TouchableOpacity onPress={() => deleteChallenge(item.id, item.text)} style={styles.deleteBtn}>
                <Text style={styles.deleteBtnText}>✕</Text>
              </TouchableOpacity>
            </TouchableOpacity>
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
      </View>

      <InputModal
        visible={!!addingToGroup}
        title={`Add to ${addingToGroup}`}
        value={challengeInput}
        onChange={setChallengeInput}
        placeholder="What's the challenge?"
        confirmLabel="Add"
        onConfirm={addChallenge}
        onCancel={() => { setAddingToGroup(null); setChallengeInput(''); }}
      />

      <InputModal
        visible={groupModalVisible}
        title="New Group"
        value={groupInput}
        onChange={setGroupInput}
        placeholder="Group name..."
        confirmLabel="Create"
        onConfirm={addGroup}
        onCancel={() => { setGroupModalVisible(false); setGroupInput(''); }}
      />

      <EditChallengeModal
        visible={!!editingChallenge}
        name={editText}
        tags={editTags}
        onChangeName={setEditText}
        onToggleTag={toggleEditTag}
        onSave={saveEdit}
        onCancel={() => setEditingChallenge(null)}
      />
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
  rowContent: { flex: 1 },
  challengeText: { fontSize: 15, color: '#222' },
  rowTagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 6 },
  rowTagPill: {
    borderRadius: 20,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  rowTagText: { color: '#fff', fontSize: 11, fontWeight: '600' },
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
  tagSectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#999',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 10,
  },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 24 },
  tagPill: {
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1.5,
    borderColor: '#DDD',
    backgroundColor: '#F5F5F5',
  },
  tagPillText: { fontSize: 13, fontWeight: '600', color: '#888' },
  tagPillTextActive: { color: '#fff' },
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

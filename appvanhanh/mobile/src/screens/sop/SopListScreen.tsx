import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { sopApi } from '../../api/client';
import Card from '../../components/common/Card';
import { Colors } from '../../utils/colors';

const CATEGORIES = [
  { label: 'Tất cả', value: '' },
  { label: 'Vận hành', value: 'Vận hành' },
  { label: 'Bán hàng', value: 'Bán hàng' },
  { label: 'CSKH', value: 'CSKH' },
  { label: 'An toàn', value: 'An toàn' },
];

export default function SopListScreen() {
  const navigation = useNavigation<any>();
  const [docs, setDocs] = useState<any[]>([]);
  const [myProgress, setMyProgress] = useState<any[]>([]);
  const [category, setCategory] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const load = async () => {
    try {
      const [dRes, pRes] = await Promise.all([
        sopApi.listDocuments(category ? { category } : {}),
        sopApi.myProgress(),
      ]);
      setDocs(dRes.data.data);
      setMyProgress(pRes.data.data.progress || []);
    } catch {}
  };

  useEffect(() => { load(); }, [category]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const getProgress = (docId: string) =>
    myProgress.find((p: any) => p.documentId === docId);

  return (
    <View style={styles.container}>
      <FlatList
        data={CATEGORIES}
        horizontal
        showsHorizontalScrollIndicator={false}
        keyExtractor={(c) => c.value}
        contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 12 }}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={[styles.chip, category === item.value && styles.chipActive]}
            onPress={() => setCategory(item.value)}
          >
            <Text style={[styles.chipText, category === item.value && styles.chipTextActive]}>{item.label}</Text>
          </TouchableOpacity>
        )}
      />

      <FlatList
        data={docs}
        keyExtractor={(d) => d.id}
        contentContainerStyle={{ padding: 16, paddingTop: 0 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        renderItem={({ item }) => {
          const progress = getProgress(item.id);
          return (
            <TouchableOpacity onPress={() => navigation.navigate('SopDetail', { id: item.id })}>
              <Card>
                <View style={styles.docRow}>
                  <View style={[styles.docIcon, { backgroundColor: item.fileType === 'video' ? Colors.accent + '20' : Colors.primary + '15' }]}>
                    <Ionicons
                      name={item.fileType === 'video' ? 'videocam-outline' : 'document-text-outline'}
                      size={22}
                      color={item.fileType === 'video' ? Colors.accent : Colors.primary}
                    />
                  </View>
                  <View style={styles.docInfo}>
                    <Text style={styles.docTitle}>{item.title}</Text>
                    {item.category && <Text style={styles.docCategory}>{item.category}</Text>}
                    {item.description && <Text style={styles.docDesc} numberOfLines={2}>{item.description}</Text>}
                  </View>
                  {progress?.isCompleted ? (
                    <Ionicons name="checkmark-circle" size={22} color={Colors.success} />
                  ) : (
                    <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
                  )}
                </View>
              </Card>
            </TouchableOpacity>
          );
        }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="book-outline" size={48} color={Colors.textMuted} />
            <Text style={styles.emptyText}>Chưa có tài liệu</Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  chip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.border, marginRight: 8 },
  chipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  chipText: { fontSize: 13, color: Colors.textSecondary, fontWeight: '500' },
  chipTextActive: { color: Colors.white, fontWeight: '700' },
  docRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  docIcon: { width: 48, height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  docInfo: { flex: 1 },
  docTitle: { fontSize: 15, fontWeight: '700', color: Colors.text },
  docCategory: { fontSize: 11, color: Colors.primary, fontWeight: '600', marginTop: 2 },
  docDesc: { fontSize: 12, color: Colors.textSecondary, marginTop: 3, lineHeight: 16 },
  empty: { alignItems: 'center', paddingTop: 60, gap: 12 },
  emptyText: { fontSize: 15, color: Colors.textMuted },
});

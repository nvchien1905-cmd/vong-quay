import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Alert, Image, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { checklistApi } from '../../api/client';
import Button from '../../components/common/Button';
import { Colors } from '../../utils/colors';

export default function ChecklistSessionScreen({ route, navigation }: any) {
  const { sessionId } = route.params;
  const [session, setSession] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [completing, setCompleting] = useState(false);

  const loadSession = async () => {
    try {
      const { data } = await checklistApi.listSessions({});
      const found = data.data.find((s: any) => s.id === sessionId);
      setSession(found || null);
    } catch {
      Alert.alert('Lỗi', 'Không tải được checklist');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadSession(); }, [sessionId]);

  const toggleItem = async (itemId: string, current: boolean) => {
    const formData = new FormData();
    formData.append('isChecked', (!current).toString());
    try {
      await checklistApi.updateItem(itemId, formData);
      await loadSession();
    } catch {
      Alert.alert('Lỗi', 'Không cập nhật được');
    }
  };

  const addPhoto = async (itemId: string) => {
    const result = await ImagePicker.launchImageLibraryAsync({ quality: 0.7 });
    if (result.canceled) return;

    const asset = result.assets[0];
    const formData = new FormData();
    formData.append('photo', { uri: asset.uri, name: 'photo.jpg', type: 'image/jpeg' } as any);
    formData.append('isChecked', 'true');

    try {
      await checklistApi.updateItem(itemId, formData);
      await loadSession();
    } catch {
      Alert.alert('Lỗi', 'Upload ảnh thất bại');
    }
  };

  const completeSession = async () => {
    setCompleting(true);
    try {
      await checklistApi.completeSession(sessionId);
      Alert.alert('Hoàn thành!', 'Checklist ca đã được ghi nhận', [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    } catch {
      Alert.alert('Lỗi', 'Không thể hoàn tất');
    } finally {
      setCompleting(false);
    }
  };

  if (loading) return <View style={styles.center}><ActivityIndicator size="large" color={Colors.primary} /></View>;
  if (!session) return <View style={styles.center}><Text>Không tìm thấy phiên</Text></View>;

  const items = session.items || [];
  const done = items.filter((i: any) => i.isChecked).length;
  const pct = items.length > 0 ? Math.round((done / items.length) * 100) : 0;
  const isCompleted = !!session.completedAt;

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 16 }}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{session.template?.name}</Text>
        <Text style={styles.headerSub}>{session.user?.name}</Text>
        <View style={styles.progressRow}>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${pct}%` }]} />
          </View>
          <Text style={styles.pctText}>{done}/{items.length}</Text>
        </View>
      </View>

      {items.map((item: any) => (
        <View key={item.id} style={[styles.item, item.isChecked && styles.itemDone]}>
          <TouchableOpacity
            style={styles.checkboxArea}
            onPress={() => !isCompleted && toggleItem(item.id, item.isChecked)}
            disabled={isCompleted}
          >
            <View style={[styles.checkbox, item.isChecked && styles.checkboxChecked]}>
              {item.isChecked && <Ionicons name="checkmark" size={14} color={Colors.white} />}
            </View>
          </TouchableOpacity>

          <View style={styles.itemContent}>
            <Text style={[styles.itemLabel, item.isChecked && styles.itemLabelDone]}>{item.label}</Text>
            {item.checkedAt && (
              <Text style={styles.itemTime}>{new Date(item.checkedAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}</Text>
            )}
            {item.photoUrl && <Image source={{ uri: item.photoUrl }} style={styles.itemPhoto} />}
          </View>

          {!isCompleted && (
            <TouchableOpacity onPress={() => addPhoto(item.id)} style={styles.photoBtn}>
              <Ionicons name={item.photoUrl ? 'image' : 'camera-outline'} size={20} color={item.photoUrl ? Colors.success : Colors.textMuted} />
            </TouchableOpacity>
          )}
        </View>
      ))}

      {!isCompleted && pct === 100 && (
        <Button
          title="Hoàn tất ca"
          onPress={completeSession}
          loading={completing}
          variant="secondary"
          style={{ marginTop: 8 }}
        />
      )}

      {isCompleted && (
        <View style={styles.completedBanner}>
          <Ionicons name="checkmark-circle" size={24} color={Colors.success} />
          <Text style={styles.completedText}>Đã hoàn tất phiên này</Text>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { backgroundColor: Colors.primary, borderRadius: 14, padding: 16, marginBottom: 16 },
  headerTitle: { fontSize: 17, fontWeight: '800', color: Colors.white },
  headerSub: { fontSize: 12, color: 'rgba(255,255,255,0.7)', marginTop: 2 },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10 },
  progressTrack: { flex: 1, height: 8, backgroundColor: 'rgba(255,255,255,0.3)', borderRadius: 4 },
  progressFill: { height: 8, backgroundColor: Colors.accent, borderRadius: 4 },
  pctText: { color: Colors.white, fontWeight: '700', fontSize: 13 },
  item: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.white, borderRadius: 12, padding: 14, marginBottom: 8, gap: 12 },
  itemDone: { opacity: 0.75 },
  checkboxArea: { padding: 2 },
  checkbox: { width: 26, height: 26, borderRadius: 8, borderWidth: 2, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center' },
  checkboxChecked: { backgroundColor: Colors.success, borderColor: Colors.success },
  itemContent: { flex: 1 },
  itemLabel: { fontSize: 14, color: Colors.text, fontWeight: '500' },
  itemLabelDone: { textDecorationLine: 'line-through', color: Colors.textMuted },
  itemTime: { fontSize: 11, color: Colors.success, marginTop: 2 },
  itemPhoto: { width: 60, height: 60, borderRadius: 8, marginTop: 6 },
  photoBtn: { padding: 4 },
  completedBanner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 16, backgroundColor: Colors.success + '20', borderRadius: 12, marginTop: 8 },
  completedText: { color: Colors.success, fontWeight: '700', fontSize: 15 },
});

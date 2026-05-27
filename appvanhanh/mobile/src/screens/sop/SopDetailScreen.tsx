import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, Linking, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { sopApi } from '../../api/client';
import Button from '../../components/common/Button';
import Card from '../../components/common/Card';
import { Colors } from '../../utils/colors';

export default function SopDetailScreen({ route }: any) {
  const { id } = route.params;
  const navigation = useNavigation<any>();
  const [doc, setDoc] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [marking, setMarking] = useState(false);

  useEffect(() => {
    sopApi.getDocument(id)
      .then(({ data }) => setDoc(data.data))
      .catch(() => Alert.alert('Lỗi', 'Không tải được tài liệu'))
      .finally(() => setLoading(false));
  }, [id]);

  const handleMarkComplete = async () => {
    setMarking(true);
    try {
      await sopApi.markProgress(id);
      Alert.alert('Xác nhận', 'Đã ghi nhận bạn đã đọc tài liệu này');
      const { data } = await sopApi.getDocument(id);
      setDoc(data.data);
    } catch {
      Alert.alert('Lỗi', 'Không ghi nhận được');
    } finally {
      setMarking(false);
    }
  };

  if (loading) return <View style={styles.center}><ActivityIndicator size="large" color={Colors.primary} /></View>;
  if (!doc) return null;

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 16 }}>
      <Card>
        <View style={styles.docHeader}>
          <View style={[styles.iconBox, { backgroundColor: doc.fileType === 'video' ? Colors.accent + '20' : Colors.primary + '15' }]}>
            <Ionicons
              name={doc.fileType === 'video' ? 'videocam-outline' : 'document-text-outline'}
              size={28}
              color={doc.fileType === 'video' ? Colors.accent : Colors.primary}
            />
          </View>
          <View style={styles.docMeta}>
            <Text style={styles.docTitle}>{doc.title}</Text>
            {doc.category && <Text style={styles.docCategory}>{doc.category}</Text>}
          </View>
          {doc.progress?.isCompleted && (
            <Ionicons name="checkmark-circle" size={26} color={Colors.success} />
          )}
        </View>

        {doc.description && <Text style={styles.docDesc}>{doc.description}</Text>}

        <TouchableOpacity style={styles.openBtn} onPress={() => Linking.openURL(doc.fileUrl)}>
          <Ionicons name={doc.fileType === 'video' ? 'play-circle-outline' : 'open-outline'} size={18} color={Colors.white} />
          <Text style={styles.openBtnText}>{doc.fileType === 'video' ? 'Xem video' : 'Mở tài liệu'}</Text>
        </TouchableOpacity>
      </Card>

      {!doc.progress?.isCompleted && (
        <Button
          title="Xác nhận đã đọc/xem"
          onPress={handleMarkComplete}
          loading={marking}
          variant="secondary"
          style={{ marginBottom: 12 }}
        />
      )}

      {doc.quizzes?.length > 0 && (
        <Card>
          <Text style={styles.sectionTitle}>Bài kiểm tra ({doc.quizzes.length})</Text>
          {doc.quizzes.map((q: any) => (
            <TouchableOpacity
              key={q.id}
              style={styles.quizRow}
              onPress={() => navigation.navigate('Quiz', { quizId: q.id })}
            >
              <Ionicons name="help-circle-outline" size={20} color={Colors.primary} />
              <Text style={styles.quizTitle}>{q.title}</Text>
              <Ionicons name="chevron-forward" size={16} color={Colors.textMuted} />
            </TouchableOpacity>
          ))}
        </Card>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  docHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
  iconBox: { width: 56, height: 56, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  docMeta: { flex: 1 },
  docTitle: { fontSize: 17, fontWeight: '800', color: Colors.text },
  docCategory: { fontSize: 12, color: Colors.primary, fontWeight: '600', marginTop: 2 },
  docDesc: { fontSize: 14, color: Colors.textSecondary, lineHeight: 20, marginBottom: 14 },
  openBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: Colors.primary, borderRadius: 10, paddingVertical: 12 },
  openBtnText: { color: Colors.white, fontSize: 15, fontWeight: '700' },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: Colors.text, marginBottom: 12 },
  quizRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: Colors.border },
  quizTitle: { flex: 1, fontSize: 14, color: Colors.text, fontWeight: '500' },
});

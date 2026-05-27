import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  Alert, RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { checklistApi } from '../../api/client';
import Card from '../../components/common/Card';
import { Colors } from '../../utils/colors';
import { format } from 'date-fns';

const TYPE_LABELS: Record<string, string> = {
  OPEN_SHIFT: 'Mở ca',
  CLOSE_SHIFT: 'Đóng ca',
  CLEANING: 'Vệ sinh',
  DISPLAY: 'Trưng bày',
  INVENTORY: 'Kiểm kho',
  LIVESTREAM: 'Livestream',
  CUSTOMER_SERVICE: 'CSKH',
};

const TYPE_ICONS: Record<string, string> = {
  OPEN_SHIFT: 'sunny-outline',
  CLOSE_SHIFT: 'moon-outline',
  CLEANING: 'sparkles-outline',
  DISPLAY: 'grid-outline',
  INVENTORY: 'cube-outline',
  LIVESTREAM: 'videocam-outline',
  CUSTOMER_SERVICE: 'happy-outline',
};

export default function ChecklistScreen() {
  const navigation = useNavigation<any>();
  const [templates, setTemplates] = useState<any[]>([]);
  const [sessions, setSessions] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<'templates' | 'sessions'>('templates');

  const load = async () => {
    try {
      const [tRes, sRes] = await Promise.all([
        checklistApi.listTemplates(),
        checklistApi.listSessions({ date: new Date().toISOString().split('T')[0] }),
      ]);
      setTemplates(tRes.data.data);
      setSessions(sRes.data.data);
    } catch {
      Alert.alert('Lỗi', 'Không tải được checklist');
    }
  };

  useEffect(() => { load(); }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const startSession = async (templateId: string) => {
    try {
      const { data } = await checklistApi.startSession(templateId);
      navigation.navigate('ChecklistSession', { sessionId: data.data.id });
    } catch {
      Alert.alert('Lỗi', 'Không thể bắt đầu checklist');
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.tabs}>
        {(['templates', 'sessions'] as const).map((t) => (
          <TouchableOpacity
            key={t}
            style={[styles.tab, tab === t && styles.tabActive]}
            onPress={() => setTab(t)}
          >
            <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>
              {t === 'templates' ? 'Mẫu checklist' : `Hôm nay (${sessions.length})`}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {tab === 'templates' ? (
        <FlatList
          data={templates}
          keyExtractor={(t) => t.id}
          contentContainerStyle={{ padding: 16 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          renderItem={({ item }) => (
            <Card>
              <View style={styles.templateHeader}>
                <View style={styles.iconBox}>
                  <Ionicons name={TYPE_ICONS[item.type] as any || 'list-outline'} size={22} color={Colors.primary} />
                </View>
                <View style={styles.templateInfo}>
                  <Text style={styles.templateName}>{item.name}</Text>
                  <Text style={styles.templateType}>{TYPE_LABELS[item.type] || item.type}</Text>
                </View>
                <Text style={styles.itemCount}>{item.items?.length || 0} hạng mục</Text>
              </View>
              <TouchableOpacity style={styles.startBtn} onPress={() => startSession(item.id)}>
                <Ionicons name="play-circle-outline" size={16} color={Colors.white} />
                <Text style={styles.startBtnText}>Bắt đầu</Text>
              </TouchableOpacity>
            </Card>
          )}
          ListEmptyComponent={<Text style={styles.emptyText}>Chưa có mẫu checklist</Text>}
        />
      ) : (
        <FlatList
          data={sessions}
          keyExtractor={(s) => s.id}
          contentContainerStyle={{ padding: 16 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          renderItem={({ item }) => {
            const done = item.items?.filter((i: any) => i.isChecked).length || 0;
            const total = item.items?.length || 0;
            const pct = total > 0 ? Math.round((done / total) * 100) : 0;
            return (
              <TouchableOpacity
                onPress={() => navigation.navigate('ChecklistSession', { sessionId: item.id })}
              >
                <Card>
                  <View style={styles.sessionRow}>
                    <View style={styles.sessionLeft}>
                      <Text style={styles.sessionName}>{item.template?.name}</Text>
                      <Text style={styles.sessionUser}>{item.user?.name} · {format(new Date(item.shiftDate), 'HH:mm')}</Text>
                    </View>
                    <View style={styles.sessionRight}>
                      <Text style={[styles.pct, pct === 100 && styles.pctDone]}>{pct}%</Text>
                      {item.completedAt && (
                        <Ionicons name="checkmark-circle" size={18} color={Colors.success} />
                      )}
                    </View>
                  </View>
                  <View style={styles.progressTrack}>
                    <View style={[styles.progressFill, { width: `${pct}%`, backgroundColor: pct === 100 ? Colors.success : Colors.primary }]} />
                  </View>
                </Card>
              </TouchableOpacity>
            );
          }}
          ListEmptyComponent={<Text style={styles.emptyText}>Chưa có phiên làm việc hôm nay</Text>}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  tabs: { flexDirection: 'row', backgroundColor: Colors.white, borderBottomWidth: 1, borderBottomColor: Colors.border },
  tab: { flex: 1, paddingVertical: 13, alignItems: 'center' },
  tabActive: { borderBottomWidth: 3, borderBottomColor: Colors.primary },
  tabText: { fontSize: 14, color: Colors.textSecondary, fontWeight: '500' },
  tabTextActive: { color: Colors.primary, fontWeight: '700' },
  templateHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
  iconBox: { width: 44, height: 44, backgroundColor: Colors.primary + '15', borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  templateInfo: { flex: 1 },
  templateName: { fontSize: 15, fontWeight: '700', color: Colors.text },
  templateType: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  itemCount: { fontSize: 12, color: Colors.primary, fontWeight: '600' },
  startBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: Colors.primary, borderRadius: 8, paddingVertical: 10 },
  startBtnText: { color: Colors.white, fontSize: 14, fontWeight: '700' },
  sessionRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  sessionLeft: { flex: 1 },
  sessionName: { fontSize: 15, fontWeight: '700', color: Colors.text },
  sessionUser: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  sessionRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  pct: { fontSize: 16, fontWeight: '800', color: Colors.primary },
  pctDone: { color: Colors.success },
  progressTrack: { height: 6, backgroundColor: Colors.border, borderRadius: 3 },
  progressFill: { height: 6, borderRadius: 3 },
  emptyText: { textAlign: 'center', color: Colors.textMuted, marginTop: 40, fontSize: 14 },
});

import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  RefreshControl, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { dashboardApi } from '../../api/client';
import Card from '../../components/common/Card';
import { Colors } from '../../utils/colors';
import { useAuthStore } from '../../store/authStore';
import { format } from 'date-fns';
import { vi } from 'date-fns/locale';

interface Stats {
  totalTasks: number;
  completedToday: number;
  overdueTasks: number;
  pendingApproval: number;
  inProgress: number;
  kpiPercent: number;
}

export default function DashboardScreen() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [overdueList, setOverdueList] = useState<any[]>([]);
  const [incompleteEmployees, setIncompleteEmployees] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const { user } = useAuthStore();
  const navigation = useNavigation<any>();

  const load = async () => {
    try {
      const [ovRes, empRes] = await Promise.all([
        dashboardApi.overview(),
        dashboardApi.incompleteEmployees(),
      ]);
      setStats(ovRes.data.data.stats);
      setOverdueList(ovRes.data.data.overdueList);
      setIncompleteEmployees(empRes.data.data);
    } catch {
      Alert.alert('Lỗi', 'Không tải được dữ liệu');
    }
  };

  useEffect(() => { load(); }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ padding: 16 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
    >
      <View style={styles.greeting}>
        <Text style={styles.greetingText}>Xin chào, {user?.name?.split(' ').pop()} 👋</Text>
        <Text style={styles.dateText}>{format(new Date(), 'EEEE, dd/MM/yyyy', { locale: vi })}</Text>
      </View>

      {stats && (
        <>
          <View style={styles.kpiBar}>
            <Text style={styles.kpiLabel}>KPI hôm nay: {stats.kpiPercent}%</Text>
            <View style={styles.kpiTrack}>
              <View style={[styles.kpiFill, { width: `${stats.kpiPercent}%` }]} />
            </View>
          </View>

          <View style={styles.statsGrid}>
            <StatBox label="Tổng task" value={stats.totalTasks} color={Colors.primary} icon="list" />
            <StatBox label="Hoàn thành hôm nay" value={stats.completedToday} color={Colors.success} icon="checkmark-circle" />
            <StatBox label="Quá hạn" value={stats.overdueTasks} color={Colors.error} icon="alert-circle" />
            <StatBox label="Chờ duyệt" value={stats.pendingApproval} color={Colors.warning} icon="hourglass" />
          </View>
        </>
      )}

      {overdueList.length > 0 && (
        <Card>
          <Text style={styles.sectionTitle}>⚠️ Task quá hạn ({overdueList.length})</Text>
          {overdueList.map((t) => (
            <TouchableOpacity
              key={t.id}
              style={styles.overdueItem}
              onPress={() => navigation.navigate('Tasks', { screen: 'TaskDetail', params: { id: t.id } })}
            >
              <View style={styles.overdueLeft}>
                <Text style={styles.overdueTitle} numberOfLines={1}>{t.title}</Text>
                {t.assignee && <Text style={styles.overdueMeta}>{t.assignee.name}</Text>}
              </View>
              <Text style={styles.overdueDeadline}>
                {t.deadline ? format(new Date(t.deadline), 'dd/MM') : ''}
              </Text>
            </TouchableOpacity>
          ))}
        </Card>
      )}

      {incompleteEmployees.length > 0 && (
        <Card>
          <Text style={styles.sectionTitle}>👤 Nhân viên còn task chưa xong</Text>
          {incompleteEmployees.slice(0, 5).map((e) => (
            <View key={e.id} style={styles.empRow}>
              <Text style={styles.empName}>{e.name}</Text>
              <View style={styles.empBadge}>
                <Text style={styles.empCount}>{e.incompleteTasks} task</Text>
              </View>
            </View>
          ))}
        </Card>
      )}

      <TouchableOpacity style={styles.reportBtn} onPress={() => navigation.navigate('Reports')}>
        <Ionicons name="bar-chart-outline" size={18} color={Colors.white} />
        <Text style={styles.reportBtnText}>Xem báo cáo chi tiết</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

function StatBox({ label, value, color, icon }: { label: string; value: number; color: string; icon: string }) {
  return (
    <View style={[styles.statBox, { borderTopColor: color }]}>
      <Ionicons name={icon as any} size={22} color={color} />
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  greeting: { marginBottom: 16 },
  greetingText: { fontSize: 20, fontWeight: '800', color: Colors.text },
  dateText: { fontSize: 13, color: Colors.textSecondary, marginTop: 2 },
  kpiBar: { marginBottom: 16 },
  kpiLabel: { fontSize: 14, fontWeight: '600', color: Colors.text, marginBottom: 6 },
  kpiTrack: { height: 10, backgroundColor: Colors.border, borderRadius: 5 },
  kpiFill: { height: 10, backgroundColor: Colors.success, borderRadius: 5 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 14 },
  statBox: {
    flex: 1, minWidth: '45%',
    backgroundColor: Colors.white,
    borderRadius: 12, padding: 14,
    alignItems: 'center',
    borderTopWidth: 3,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06, shadowRadius: 3, elevation: 2,
  },
  statValue: { fontSize: 26, fontWeight: '900', color: Colors.text, marginTop: 4 },
  statLabel: { fontSize: 11, color: Colors.textSecondary, textAlign: 'center', marginTop: 2 },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: Colors.text, marginBottom: 10 },
  overdueItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: Colors.border },
  overdueLeft: { flex: 1, marginRight: 8 },
  overdueTitle: { fontSize: 14, fontWeight: '600', color: Colors.text },
  overdueMeta: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  overdueDeadline: { fontSize: 12, color: Colors.error, fontWeight: '600' },
  empRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: Colors.border },
  empName: { fontSize: 14, color: Colors.text },
  empBadge: { backgroundColor: Colors.error + '20', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20 },
  empCount: { fontSize: 12, color: Colors.error, fontWeight: '700' },
  reportBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: Colors.primary, borderRadius: 12, padding: 14, marginTop: 4 },
  reportBtnText: { color: Colors.white, fontSize: 15, fontWeight: '700' },
});

import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, RefreshControl, TouchableOpacity,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { kpiApi } from '../../api/client';
import Card from '../../components/common/Card';
import { Colors } from '../../utils/colors';
import { useAuthStore } from '../../store/authStore';

export default function KpiScreen() {
  const { user } = useAuthStore();
  const [myKpi, setMyKpi] = useState<{ total: number; history: any[] } | null>(null);
  const [ranking, setRanking] = useState<any[]>([]);
  const [storeRanking, setStoreRanking] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<'me' | 'team' | 'stores'>('me');

  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();

  const load = async () => {
    try {
      const [myRes, rankRes, storeRes] = await Promise.all([
        kpiApi.myKpi({ month, year }),
        kpiApi.employeeRanking({ month, year }),
        ['OWNER', 'ZONE_MANAGER'].includes(user?.role || '') ? kpiApi.storeRanking({ month, year }) : Promise.resolve({ data: { data: { ranking: [] } } }),
      ]);
      setMyKpi(myRes.data.data);
      setRanking(rankRes.data.data.ranking);
      setStoreRanking(storeRes.data.data.ranking);
    } catch {}
  };

  useEffect(() => { load(); }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const getScoreColor = (score: number) => {
    if (score >= 50) return Colors.success;
    if (score >= 0) return Colors.warning;
    return Colors.error;
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ padding: 16 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <Text style={styles.monthLabel}>Tháng {month}/{year}</Text>

      <View style={styles.tabs}>
        {[
          { key: 'me', label: 'Của tôi' },
          { key: 'team', label: 'Nhân viên' },
          ...((['OWNER', 'ZONE_MANAGER'].includes(user?.role || '')) ? [{ key: 'stores', label: 'Cửa hàng' }] : []),
        ].map((t) => (
          <TouchableOpacity
            key={t.key}
            style={[styles.tab, tab === t.key && styles.tabActive]}
            onPress={() => setTab(t.key as any)}
          >
            <Text style={[styles.tabText, tab === t.key && styles.tabTextActive]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {tab === 'me' && myKpi && (
        <>
          <Card>
            <Text style={styles.sectionTitle}>Điểm KPI của tôi</Text>
            <View style={styles.scoreBox}>
              <Text style={[styles.bigScore, { color: getScoreColor(myKpi.total) }]}>{myKpi.total}</Text>
              <Text style={styles.scoreLabel}>điểm</Text>
            </View>
          </Card>
          <Card>
            <Text style={styles.sectionTitle}>Chi tiết</Text>
            {myKpi.history.map((h: any, i: number) => (
              <View key={i} style={styles.historyRow}>
                <View style={styles.historyLeft}>
                  <Ionicons
                    name={h.score > 0 ? 'arrow-up-circle' : 'arrow-down-circle'}
                    size={20}
                    color={h.score > 0 ? Colors.success : Colors.error}
                  />
                  <Text style={styles.historyReason}>{h.reason}</Text>
                </View>
                <Text style={[styles.historyScore, { color: h.score > 0 ? Colors.success : Colors.error }]}>
                  {h.score > 0 ? '+' : ''}{h.score}
                </Text>
              </View>
            ))}
            {myKpi.history.length === 0 && (
              <Text style={styles.emptyText}>Chưa có giao dịch KPI</Text>
            )}
          </Card>
        </>
      )}

      {tab === 'team' && (
        <Card>
          <Text style={styles.sectionTitle}>BXH nhân viên</Text>
          {ranking.map((r: any, i: number) => (
            <View key={r.user?.id || i} style={styles.rankRow}>
              <Text style={[styles.rankNum, i < 3 && styles.rankTop]}>{i + 1}</Text>
              <View style={styles.rankUser}>
                <Text style={styles.rankName}>{r.user?.name || 'N/A'}</Text>
              </View>
              <Text style={[styles.rankScore, { color: getScoreColor(r.total) }]}>{r.total} đ</Text>
            </View>
          ))}
          {ranking.length === 0 && <Text style={styles.emptyText}>Chưa có dữ liệu</Text>}
        </Card>
      )}

      {tab === 'stores' && (
        <Card>
          <Text style={styles.sectionTitle}>BXH cửa hàng</Text>
          {storeRanking.map((r: any, i: number) => (
            <View key={r.store?.id || i} style={styles.rankRow}>
              <Text style={[styles.rankNum, i < 3 && styles.rankTop]}>{i + 1}</Text>
              <View style={styles.rankUser}>
                <Text style={styles.rankName}>{r.store?.name || 'N/A'}</Text>
              </View>
              <Text style={[styles.rankScore, { color: getScoreColor(r.total) }]}>{r.total} đ</Text>
            </View>
          ))}
          {storeRanking.length === 0 && <Text style={styles.emptyText}>Chưa có dữ liệu</Text>}
        </Card>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  monthLabel: { fontSize: 16, fontWeight: '700', color: Colors.text, marginBottom: 12 },
  tabs: { flexDirection: 'row', backgroundColor: Colors.white, borderRadius: 12, padding: 4, marginBottom: 16 },
  tab: { flex: 1, paddingVertical: 9, alignItems: 'center', borderRadius: 10 },
  tabActive: { backgroundColor: Colors.primary },
  tabText: { fontSize: 13, color: Colors.textSecondary, fontWeight: '600' },
  tabTextActive: { color: Colors.white },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: Colors.text, marginBottom: 12 },
  scoreBox: { alignItems: 'center', paddingVertical: 16 },
  bigScore: { fontSize: 56, fontWeight: '900' },
  scoreLabel: { fontSize: 16, color: Colors.textSecondary, marginTop: -4 },
  historyRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: Colors.border },
  historyLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  historyReason: { fontSize: 13, color: Colors.text, flex: 1 },
  historyScore: { fontSize: 15, fontWeight: '700' },
  rankRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.border },
  rankNum: { width: 28, height: 28, borderRadius: 14, backgroundColor: Colors.border, alignItems: 'center', justifyContent: 'center', textAlign: 'center', fontSize: 13, fontWeight: '700', color: Colors.textSecondary, lineHeight: 28 },
  rankTop: { backgroundColor: Colors.accent, color: Colors.white },
  rankUser: { flex: 1 },
  rankName: { fontSize: 14, color: Colors.text, fontWeight: '600' },
  rankScore: { fontSize: 15, fontWeight: '800' },
  emptyText: { textAlign: 'center', color: Colors.textMuted, fontSize: 14, paddingVertical: 20 },
});

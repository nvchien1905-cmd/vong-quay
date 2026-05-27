import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, RefreshControl, TouchableOpacity, Dimensions,
} from 'react-native';
import { BarChart } from 'react-native-chart-kit';
import { reportApi } from '../../api/client';
import Card from '../../components/common/Card';
import { Colors } from '../../utils/colors';

const SCREEN_WIDTH = Dimensions.get('window').width;

const RANGES = [
  { label: '7 ngày', days: 7 },
  { label: '30 ngày', days: 30 },
  { label: 'Tháng này', days: 0 },
];

export default function ReportScreen() {
  const [range, setRange] = useState(7);
  const [stats, setStats] = useState<any>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = async () => {
    const to = new Date().toISOString();
    const from = new Date(Date.now() - range * 86400000).toISOString();
    try {
      const { data } = await reportApi.taskStats({ from, to });
      setStats(data.data);
    } catch {}
  };

  useEffect(() => { load(); }, [range]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const chartData = stats?.dailyData?.slice(-7) || [];
  const labels = chartData.map((d: any) => d.date.slice(5));
  const completedData = chartData.map((d: any) => d.completed || 0);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ padding: 16 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <View style={styles.rangeRow}>
        {RANGES.map((r) => (
          <TouchableOpacity
            key={r.days}
            style={[styles.rangeChip, range === r.days && styles.rangeChipActive]}
            onPress={() => setRange(r.days)}
          >
            <Text style={[styles.rangeText, range === r.days && styles.rangeTextActive]}>{r.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {stats && (
        <>
          <View style={styles.statsGrid}>
            <StatItem label="Tổng task" value={stats.summary.total} color={Colors.primary} />
            <StatItem label="Hoàn thành" value={stats.summary.completed} color={Colors.success} />
            <StatItem label="Tỷ lệ" value={`${stats.summary.completionRate}%`} color={Colors.accent} />
            <StatItem label="Quá hạn" value={stats.summary.overdue} color={Colors.error} />
            <StatItem label="Tồn đọng" value={stats.summary.inProgress + stats.summary.pending} color={Colors.warning} />
            <StatItem label="Bị từ chối" value={stats.summary.rejected} color={Colors.overdueText} />
          </View>

          {completedData.length > 0 && labels.length > 0 && (
            <Card>
              <Text style={styles.sectionTitle}>Task hoàn thành theo ngày</Text>
              <BarChart
                data={{
                  labels,
                  datasets: [{ data: completedData.length > 0 ? completedData : [0] }],
                }}
                width={SCREEN_WIDTH - 64}
                height={180}
                yAxisLabel=""
                yAxisSuffix=""
                chartConfig={{
                  backgroundColor: Colors.white,
                  backgroundGradientFrom: Colors.white,
                  backgroundGradientTo: Colors.white,
                  decimalPlaces: 0,
                  color: () => Colors.primary,
                  labelColor: () => Colors.textSecondary,
                  style: { borderRadius: 8 },
                }}
                style={{ borderRadius: 8 }}
                showValuesOnTopOfBars
              />
            </Card>
          )}

          <Card>
            <Text style={styles.sectionTitle}>Phân tích tỷ lệ hoàn thành</Text>
            <View style={styles.completionBar}>
              <View style={[styles.completionFill, { width: `${stats.summary.completionRate}%` }]} />
            </View>
            <Text style={styles.completionNote}>
              {stats.summary.completed}/{stats.summary.total} task đã hoàn thành ({stats.summary.completionRate}%)
            </Text>
          </Card>
        </>
      )}
    </ScrollView>
  );
}

function StatItem({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <View style={[styles.statItem, { borderTopColor: color }]}>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  rangeRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  rangeChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.border },
  rangeChipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  rangeText: { fontSize: 13, color: Colors.textSecondary, fontWeight: '500' },
  rangeTextActive: { color: Colors.white, fontWeight: '700' },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 14 },
  statItem: {
    flex: 1, minWidth: '30%',
    backgroundColor: Colors.white, borderRadius: 12, padding: 12,
    alignItems: 'center', borderTopWidth: 3,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2, elevation: 1,
  },
  statValue: { fontSize: 22, fontWeight: '900' },
  statLabel: { fontSize: 11, color: Colors.textSecondary, textAlign: 'center', marginTop: 2 },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: Colors.text, marginBottom: 12 },
  completionBar: { height: 12, backgroundColor: Colors.border, borderRadius: 6, marginBottom: 8 },
  completionFill: { height: 12, backgroundColor: Colors.success, borderRadius: 6 },
  completionNote: { fontSize: 13, color: Colors.textSecondary, textAlign: 'center' },
});

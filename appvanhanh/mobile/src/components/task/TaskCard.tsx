import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { format } from 'date-fns';
import { vi } from 'date-fns/locale';
import Badge from '../common/Badge';
import { Colors, getPriorityColor, getStatusColor, PRIORITY_LABELS, STATUS_LABELS } from '../../utils/colors';

interface Props {
  task: any;
  onPress: () => void;
}

export default function TaskCard({ task, onPress }: Props) {
  const isOverdue = task.deadline && new Date(task.deadline) < new Date()
    && task.status !== 'COMPLETED';

  return (
    <TouchableOpacity style={[styles.card, isOverdue && styles.overdueCard]} onPress={onPress} activeOpacity={0.85}>
      <View style={styles.header}>
        <Badge
          label={PRIORITY_LABELS[task.priority] || task.priority}
          color={getPriorityColor(task.priority)}
          size="sm"
        />
        <Badge
          label={STATUS_LABELS[task.status] || task.status}
          color={getStatusColor(task.status)}
          size="sm"
        />
      </View>

      <Text style={styles.title} numberOfLines={2}>{task.title}</Text>

      {task.assignee && (
        <View style={styles.row}>
          <Ionicons name="person-outline" size={13} color={Colors.textSecondary} />
          <Text style={styles.meta}>{task.assignee.name}</Text>
        </View>
      )}

      {task.store && (
        <View style={styles.row}>
          <Ionicons name="storefront-outline" size={13} color={Colors.textSecondary} />
          <Text style={styles.meta}>{task.store.name}</Text>
        </View>
      )}

      {task.deadline && (
        <View style={styles.row}>
          <Ionicons name="time-outline" size={13} color={isOverdue ? Colors.error : Colors.textSecondary} />
          <Text style={[styles.meta, isOverdue && styles.overdueText]}>
            {format(new Date(task.deadline), 'dd/MM/yyyy HH:mm', { locale: vi })}
          </Text>
        </View>
      )}

      {(task._count?.comments > 0) && (
        <View style={styles.row}>
          <Ionicons name="chatbubble-outline" size={13} color={Colors.textSecondary} />
          <Text style={styles.meta}>{task._count.comments} bình luận</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.white,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderLeftWidth: 4,
    borderLeftColor: Colors.primary,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.07,
    shadowRadius: 3,
    elevation: 2,
  },
  overdueCard: { borderLeftColor: Colors.error, backgroundColor: '#FFF5F5' },
  header: { flexDirection: 'row', gap: 6, marginBottom: 8 },
  title: { fontSize: 15, fontWeight: '700', color: Colors.text, marginBottom: 8, lineHeight: 20 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 3 },
  meta: { fontSize: 12, color: Colors.textSecondary },
  overdueText: { color: Colors.error, fontWeight: '600' },
});

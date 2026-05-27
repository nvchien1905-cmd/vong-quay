import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useTaskStore } from '../../store/taskStore';
import Input from '../../components/common/Input';
import Button from '../../components/common/Button';
import { Colors } from '../../utils/colors';

const PRIORITIES = [
  { label: 'Thấp', value: 'LOW' },
  { label: 'Trung bình', value: 'MEDIUM' },
  { label: 'Cao', value: 'HIGH' },
  { label: 'Khẩn', value: 'URGENT' },
];

const PRIORITY_COLORS: Record<string, string> = {
  LOW: Colors.priorityLow,
  MEDIUM: Colors.priorityMedium,
  HIGH: Colors.priorityHigh,
  URGENT: Colors.priorityUrgent,
};

export default function TaskCreateScreen() {
  const navigation = useNavigation<any>();
  const { createTask } = useTaskStore();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [standard, setStandard] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  const [deadline, setDeadline] = useState('');
  const [priority, setPriority] = useState('MEDIUM');
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const validate = () => {
    const e: Record<string, string> = {};
    if (!title.trim()) e.title = 'Tiêu đề là bắt buộc';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleCreate = async () => {
    if (!validate()) return;
    setLoading(true);
    try {
      await createTask({
        title: title.trim(),
        description: description.trim() || undefined,
        standard: standard.trim() || undefined,
        assigneeId: assigneeId.trim() || undefined,
        deadline: deadline ? new Date(deadline).toISOString() : undefined,
        priority,
      });
      Alert.alert('Thành công', 'Đã tạo task mới', [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    } catch (err: any) {
      Alert.alert('Lỗi', err.response?.data?.message || 'Tạo task thất bại');
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 16 }}>
      <Input
        label="Tiêu đề *"
        value={title}
        onChangeText={setTitle}
        placeholder="Nhập tiêu đề task..."
        error={errors.title}
      />

      <Input
        label="Mô tả chi tiết"
        value={description}
        onChangeText={setDescription}
        placeholder="Mô tả yêu cầu, nội dung cần làm..."
        multiline
        style={{ minHeight: 80 }}
      />

      <Input
        label="Tiêu chuẩn hoàn thành"
        value={standard}
        onChangeText={setStandard}
        placeholder="Hoàn thành khi nào được coi là đạt..."
        multiline
        style={{ minHeight: 60 }}
      />

      <Text style={styles.label}>Mức độ ưu tiên</Text>
      <View style={styles.priorityRow}>
        {PRIORITIES.map((p) => (
          <TouchableOpacity
            key={p.value}
            style={[
              styles.priorityChip,
              { borderColor: PRIORITY_COLORS[p.value] },
              priority === p.value && { backgroundColor: PRIORITY_COLORS[p.value] },
            ]}
            onPress={() => setPriority(p.value)}
          >
            <Text style={[
              styles.priorityChipText,
              { color: priority === p.value ? Colors.white : PRIORITY_COLORS[p.value] },
            ]}>
              {p.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <Input
        label="Deadline (YYYY-MM-DD HH:MM)"
        value={deadline}
        onChangeText={setDeadline}
        placeholder="2024-12-31 18:00"
        keyboardType="numbers-and-punctuation"
      />

      <Input
        label="ID người thực hiện"
        value={assigneeId}
        onChangeText={setAssigneeId}
        placeholder="UUID của nhân viên..."
      />

      <View style={styles.btnRow}>
        <Button title="Hủy" onPress={() => navigation.goBack()} variant="outline" style={styles.btn} />
        <Button title="Tạo task" onPress={handleCreate} loading={loading} style={styles.btn} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  label: { fontSize: 14, fontWeight: '600', color: Colors.text, marginBottom: 8 },
  priorityRow: { flexDirection: 'row', gap: 8, marginBottom: 14, flexWrap: 'wrap' },
  priorityChip: {
    paddingHorizontal: 16, paddingVertical: 8,
    borderRadius: 20, borderWidth: 2,
  },
  priorityChipText: { fontSize: 14, fontWeight: '700' },
  btnRow: { flexDirection: 'row', gap: 10, marginTop: 8 },
  btn: { flex: 1 },
});

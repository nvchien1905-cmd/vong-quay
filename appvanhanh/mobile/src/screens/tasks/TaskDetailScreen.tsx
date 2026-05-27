import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Alert, TextInput, Image, ActivityIndicator, Modal,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { format } from 'date-fns';
import { vi } from 'date-fns/locale';
import * as ImagePicker from 'expo-image-picker';
import { useTaskStore } from '../../store/taskStore';
import { useAuthStore } from '../../store/authStore';
import Badge from '../../components/common/Badge';
import Button from '../../components/common/Button';
import Card from '../../components/common/Card';
import { Colors, getPriorityColor, getStatusColor, PRIORITY_LABELS, STATUS_LABELS } from '../../utils/colors';
import { taskApi } from '../../api/client';

const NEXT_STATUS: Record<string, string[]> = {
  NOT_STARTED: ['IN_PROGRESS'],
  IN_PROGRESS: ['PENDING_APPROVAL'],
  PENDING_APPROVAL: ['COMPLETED', 'REJECTED'],
};

const STATUS_ACTION_LABELS: Record<string, string> = {
  IN_PROGRESS: 'Bắt đầu thực hiện',
  PENDING_APPROVAL: 'Nộp chờ duyệt',
  COMPLETED: 'Duyệt hoàn thành',
  REJECTED: 'Từ chối',
};

export default function TaskDetailScreen({ route }: any) {
  const { id } = route.params;
  const { currentTask, isLoading, fetchTask, changeStatus, addComment } = useTaskStore();
  const { user } = useAuthStore();
  const [comment, setComment] = useState('');
  const [rejectedReason, setRejectedReason] = useState('');
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => { fetchTask(id); }, [id]);

  const task = currentTask?.id === id ? currentTask : null;

  const canChangeStatus = (status: string) => {
    if (!task || !user) return false;
    if (status === 'IN_PROGRESS' || status === 'PENDING_APPROVAL') {
      return task.assignee?.id === user.id || user.role === 'STORE_MANAGER';
    }
    if (status === 'COMPLETED' || status === 'REJECTED') {
      return ['STORE_MANAGER', 'ZONE_MANAGER', 'OWNER'].includes(user.role);
    }
    return false;
  };

  const handleStatus = async (status: string) => {
    if (status === 'REJECTED') {
      setShowRejectModal(true);
      return;
    }
    try {
      await changeStatus(id, status);
      Alert.alert('Thành công', `Đã cập nhật: ${STATUS_LABELS[status]}`);
    } catch (e: any) {
      Alert.alert('Lỗi', e.response?.data?.message || 'Thất bại');
    }
  };

  const handleReject = async () => {
    if (!rejectedReason.trim()) {
      Alert.alert('Lỗi', 'Vui lòng nhập lý do từ chối');
      return;
    }
    try {
      await changeStatus(id, 'REJECTED', rejectedReason);
      setShowRejectModal(false);
      setRejectedReason('');
    } catch (e: any) {
      Alert.alert('Lỗi', e.response?.data?.message || 'Thất bại');
    }
  };

  const handleUploadPhoto = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.All,
      quality: 0.8,
    });
    if (result.canceled) return;

    const asset = result.assets[0];
    const formData = new FormData();
    formData.append('file', { uri: asset.uri, name: 'upload.jpg', type: 'image/jpeg' } as any);

    setUploading(true);
    try {
      await taskApi.uploadAttachment(id, formData);
      await fetchTask(id);
      Alert.alert('Thành công', 'Đã tải ảnh lên');
    } catch {
      Alert.alert('Lỗi', 'Tải ảnh thất bại');
    } finally {
      setUploading(false);
    }
  };

  const handleSendComment = async () => {
    if (!comment.trim()) return;
    try {
      await addComment(id, comment.trim());
      setComment('');
    } catch {
      Alert.alert('Lỗi', 'Gửi bình luận thất bại');
    }
  };

  if (isLoading && !task) {
    return <View style={styles.center}><ActivityIndicator size="large" color={Colors.primary} /></View>;
  }

  if (!task) return null;

  const nextStatuses = NEXT_STATUS[task.status] || [];

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 16 }}>
      {/* Header */}
      <Card>
        <View style={styles.badgeRow}>
          <Badge label={PRIORITY_LABELS[task.priority]} color={getPriorityColor(task.priority)} />
          <Badge label={STATUS_LABELS[task.status]} color={getStatusColor(task.status)} />
        </View>
        <Text style={styles.title}>{task.title}</Text>
        {task.description && <Text style={styles.desc}>{task.description}</Text>}
        {task.standard && (
          <View style={styles.standardBox}>
            <Text style={styles.standardLabel}>Tiêu chuẩn hoàn thành:</Text>
            <Text style={styles.standardText}>{task.standard}</Text>
          </View>
        )}
      </Card>

      {/* Info */}
      <Card>
        <InfoRow label="Người giao" value={task.creator?.name} />
        <InfoRow label="Người thực hiện" value={task.assignee?.name || 'Chưa phân công'} />
        {task.collaborators?.length > 0 && (
          <InfoRow label="Phối hợp" value={task.collaborators.map((c: any) => c.name).join(', ')} />
        )}
        {task.store && <InfoRow label="Cửa hàng" value={task.store.name} />}
        {task.deadline && (
          <InfoRow
            label="Deadline"
            value={format(new Date(task.deadline), 'dd/MM/yyyy HH:mm', { locale: vi })}
            highlight={new Date(task.deadline) < new Date() && task.status !== 'COMPLETED'}
          />
        )}
        {task.rejectedReason && <InfoRow label="Lý do từ chối" value={task.rejectedReason} highlight />}
      </Card>

      {/* Actions */}
      {nextStatuses.filter(canChangeStatus).length > 0 && (
        <Card>
          <Text style={styles.sectionTitle}>Cập nhật trạng thái</Text>
          <View style={styles.actionRow}>
            {nextStatuses.filter(canChangeStatus).map((s) => (
              <Button
                key={s}
                title={STATUS_ACTION_LABELS[s] || s}
                onPress={() => handleStatus(s)}
                variant={s === 'REJECTED' ? 'danger' : s === 'COMPLETED' ? 'primary' : 'secondary'}
                style={styles.actionBtn}
              />
            ))}
          </View>
        </Card>
      )}

      {/* Attachments */}
      <Card>
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>Minh chứng ({task.attachments?.length || 0})</Text>
          <TouchableOpacity onPress={handleUploadPhoto} disabled={uploading}>
            {uploading
              ? <ActivityIndicator size="small" color={Colors.primary} />
              : <Ionicons name="cloud-upload-outline" size={22} color={Colors.primary} />
            }
          </TouchableOpacity>
        </View>
        {task.attachments?.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {task.attachments.map((a: any) => (
              <Image key={a.id} source={{ uri: a.url }} style={styles.attachImg} />
            ))}
          </ScrollView>
        ) : (
          <Text style={styles.emptyMeta}>Chưa có minh chứng</Text>
        )}
      </Card>

      {/* History */}
      {task.logs?.length > 0 && (
        <Card>
          <Text style={styles.sectionTitle}>Lịch sử</Text>
          {task.logs.map((log: any) => (
            <View key={log.id} style={styles.logRow}>
              <Text style={styles.logAction}>{log.user?.name}: {log.action}</Text>
              {log.detail && <Text style={styles.logDetail}>{log.detail}</Text>}
              <Text style={styles.logTime}>{format(new Date(log.createdAt), 'dd/MM HH:mm')}</Text>
            </View>
          ))}
        </Card>
      )}

      {/* Comments */}
      <Card>
        <Text style={styles.sectionTitle}>Bình luận ({task.comments?.length || 0})</Text>
        {task.comments?.map((c: any) => (
          <View key={c.id} style={styles.comment}>
            <Text style={styles.commentUser}>{c.user?.name}</Text>
            <Text style={styles.commentContent}>{c.content}</Text>
            <Text style={styles.commentTime}>{format(new Date(c.createdAt), 'dd/MM HH:mm')}</Text>
          </View>
        ))}
        <View style={styles.commentInput}>
          <TextInput
            style={styles.commentBox}
            placeholder="Viết bình luận..."
            placeholderTextColor={Colors.textMuted}
            value={comment}
            onChangeText={setComment}
            multiline
          />
          <TouchableOpacity style={styles.sendBtn} onPress={handleSendComment}>
            <Ionicons name="send" size={18} color={Colors.white} />
          </TouchableOpacity>
        </View>
      </Card>

      {/* Reject Modal */}
      <Modal visible={showRejectModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>Lý do từ chối</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="Nhập lý do..."
              placeholderTextColor={Colors.textMuted}
              value={rejectedReason}
              onChangeText={setRejectedReason}
              multiline
            />
            <View style={styles.modalActions}>
              <Button title="Hủy" onPress={() => setShowRejectModal(false)} variant="outline" style={styles.modalBtn} />
              <Button title="Xác nhận" onPress={handleReject} variant="danger" style={styles.modalBtn} />
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

function InfoRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={[styles.infoValue, highlight && styles.highlightText]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  badgeRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  title: { fontSize: 18, fontWeight: '800', color: Colors.text, marginBottom: 8, lineHeight: 24 },
  desc: { fontSize: 14, color: Colors.textSecondary, lineHeight: 20 },
  standardBox: { marginTop: 10, padding: 10, backgroundColor: Colors.background, borderRadius: 8 },
  standardLabel: { fontSize: 12, color: Colors.textSecondary, fontWeight: '600' },
  standardText: { fontSize: 14, color: Colors.text, marginTop: 4 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: Colors.border },
  infoLabel: { fontSize: 13, color: Colors.textSecondary, flex: 1 },
  infoValue: { fontSize: 13, color: Colors.text, fontWeight: '600', flex: 1, textAlign: 'right' },
  highlightText: { color: Colors.error },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: Colors.text, marginBottom: 10 },
  sectionHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  actionRow: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  actionBtn: { flex: 1 },
  attachImg: { width: 90, height: 90, borderRadius: 8, marginRight: 8 },
  emptyMeta: { fontSize: 13, color: Colors.textMuted, fontStyle: 'italic' },
  logRow: { paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: Colors.border },
  logAction: { fontSize: 13, color: Colors.text, fontWeight: '600' },
  logDetail: { fontSize: 12, color: Colors.textSecondary },
  logTime: { fontSize: 11, color: Colors.textMuted, marginTop: 2 },
  comment: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: Colors.border },
  commentUser: { fontSize: 13, fontWeight: '700', color: Colors.primary },
  commentContent: { fontSize: 14, color: Colors.text, marginTop: 2, lineHeight: 18 },
  commentTime: { fontSize: 11, color: Colors.textMuted, marginTop: 3 },
  commentInput: { flexDirection: 'row', gap: 8, marginTop: 10, alignItems: 'flex-end' },
  commentBox: {
    flex: 1, borderWidth: 1.5, borderColor: Colors.border,
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8,
    fontSize: 14, color: Colors.text, maxHeight: 100,
  },
  sendBtn: { width: 40, height: 40, backgroundColor: Colors.primary, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 24 },
  modal: { backgroundColor: Colors.white, borderRadius: 16, padding: 20 },
  modalTitle: { fontSize: 17, fontWeight: '700', color: Colors.text, marginBottom: 14 },
  modalInput: {
    borderWidth: 1.5, borderColor: Colors.border, borderRadius: 10,
    padding: 12, fontSize: 14, color: Colors.text, minHeight: 80, marginBottom: 14,
  },
  modalActions: { flexDirection: 'row', gap: 10 },
  modalBtn: { flex: 1 },
});

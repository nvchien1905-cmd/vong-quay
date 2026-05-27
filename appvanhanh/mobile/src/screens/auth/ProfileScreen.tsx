import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Alert } from 'react-native';
import { useAuthStore } from '../../store/authStore';
import Input from '../../components/common/Input';
import Button from '../../components/common/Button';
import Card from '../../components/common/Card';
import { Colors } from '../../utils/colors';

const ROLE_LABELS: Record<string, string> = {
  OWNER: 'Chủ hệ thống',
  ZONE_MANAGER: 'Quản lý vùng',
  STORE_MANAGER: 'Cửa hàng trưởng',
  EMPLOYEE: 'Nhân viên',
};

export default function ProfileScreen() {
  const { user, logout, changePassword } = useAuthStore();
  const [oldPw, setOldPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [loading, setLoading] = useState(false);

  const handleChangePassword = async () => {
    if (!oldPw || !newPw || !confirmPw) {
      Alert.alert('Lỗi', 'Vui lòng điền đầy đủ thông tin');
      return;
    }
    if (newPw !== confirmPw) {
      Alert.alert('Lỗi', 'Mật khẩu mới không khớp');
      return;
    }
    if (newPw.length < 6) {
      Alert.alert('Lỗi', 'Mật khẩu mới phải có ít nhất 6 ký tự');
      return;
    }

    setLoading(true);
    try {
      await changePassword(oldPw, newPw);
      Alert.alert('Thành công', 'Đổi mật khẩu thành công');
      setOldPw(''); setNewPw(''); setConfirmPw('');
    } catch (err: any) {
      Alert.alert('Thất bại', err.response?.data?.message || 'Có lỗi xảy ra');
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 16 }}>
      <Card>
        <Text style={styles.sectionTitle}>Thông tin tài khoản</Text>
        <InfoRow label="Họ tên" value={user?.name || ''} />
        <InfoRow label="Email" value={user?.email || ''} />
        <InfoRow label="Vai trò" value={ROLE_LABELS[user?.role || ''] || user?.role || ''} />
        {user?.store && <InfoRow label="Cửa hàng" value={user.store.name} />}
        {user?.zone && <InfoRow label="Vùng" value={user.zone.name} />}
      </Card>

      <Card>
        <Text style={styles.sectionTitle}>Đổi mật khẩu</Text>
        <Input label="Mật khẩu hiện tại" value={oldPw} onChangeText={setOldPw} secureTextEntry placeholder="••••••" />
        <Input label="Mật khẩu mới" value={newPw} onChangeText={setNewPw} secureTextEntry placeholder="••••••" />
        <Input label="Xác nhận mật khẩu mới" value={confirmPw} onChangeText={setConfirmPw} secureTextEntry placeholder="••••••" />
        <Button title="Đổi mật khẩu" onPress={handleChangePassword} loading={loading} />
      </Card>

      <Button
        title="Đăng xuất"
        onPress={() => Alert.alert('Đăng xuất', 'Bạn có chắc muốn đăng xuất?', [
          { text: 'Hủy', style: 'cancel' },
          { text: 'Đăng xuất', style: 'destructive', onPress: logout },
        ])}
        variant="danger"
      />
    </ScrollView>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: Colors.text, marginBottom: 14 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: Colors.border },
  rowLabel: { fontSize: 14, color: Colors.textSecondary },
  rowValue: { fontSize: 14, fontWeight: '600', color: Colors.text },
});

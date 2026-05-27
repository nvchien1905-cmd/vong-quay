export const Colors = {
  primary: '#0A2463',
  primaryLight: '#1E3A8A',
  accent: '#FF6B35',
  accentLight: '#FF8C5A',
  white: '#FFFFFF',
  background: '#F8FAFC',
  surface: '#FFFFFF',
  border: '#E2E8F0',
  text: '#1A202C',
  textSecondary: '#718096',
  textMuted: '#A0AEC0',
  success: '#38A169',
  warning: '#D69E2E',
  error: '#E53E3E',
  overdue: '#FED7D7',
  overdueText: '#C53030',

  priorityLow: '#68D391',
  priorityMedium: '#F6AD55',
  priorityHigh: '#FC8181',
  priorityUrgent: '#E53E3E',

  statusNotStarted: '#CBD5E0',
  statusInProgress: '#63B3ED',
  statusPending: '#F6AD55',
  statusCompleted: '#68D391',
  statusOverdue: '#FC8181',
  statusRejected: '#E53E3E',
};

export const getPriorityColor = (priority: string) => {
  const map: Record<string, string> = {
    LOW: Colors.priorityLow,
    MEDIUM: Colors.priorityMedium,
    HIGH: Colors.priorityHigh,
    URGENT: Colors.priorityUrgent,
  };
  return map[priority] || Colors.priorityMedium;
};

export const getStatusColor = (status: string) => {
  const map: Record<string, string> = {
    NOT_STARTED: Colors.statusNotStarted,
    IN_PROGRESS: Colors.statusInProgress,
    PENDING_APPROVAL: Colors.statusPending,
    COMPLETED: Colors.statusCompleted,
    OVERDUE: Colors.statusOverdue,
    REJECTED: Colors.statusRejected,
  };
  return map[status] || Colors.textMuted;
};

export const PRIORITY_LABELS: Record<string, string> = {
  LOW: 'Thấp',
  MEDIUM: 'Trung bình',
  HIGH: 'Cao',
  URGENT: 'Khẩn',
};

export const STATUS_LABELS: Record<string, string> = {
  NOT_STARTED: 'Chưa bắt đầu',
  IN_PROGRESS: 'Đang thực hiện',
  PENDING_APPROVAL: 'Chờ duyệt',
  COMPLETED: 'Hoàn thành',
  OVERDUE: 'Quá hạn',
  REJECTED: 'Bị từ chối',
};

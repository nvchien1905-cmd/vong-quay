import React, { useEffect, useState } from 'react';
import client from '../api/client';

const StatCard = ({ label, value, color, icon }) => (
  <div className="bg-white rounded-xl border p-5 flex items-center gap-4">
    <div className={`w-12 h-12 rounded-lg flex items-center justify-center text-2xl ${color}`}>{icon}</div>
    <div>
      <p className="text-2xl font-bold text-gray-800">{value ?? '—'}</p>
      <p className="text-sm text-gray-500">{label}</p>
    </div>
  </div>
);

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    client.get('/dashboard')
      .then(({ data }) => setStats(data.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" /></div>;

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold text-gray-800">Tổng quan hôm nay</h2>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Tổng task" value={stats?.totalTasks} color="bg-blue-50" icon="📋" />
        <StatCard label="Đang thực hiện" value={stats?.inProgress} color="bg-yellow-50" icon="⚡" />
        <StatCard label="Hoàn thành" value={stats?.completed} color="bg-green-50" icon="✅" />
        <StatCard label="Quá hạn" value={stats?.overdue} color="bg-red-50" icon="⚠️" />
      </div>

      {stats?.overdueList?.length > 0 && (
        <div className="bg-white rounded-xl border p-5">
          <h3 className="font-semibold text-gray-700 mb-3">Task quá hạn cần xử lý</h3>
          <div className="space-y-2">
            {stats.overdueList.slice(0, 5).map((t) => (
              <div key={t.id} className="flex items-center justify-between py-2 border-b last:border-0">
                <div>
                  <p className="text-sm font-medium text-gray-800">{t.title}</p>
                  <p className="text-xs text-gray-400">{t.assignee?.name || 'Chưa giao'} · {t.store?.name}</p>
                </div>
                <span className="text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded-full">{t.priority}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {stats?.busyEmployees?.length > 0 && (
        <div className="bg-white rounded-xl border p-5">
          <h3 className="font-semibold text-gray-700 mb-3">Nhân viên tồn đọng nhiều task</h3>
          <div className="space-y-2">
            {stats.busyEmployees.slice(0, 5).map((e) => (
              <div key={e.id} className="flex items-center justify-between py-2 border-b last:border-0">
                <div className="flex items-center gap-2">
                  {e.avatar
                    ? <img src={e.avatar} className="w-7 h-7 rounded-full" alt="" />
                    : <div className="w-7 h-7 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 text-xs font-medium">{e.name?.[0]}</div>
                  }
                  <p className="text-sm text-gray-800">{e.name}</p>
                </div>
                <span className="text-sm font-bold text-orange-500">{e._count?.assignedTasks} task</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

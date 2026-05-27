import React, { useEffect, useState } from 'react';
import client from '../api/client';
import { format } from 'date-fns';

const STATUS_LABEL = { NOT_STARTED: 'Chưa bắt đầu', IN_PROGRESS: 'Đang làm', PENDING_APPROVAL: 'Chờ duyệt', COMPLETED: 'Hoàn thành', OVERDUE: 'Quá hạn', REJECTED: 'Từ chối' };
const STATUS_COLOR = { NOT_STARTED: 'bg-gray-100 text-gray-600', IN_PROGRESS: 'bg-blue-100 text-blue-600', PENDING_APPROVAL: 'bg-yellow-100 text-yellow-600', COMPLETED: 'bg-green-100 text-green-600', OVERDUE: 'bg-red-100 text-red-600', REJECTED: 'bg-red-100 text-red-600' };
const PRIORITY_COLOR = { LOW: 'text-gray-400', MEDIUM: 'text-blue-500', HIGH: 'text-orange-500', URGENT: 'text-red-500' };

export default function Tasks() {
  const [tasks, setTasks] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    client.get('/tasks', { params: { page, limit: 20, status: status || undefined } })
      .then(({ data }) => { setTasks(data.data.tasks); setTotal(data.data.total); })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [page, status]);

  const totalPages = Math.ceil(total / 20);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-gray-800">Giao việc ({total})</h2>
        <select
          value={status}
          onChange={(e) => { setStatus(e.target.value); setPage(1); }}
          className="border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">Tất cả trạng thái</option>
          {Object.entries(STATUS_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>

      <div className="bg-white rounded-xl border overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-16"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" /></div>
        ) : tasks.length === 0 ? (
          <p className="text-center text-gray-400 py-16">Không có task nào</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                {['Tiêu đề', 'Người nhận', 'Cửa hàng', 'Ưu tiên', 'Trạng thái', 'Deadline'].map((h) => (
                  <th key={h} className="text-left px-4 py-3 text-gray-500 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {tasks.map((t) => (
                <tr key={t.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-800 line-clamp-1">{t.title}</p>
                    {t.description && <p className="text-xs text-gray-400 line-clamp-1">{t.description}</p>}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{t.assignee?.name || <span className="text-gray-300">—</span>}</td>
                  <td className="px-4 py-3 text-gray-600">{t.store?.name || <span className="text-gray-300">—</span>}</td>
                  <td className="px-4 py-3">
                    <span className={`font-semibold ${PRIORITY_COLOR[t.priority]}`}>{t.priority}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLOR[t.status]}`}>{STATUS_LABEL[t.status]}</span>
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs">
                    {t.deadline ? format(new Date(t.deadline), 'dd/MM/yyyy HH:mm') : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex justify-center gap-2">
          {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
            <button
              key={p} onClick={() => setPage(p)}
              className={`w-8 h-8 rounded-lg text-sm ${p === page ? 'bg-blue-600 text-white' : 'bg-white border text-gray-600 hover:bg-gray-50'}`}
            >{p}</button>
          ))}
        </div>
      )}
    </div>
  );
}

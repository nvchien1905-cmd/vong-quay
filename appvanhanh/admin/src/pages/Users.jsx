import React, { useEffect, useState } from 'react';
import client from '../api/client';

const ROLE_LABEL = { OWNER: 'Chủ hệ thống', ZONE_MANAGER: 'QL Vùng', STORE_MANAGER: 'CH Trưởng', EMPLOYEE: 'Nhân viên' };
const ROLE_COLOR = { OWNER: 'bg-purple-100 text-purple-600', ZONE_MANAGER: 'bg-blue-100 text-blue-600', STORE_MANAGER: 'bg-teal-100 text-teal-600', EMPLOYEE: 'bg-gray-100 text-gray-600' };

export default function Users() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    client.get('/dashboard/users').then(({ data }) => setUsers(data.data)).catch(() => {}).finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold text-gray-800">Nhân sự ({users.length})</h2>
      <div className="bg-white rounded-xl border overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-16"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" /></div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                {['Nhân viên', 'Email', 'Vai trò', 'Cửa hàng', 'Trạng thái'].map((h) => (
                  <th key={h} className="text-left px-4 py-3 text-gray-500 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {users.map((u) => (
                <tr key={u.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {u.avatar
                        ? <img src={u.avatar} className="w-8 h-8 rounded-full object-cover" alt="" />
                        : <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-medium text-sm">{u.name?.[0]}</div>
                      }
                      <span className="font-medium text-gray-800">{u.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{u.email}</td>
                  <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${ROLE_COLOR[u.role]}`}>{ROLE_LABEL[u.role]}</span></td>
                  <td className="px-4 py-3 text-gray-600">{u.store?.name || '—'}</td>
                  <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${u.isActive ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-500'}`}>{u.isActive ? 'Hoạt động' : 'Vô hiệu'}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

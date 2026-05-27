import React, { useEffect, useState } from 'react';
import client from '../api/client';

export default function Stores() {
  const [stores, setStores] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    client.get('/dashboard/stores').then(({ data }) => setStores(data.data)).catch(() => {}).finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold text-gray-800">Cửa hàng ({stores.length})</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {loading ? (
          <div className="col-span-3 flex justify-center py-16"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" /></div>
        ) : stores.length === 0 ? (
          <p className="col-span-3 text-center text-gray-400 py-16">Chưa có cửa hàng nào</p>
        ) : stores.map((s) => (
          <div key={s.id} className="bg-white rounded-xl border p-5 space-y-2">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="font-semibold text-gray-800">{s.name}</h3>
                {s.zone && <p className="text-xs text-blue-500 mt-0.5">Vùng: {s.zone.name}</p>}
              </div>
              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${s.isActive ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-500'}`}>{s.isActive ? 'Hoạt động' : 'Đóng'}</span>
            </div>
            {s.address && <p className="text-sm text-gray-500">📍 {s.address}</p>}
            {s.phone && <p className="text-sm text-gray-500">📞 {s.phone}</p>}
            <div className="flex gap-3 pt-1 text-xs text-gray-400">
              <span>👥 {s._count?.users || 0} nhân viên</span>
              <span>📋 {s._count?.tasks || 0} task</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

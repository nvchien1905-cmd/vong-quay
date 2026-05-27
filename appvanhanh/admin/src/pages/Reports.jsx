import React, { useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer, Legend } from 'recharts';
import client from '../api/client';

export default function Reports() {
  const [data, setData] = useState(null);
  const [year, setYear] = useState(new Date().getFullYear());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    client.get('/reports', { params: { year } })
      .then(({ data }) => setData(data.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [year]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-gray-800">Báo cáo thống kê</h2>
        <select value={year} onChange={(e) => setYear(Number(e.target.value))} className="border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
          {[2024, 2025, 2026].map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" /></div>
      ) : !data ? (
        <p className="text-center text-gray-400 py-16">Không có dữ liệu</p>
      ) : (
        <div className="space-y-6">
          <div className="bg-white rounded-xl border p-5">
            <h3 className="font-semibold text-gray-700 mb-4">Task theo tháng — {year}</h3>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={data.monthly}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" tickFormatter={(v) => `T${v}`} />
                <YAxis />
                <Tooltip labelFormatter={(v) => `Tháng ${v}`} />
                <Legend />
                <Bar dataKey="completed" name="Hoàn thành" fill="#22c55e" radius={[4,4,0,0]} />
                <Bar dataKey="overdue" name="Quá hạn" fill="#ef4444" radius={[4,4,0,0]} />
                <Bar dataKey="total" name="Tổng" fill="#3b82f6" radius={[4,4,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {data.storeStats?.length > 0 && (
            <div className="bg-white rounded-xl border p-5">
              <h3 className="font-semibold text-gray-700 mb-4">So sánh cửa hàng</h3>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={data.storeStats}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="completed" name="Hoàn thành" fill="#22c55e" radius={[4,4,0,0]} />
                  <Bar dataKey="total" name="Tổng" fill="#3b82f6" radius={[4,4,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

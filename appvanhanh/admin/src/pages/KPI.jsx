import React, { useEffect, useState } from 'react';
import client from '../api/client';

export default function KPI() {
  const [employeeRanking, setEmployeeRanking] = useState([]);
  const [storeRanking, setStoreRanking] = useState([]);
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [year, setYear] = useState(new Date().getFullYear());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      client.get('/kpi/employees', { params: { month, year } }),
      client.get('/kpi/stores', { params: { month, year } }),
    ]).then(([emp, store]) => {
      setEmployeeRanking(emp.data.data.ranking);
      setStoreRanking(store.data.data.ranking);
    }).catch(() => {}).finally(() => setLoading(false));
  }, [month, year]);

  const months = Array.from({ length: 12 }, (_, i) => i + 1);
  const years = [2024, 2025, 2026];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-gray-800">Bảng xếp hạng KPI</h2>
        <div className="flex gap-2">
          <select value={month} onChange={(e) => setMonth(Number(e.target.value))} className="border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            {months.map((m) => <option key={m} value={m}>Tháng {m}</option>)}
          </select>
          <select value={year} onChange={(e) => setYear(Number(e.target.value))} className="border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" /></div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white rounded-xl border p-5">
            <h3 className="font-semibold text-gray-700 mb-4">🏆 Nhân viên xuất sắc</h3>
            <div className="space-y-2">
              {employeeRanking.length === 0 && <p className="text-gray-400 text-sm">Chưa có dữ liệu</p>}
              {employeeRanking.slice(0, 10).map((r, i) => (
                <div key={r.userId} className="flex items-center justify-between py-2 border-b last:border-0">
                  <div className="flex items-center gap-3">
                    <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${i < 3 ? 'bg-yellow-100 text-yellow-600' : 'bg-gray-100 text-gray-500'}`}>{i + 1}</span>
                    <div className="flex items-center gap-2">
                      {r.user?.avatar
                        ? <img src={r.user.avatar} className="w-7 h-7 rounded-full" alt="" />
                        : <div className="w-7 h-7 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 text-xs font-medium">{r.user?.name?.[0]}</div>
                      }
                      <p className="text-sm text-gray-800">{r.user?.name}</p>
                    </div>
                  </div>
                  <span className={`font-bold text-sm ${r.total >= 0 ? 'text-green-600' : 'text-red-500'}`}>{r.total >= 0 ? '+' : ''}{r.total} điểm</span>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-xl border p-5">
            <h3 className="font-semibold text-gray-700 mb-4">🏪 Cửa hàng xuất sắc</h3>
            <div className="space-y-2">
              {storeRanking.length === 0 && <p className="text-gray-400 text-sm">Chưa có dữ liệu</p>}
              {storeRanking.slice(0, 10).map((r, i) => (
                <div key={r.store?.id || i} className="flex items-center justify-between py-2 border-b last:border-0">
                  <div className="flex items-center gap-3">
                    <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${i < 3 ? 'bg-yellow-100 text-yellow-600' : 'bg-gray-100 text-gray-500'}`}>{i + 1}</span>
                    <p className="text-sm text-gray-800">{r.store?.name || 'Không xác định'}</p>
                  </div>
                  <span className={`font-bold text-sm ${r.total >= 0 ? 'text-green-600' : 'text-red-500'}`}>{r.total >= 0 ? '+' : ''}{r.total} điểm</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

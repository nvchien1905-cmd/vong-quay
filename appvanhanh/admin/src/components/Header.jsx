import React from 'react';
import useAuth from '../store/auth';

const roleLabel = { OWNER: 'Chủ hệ thống', ZONE_MANAGER: 'Quản lý vùng', STORE_MANAGER: 'Cửa hàng trưởng', EMPLOYEE: 'Nhân viên' };

export default function Header() {
  const { user, logout } = useAuth();

  return (
    <header className="bg-white border-b px-6 py-3 flex items-center justify-between">
      <div />
      <div className="flex items-center gap-3">
        <div className="text-right">
          <p className="text-sm font-medium text-gray-800">{user?.name}</p>
          <p className="text-xs text-gray-500">{roleLabel[user?.role]}</p>
        </div>
        {user?.avatar
          ? <img src={user.avatar} className="w-8 h-8 rounded-full object-cover" alt="" />
          : <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-medium text-sm">{user?.name?.[0]}</div>
        }
        <button onClick={logout} className="text-xs text-gray-400 hover:text-red-500 transition-colors">Đăng xuất</button>
      </div>
    </header>
  );
}

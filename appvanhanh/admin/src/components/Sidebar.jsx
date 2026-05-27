import React from 'react';
import { NavLink } from 'react-router-dom';
import useAuth from '../store/auth';

const navItems = [
  { to: '/', label: 'Dashboard', icon: '📊', exact: true },
  { to: '/tasks', label: 'Giao việc', icon: '✅' },
  { to: '/kpi', label: 'KPI', icon: '🏆' },
  { to: '/reports', label: 'Báo cáo', icon: '📈' },
  { to: '/stores', label: 'Cửa hàng', icon: '🏪', roles: ['OWNER', 'ZONE_MANAGER'] },
  { to: '/users', label: 'Nhân sự', icon: '👥', roles: ['OWNER', 'ZONE_MANAGER'] },
];

export default function Sidebar() {
  const { user } = useAuth();

  return (
    <aside className="w-56 bg-white border-r flex flex-col">
      <div className="p-4 border-b">
        <h1 className="font-bold text-blue-600 text-lg">Retail Ops</h1>
        <p className="text-xs text-gray-500 mt-0.5">Quản lý vận hành</p>
      </div>
      <nav className="flex-1 p-3 space-y-1">
        {navItems.map(({ to, label, icon, exact, roles }) => {
          if (roles && !roles.includes(user?.role)) return null;
          return (
            <NavLink
              key={to}
              to={to}
              end={exact}
              className={({ isActive }) =>
                `flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${
                  isActive ? 'bg-blue-50 text-blue-600 font-medium' : 'text-gray-600 hover:bg-gray-100'
                }`
              }
            >
              <span>{icon}</span>
              {label}
            </NavLink>
          );
        })}
      </nav>
    </aside>
  );
}

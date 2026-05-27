# Retail Ops Manager — appvanhanh

Hệ thống quản lý giao việc và vận hành nội bộ cho chuỗi cửa hàng bán lẻ.

## Cấu trúc

```
C:/Users/Admin/appvanhanh/
├── backend/    # Node.js + Express + Prisma + PostgreSQL + Socket.IO
└── mobile/     # React Native (Expo)
```

## Khởi động

```bash
# Backend (port 3000)
cd C:/Users/Admin/appvanhanh/backend
node index.js

# Mobile (Metro Bundler port 8081)
cd C:/Users/Admin/appvanhanh/mobile
npx expo start
```

Health check backend: `curl http://localhost:3000/health`

## Cấu hình

- Backend env: `C:/Users/Admin/appvanhanh/backend/.env`
- Database: PostgreSQL `retail_ops` tại localhost:5432
- CLIENT_URL: `http://localhost:8081`

## Tài khoản mẫu

| Role | Email | Mật khẩu |
|------|-------|-----------|
| Chủ hệ thống | owner@retail.vn | 123456 |
| Quản lý vùng | zone@retail.vn | 123456 |
| Cửa hàng trưởng | manager@retail.vn | 123456 |
| Nhân viên | employee@retail.vn | 123456 |

## API Modules

`/api/auth` `/api/tasks` `/api/checklists` `/api/kpi` `/api/dashboard` `/api/reports` `/api/sop`

## Tech Stack

- **Backend**: Express, Prisma, PostgreSQL, Socket.IO, JWT, Cloudinary
- **Mobile**: React Native, Expo 52, Zustand, Axios, React Navigation

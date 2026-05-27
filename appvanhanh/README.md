# Retail Ops Manager

Hệ thống quản lý giao việc và vận hành nội bộ cho chuỗi cửa hàng bán lẻ.

## Cấu trúc dự án

```
retail-ops-manager/
├── backend/                     # Node.js + Express API
│   ├── prisma/
│   │   ├── schema.prisma        # Database schema (PostgreSQL)
│   │   └── seed.js              # Dữ liệu mẫu
│   ├── src/
│   │   ├── config/index.js
│   │   ├── middleware/
│   │   │   ├── auth.js          # JWT middleware
│   │   │   └── roleGuard.js     # Phân quyền theo role
│   │   ├── controllers/         # Logic xử lý 8 module
│   │   ├── routes/              # API routes
│   │   ├── services/
│   │   │   ├── kpiService.js    # Tính điểm KPI tự động
│   │   │   └── cloudinaryService.js
│   │   └── socket/index.js      # Socket.IO realtime
│   └── index.js                 # Entry point
└── mobile/                      # React Native (Expo)
    ├── src/
    │   ├── api/client.ts        # Axios + auto refresh token
    │   ├── store/               # Zustand state management
    │   ├── navigation/index.tsx # Stack + Bottom tabs
    │   ├── components/
    │   │   ├── common/          # Badge, Button, Input, Card
    │   │   └── task/            # TaskCard
    │   ├── screens/
    │   │   ├── auth/            # Login, Profile
    │   │   ├── dashboard/       # Tổng quan, cảnh báo
    │   │   ├── tasks/           # List, Detail, Create
    │   │   ├── checklist/       # Mẫu, phiên ca
    │   │   ├── kpi/             # Điểm, BXH
    │   │   ├── reports/         # Biểu đồ, thống kê
    │   │   └── sop/             # Tài liệu, quiz
    │   └── utils/
    │       ├── colors.ts        # Theme màu sắc
    │       └── storage.ts       # AsyncStorage
    └── App.tsx
```

## Cài đặt & Chạy

### Backend

```bash
cd backend
npm install
cp .env.example .env          # Điền thông tin DB, JWT, Cloudinary
npx prisma migrate dev        # Tạo database
npm run db:seed               # Dữ liệu mẫu
npm run dev                   # Chạy development
```

### Mobile

```bash
cd mobile
npm install
npx expo start               # Quét QR bằng Expo Go
```

## Tài khoản mẫu (sau khi seed)

| Role | Email | Mật khẩu |
|------|-------|-----------|
| Chủ hệ thống | owner@retail.vn | 123456 |
| Quản lý vùng | zone@retail.vn | 123456 |
| Cửa hàng trưởng | manager@retail.vn | 123456 |
| Nhân viên | employee@retail.vn | 123456 |

## API Endpoints

| Module | Base URL |
|--------|----------|
| Auth | `/api/auth` |
| Tasks | `/api/tasks` |
| Checklist | `/api/checklists` |
| KPI | `/api/kpi` |
| Dashboard | `/api/dashboard` |
| Reports | `/api/reports` |
| SOP | `/api/sop` |

## 8 Module đã xây dựng

1. **Auth & Phân quyền** — JWT + refresh token, 4 cấp role
2. **Giao việc** — CRUD task, deadline, ưu tiên, audit log, upload minh chứng
3. **Checklist ca** — Mở/đóng ca, vệ sinh, kiểm kho... với ảnh minh chứng
4. **KPI tự động** — Chấm điểm khi hoàn thành/trễ/bị từ chối
5. **Dashboard** — Stats ngày, task quá hạn, nhân viên tồn đọng
6. **Báo cáo** — Lọc ngày/tháng, biểu đồ bar chart
7. **Chat/bình luận** — Comment trong task, @mention, Socket.IO realtime
8. **SOP & Đào tạo** — Upload PDF/video, quiz trắc nghiệm, theo dõi tiến độ

## Tech Stack

- **Backend**: Node.js, Express, Prisma, PostgreSQL, Socket.IO, JWT, Cloudinary
- **Mobile**: React Native, Expo, Zustand, Axios, React Navigation

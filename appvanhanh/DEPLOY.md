# Hướng dẫn Deploy — Retail Ops Manager

## 1. Supabase (Database)

1. Vào https://supabase.com → **New project**
2. Điền tên, mật khẩu, chọn vùng Singapore
3. Vào **Settings → Database → Connection string → URI**
4. Copy chuỗi, thay `[YOUR-PASSWORD]` → đây là `DATABASE_URL`

## 2. Cloudinary (Ảnh/Video minh chứng)

1. Vào https://cloudinary.com → tạo tài khoản miễn phí
2. Dashboard → copy **Cloud Name, API Key, API Secret**
3. Điền vào `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_CLOUD_API_KEY`, `CLOUDINARY_API_SECRET`

## 3. Firebase FCM (Push notification)

1. Vào https://console.firebase.google.com → **New project**
2. **Project settings → Service accounts → Generate new private key**
3. Download file JSON, stringify thành 1 dòng:
   ```bash
   node -e "console.log(JSON.stringify(require('./serviceAccountKey.json')))"
   ```
4. Paste kết quả vào `FIREBASE_SERVICE_ACCOUNT`
5. Trong mobile app: cài `expo-notifications`, đăng ký FCM token và gọi `PUT /api/auth/fcm-token`

## 4. Upstash Redis (Cache — tùy chọn)

1. Vào https://upstash.com → tạo database Redis miễn phí
2. Copy **REST URL** và **REST Token**
3. Điền vào `UPSTASH_REDIS_REST_URL` và `UPSTASH_REDIS_REST_TOKEN`
   > Nếu bỏ trống, hệ thống vẫn chạy bình thường, chỉ không có cache

## 5. Deploy Backend

### Cách A — Railway (Khuyến nghị, hỗ trợ Socket.IO)

1. Vào https://railway.app → **New project → Deploy from GitHub**
2. Chọn repo, chọn thư mục `backend/`
3. **Variables** → thêm tất cả env vars từ `.env`
4. Railway tự build Dockerfile và deploy
5. Lấy URL deploy → đây là `API_BASE_URL`

### Cách B — Render

1. Vào https://render.com → **New Web Service**
2. Kết nối GitHub, chọn repo, **Root directory: `backend`**
3. Build command: `npm install && npx prisma generate`
4. Start command: `npx prisma migrate deploy && node index.js`
5. Thêm env vars
6. Free tier có thể bị sleep sau 15 phút không dùng

### Cách C — Docker (VPS/Server riêng)

```bash
cd backend
docker build -t retail-ops-backend .
docker run -d -p 3000:3000 \
  -e DATABASE_URL="..." \
  -e JWT_SECRET="..." \
  # ... các env khác
  retail-ops-backend
```

> **Lưu ý về Cloudflare Workers:** Backend dùng Express + Socket.IO + Prisma không chạy trực tiếp trên CF Workers (CF Workers không hỗ trợ persistent WebSocket connections). Dùng Railway/Render cho backend; dùng Cloudflare Pages cho Web Admin.

## 6. Deploy Web Admin (Cloudflare Pages)

```bash
cd admin
npm install
npm run build   # output: dist/
```

1. Vào https://dash.cloudflare.com → **Pages → New project**
2. Kết nối GitHub hoặc upload thư mục `dist/`
3. Build settings:
   - Framework preset: **Vite**
   - Build command: `npm run build`
   - Build output: `dist`
4. Thêm biến môi trường `VITE_API_URL` = URL backend từ bước 5

## 7. Cập nhật CORS Backend

Sau khi có URL thật, update `CLIENT_URL` trong `.env`:
```
CLIENT_URL=https://your-admin.pages.dev,exp://your-expo-url
```

## 8. Build APK Android

```bash
# Cài EAS CLI
npm install -g eas-cli
eas login

cd mobile

# Cập nhật API_URL trong src/api/client.ts → baseURL của backend

# Build APK
eas build --platform android --profile preview
```

- EAS sẽ upload lên Expo servers và build cloud
- Sau ~15 phút nhận link tải APK
- Nhân viên tải APK → cài đặt → dùng được ngay

## 9. Tài khoản mẫu (sau seed)

```bash
cd backend
npm run db:seed
```

| Role | Email | Mật khẩu |
|------|-------|-----------|
| Chủ hệ thống | owner@retail.vn | 123456 |
| Quản lý vùng | zone@retail.vn | 123456 |
| Cửa hàng trưởng | manager@retail.vn | 123456 |
| Nhân viên | employee@retail.vn | 123456 |

## 10. Test end-to-end

1. Đăng nhập Web Admin bằng `owner@retail.vn`
2. Xem Dashboard → tổng quan task
3. Vào Giao việc → tạo task mới, giao cho nhân viên
4. Nhân viên mở Expo Go → nhận push notification (nếu đã setup FCM)
5. Nhân viên hoàn thành task → KPI tự động cộng điểm
6. Mỗi đêm 23:59 → cron job tự phạt task quá hạn

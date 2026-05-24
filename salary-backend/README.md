# Hệ Thống Tính Lương Tự Động
## Tổng Kho Gia Dụng Huyền Anh

Backend Node.js tính lương tự động, tích hợp KiotViet API để lấy dữ liệu chấm công và doanh thu.

---

## Cài đặt nhanh

```bash
npm install
cp .env.example .env
# Điền thông tin KiotViet vào .env
npm run dev
```

---

## Cấu hình `.env`

| Biến | Mô tả |
|------|-------|
| `PORT` | Cổng server (mặc định: 3000) |
| `KIOTVIET_CLIENT_ID` | Client ID từ KiotViet Developer Portal |
| `KIOTVIET_CLIENT_SECRET` | Client Secret từ KiotViet Developer Portal |
| `KIOTVIET_RETAILER_CODE` | Mã cửa hàng (subdomain KiotViet) |
| `CORS_ORIGIN` | Domain frontend được phép, phân cách bằng dấu phẩy |

---

## API Endpoints

### Health Check

```
GET /health
```

### KiotViet

| Method | Endpoint | Mô tả |
|--------|----------|-------|
| `GET` | `/api/kiotviet/status` | Trạng thái kết nối và cache |
| `GET` | `/api/kiotviet/salary-data?year=2024&month=5` | Lấy dữ liệu NV + chấm công + doanh thu từ KiotViet |
| `POST` | `/api/kiotviet/clear-cache` | Xóa cache (buộc lấy dữ liệu mới) |

### Tính lương

#### `POST /api/salary/calculate` — Tính lương 1 nhân viên

```json
{
  "employee": {
    "name": "Nguyễn Văn A",
    "position": "NV",
    "isProbation": false,
    "seniorityMonths": 24,
    "dependents": 1
  },
  "input": {
    "actualHours": 260,
    "actualShifts": 28,
    "hasReplacement": true,
    "teamBonusShare": 500000
  }
}
```

**Trường `position`:** `CHT` (cửa hàng trưởng) | `CHP` (cửa hàng phó) | `NV` (nhân viên)

#### `POST /api/salary/payroll-from-kiotviet` — Tính bảng lương toàn shop

```json
{
  "year": 2024,
  "month": 5,
  "targetRevenue": 500000000,
  "employeeSettings": [
    {
      "employeeId": "KV001",
      "position": "NV",
      "isProbation": false,
      "seniorityMonths": 12,
      "dependents": 1,
      "hasReplacement": true
    }
  ]
}
```

Endpoint này tự động:
1. Lấy danh sách nhân viên từ KiotViet
2. Tổng hợp giờ làm từ bảng chấm công
3. Tính tổng doanh thu thực tế
4. Tính quỹ thưởng tập thể
5. Tính lương + các khoản cho từng người

---

## Quy tắc tính lương

### Phân loại Full-time / Part-time
- **FT (Full-time):** ≥ 235 giờ/tháng → lương cứng **7.000.000đ**
- **PT (Part-time):** < 235 giờ/tháng → lương cứng **4.000.000đ**

### Hệ số giờ
```
hệ số = giờ thực / giờ chuẩn   (tối đa 1.2)
giờ chuẩn FT = 252h  |  giờ chuẩn PT = 135h
lương điều chỉnh = lương cứng × hệ số giờ
```

### Trạng thái nhân viên
- **Chính thức:** lương cứng 100%
- **Thử việc:** lương cứng × 85% — không có phụ cấp FT

### Phụ cấp cố định
| Loại | Mức |
|------|-----|
| Phụ cấp FT (NV chính thức) | 560.000đ |
| Phụ cấp Cửa hàng phó (CHP) | 1.000.000đ |
| Phụ cấp Cửa hàng trưởng (CHT) | 1.500.000đ |

### Thưởng chuyên cần
Điều kiện: đủ **28 công** VÀ **có người thay ca**.
- FT: **500.000đ**  |  PT: **300.000đ**

### Thưởng thâm niên
- FT: **100.000đ** / năm  |  PT: **50.000đ** / năm
- Tính theo tháng tròn: `floor(tháng / 12) × mức`

### Quỹ thưởng tập thể
Chỉ phát sinh khi **doanh thu ≥ 100% mục tiêu**:
```
quỹ = 2.000.000 + 0,5% × mục tiêu + 1% × (thực tế − mục tiêu)
```

Chia theo hệ số có trọng số:
| Vị trí | Hệ số |
|--------|-------|
| CHT | 1.70 |
| CHP | 1.25 |
| NV chính thức FT | 1.00 |
| NV chính thức PT | 0.60 |
| NVTV FT | 0.50 |
| NVTV PT | 0.30 |

```
phần thưởng NV = (hệ số vị trí × hệ số giờ) / tổng hệ số toàn shop × quỹ
```

### Bảo hiểm (nhân viên đóng)
| Loại | Tỷ lệ |
|------|-------|
| BHXH | 8% |
| BHYT | 1.5% |
| BHTN | 1% |
| **Tổng** | **10.5%** |

Trần đóng bảo hiểm: **46.800.000đ** (tính trên lương hợp đồng).

### Thuế TNCN lũy tiến 7 bậc
Giảm trừ trước thuế: **11.000.000đ** (bản thân) + **4.400.000đ** × số người phụ thuộc

| Bậc | Thu nhập chịu thuế | Thuế suất |
|-----|--------------------|-----------|
| 1 | Đến 5 triệu | 5% |
| 2 | 5 – 10 triệu | 10% |
| 3 | 10 – 18 triệu | 15% |
| 4 | 18 – 32 triệu | 20% |
| 5 | 32 – 52 triệu | 25% |
| 6 | 52 – 80 triệu | 30% |
| 7 | Trên 80 triệu | 35% |

---

## Chạy test

```bash
npm test
```

43 test cases, không cần KiotViet thật. Bao gồm:
- Phân loại FT/PT, hệ số giờ
- Tính bảo hiểm, thuế TNCN 7 bậc
- Tất cả trường hợp phụ cấp và thưởng
- Tính bảng lương toàn shop với dữ liệu mock
- Tất cả HTTP API endpoints

---

## Bảo mật

- **Helmet:** bảo vệ HTTP headers
- **CORS:** chỉ cho phép domain cấu hình trong `CORS_ORIGIN`
- **Rate limit:** 100 req/phút toàn app, 20 req/phút riêng cho `/api/kiotviet/*`
- **Token KiotViet:** cache 23 giờ, không gọi lại khi không cần thiết
- **Cache dữ liệu:** 5 phút, có thể xóa thủ công qua `POST /api/kiotviet/clear-cache`

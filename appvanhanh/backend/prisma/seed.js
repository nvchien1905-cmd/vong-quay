const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  const hash = (p) => bcrypt.hashSync(p, 10);

  // Zone & Store
  const zone = await prisma.zone.upsert({
    where: { id: 'zone-hn' },
    update: {},
    create: { id: 'zone-hn', name: 'Vùng Hà Nội' },
  });

  const store1 = await prisma.store.upsert({
    where: { id: 'store-01' },
    update: {},
    create: { id: 'store-01', name: 'Cửa hàng Cầu Giấy', address: '123 Cầu Giấy, Hà Nội', phone: '0901111111', zoneId: zone.id },
  });

  const store2 = await prisma.store.upsert({
    where: { id: 'store-02' },
    update: {},
    create: { id: 'store-02', name: 'Cửa hàng Đống Đa', address: '45 Xã Đàn, Đống Đa, HN', phone: '0902222222', zoneId: zone.id },
  });

  // Users
  const owner = await prisma.user.upsert({
    where: { email: 'owner@retail.vn' },
    update: {},
    create: { name: 'Chủ Hệ Thống', email: 'owner@retail.vn', password: hash('123456'), role: 'OWNER' },
  });

  const zoneMgr = await prisma.user.upsert({
    where: { email: 'zone@retail.vn' },
    update: {},
    create: { name: 'Quản Lý Vùng HN', email: 'zone@retail.vn', password: hash('123456'), role: 'ZONE_MANAGER', zoneId: zone.id },
  });

  const manager = await prisma.user.upsert({
    where: { email: 'manager@retail.vn' },
    update: {},
    create: { name: 'Cửa Hàng Trưởng', email: 'manager@retail.vn', password: hash('123456'), role: 'STORE_MANAGER', storeId: store1.id },
  });

  const emp1 = await prisma.user.upsert({
    where: { email: 'employee@retail.vn' },
    update: {},
    create: { name: 'Nguyễn Văn An', email: 'employee@retail.vn', password: hash('123456'), role: 'EMPLOYEE', storeId: store1.id },
  });

  const emp2 = await prisma.user.upsert({
    where: { email: 'employee2@retail.vn' },
    update: {},
    create: { name: 'Trần Thị Bích', email: 'employee2@retail.vn', password: hash('123456'), role: 'EMPLOYEE', storeId: store1.id },
  });

  const emp3 = await prisma.user.upsert({
    where: { email: 'employee3@retail.vn' },
    update: {},
    create: { name: 'Lê Minh Cường', email: 'employee3@retail.vn', password: hash('123456'), role: 'EMPLOYEE', storeId: store2.id },
  });

  // Tasks mẫu
  const now = new Date();
  const yesterday = new Date(now - 86400000);
  const tomorrow = new Date(now.getTime() + 86400000);
  const nextWeek = new Date(now.getTime() + 7 * 86400000);

  const tasks = [
    { title: 'Kiểm tra hàng tồn kho cuối tuần', description: 'Đếm và đối chiếu số lượng hàng tồn với hệ thống', status: 'COMPLETED', priority: 'HIGH', assigneeId: emp1.id, storeId: store1.id, completedAt: yesterday, deadline: yesterday },
    { title: 'Vệ sinh quầy hàng khu vực A', description: 'Lau kính, sắp xếp sản phẩm theo planogram', status: 'COMPLETED', priority: 'MEDIUM', assigneeId: emp2.id, storeId: store1.id, completedAt: yesterday, deadline: yesterday },
    { title: 'Cập nhật bảng giá tháng này', description: 'In và dán bảng giá mới theo chính sách công ty', status: 'IN_PROGRESS', priority: 'URGENT', assigneeId: emp1.id, storeId: store1.id, deadline: tomorrow },
    { title: 'Đào tạo nhân viên mới về SOP', description: 'Hướng dẫn quy trình mở ca, đóng ca cho nhân viên mới', status: 'NOT_STARTED', priority: 'HIGH', assigneeId: emp2.id, storeId: store1.id, deadline: nextWeek },
    { title: 'Báo cáo doanh thu tuần 3', description: 'Tổng hợp và gửi báo cáo doanh thu tuần lên quản lý vùng', status: 'PENDING_APPROVAL', priority: 'HIGH', assigneeId: manager.id, storeId: store1.id, deadline: yesterday },
    { title: 'Sửa máy lạnh khu vực kho', description: 'Liên hệ kỹ thuật xử lý máy lạnh kho bị rò rỉ gas', status: 'OVERDUE', priority: 'URGENT', assigneeId: emp1.id, storeId: store1.id, deadline: new Date(now - 2 * 86400000) },
    { title: 'Chụp ảnh trưng bày sản phẩm mới', description: 'Chụp ảnh khu trưng bày sản phẩm mùa hè và gửi cho marketing', status: 'REJECTED', priority: 'MEDIUM', assigneeId: emp2.id, storeId: store1.id, rejectedReason: 'Ảnh chụp không đủ sáng, cần chụp lại', rejectedAt: yesterday, deadline: yesterday },
    { title: 'Kiểm tra hàng tồn kho cửa hàng 2', status: 'IN_PROGRESS', priority: 'HIGH', assigneeId: emp3.id, storeId: store2.id, deadline: tomorrow },
    { title: 'Vệ sinh toàn bộ cửa hàng Đống Đa', status: 'NOT_STARTED', priority: 'MEDIUM', assigneeId: emp3.id, storeId: store2.id, deadline: nextWeek },
    { title: 'Kiểm tra hệ thống camera an ninh', status: 'OVERDUE', priority: 'URGENT', assigneeId: emp3.id, storeId: store2.id, deadline: new Date(now - 3 * 86400000) },
  ];

  for (const t of tasks) {
    await prisma.task.create({
      data: {
        ...t,
        creatorId: manager.id,
      },
    });
  }

  // KPI scores mẫu (tháng hiện tại)
  const month = now.getMonth() + 1;
  const year = now.getFullYear();

  const kpiData = [
    { userId: emp1.id, storeId: store1.id, score: 10, reason: 'Hoàn thành đúng deadline', month, year },
    { userId: emp1.id, storeId: store1.id, score: 10, reason: 'Hoàn thành đúng deadline', month, year },
    { userId: emp1.id, storeId: store1.id, score: -10, reason: 'Task quá hạn không báo cáo', month, year },
    { userId: emp2.id, storeId: store1.id, score: 10, reason: 'Hoàn thành đúng deadline', month, year },
    { userId: emp2.id, storeId: store1.id, score: -3, reason: 'Task bị từ chối', month, year },
    { userId: emp3.id, storeId: store2.id, score: -10, reason: 'Task quá hạn không báo cáo', month, year },
    { userId: manager.id, storeId: store1.id, score: 10, reason: 'Hoàn thành đúng deadline', month, year },
  ];

  for (const k of kpiData) {
    await prisma.kpiScore.create({ data: k });
  }

  // Checklist template mẫu
  const tmpl = await prisma.checklistTemplate.upsert({
    where: { id: 'tmpl-open-shift' },
    update: {},
    create: {
      id: 'tmpl-open-shift',
      name: 'Checklist Mở Ca',
      type: 'OPEN_SHIFT',
      storeId: store1.id,
      items: {
        create: [
          { label: 'Bật toàn bộ hệ thống điện và chiếu sáng', order: 1 },
          { label: 'Kiểm tra và vệ sinh quầy thu ngân', order: 2, requirePhoto: true },
          { label: 'Kiểm tra hàng trưng bày, bổ sung hàng thiếu', order: 3 },
          { label: 'Kiểm tra máy POS và máy in hóa đơn', order: 4 },
          { label: 'Ghi nhận số lượng tiền mặt đầu ca', order: 5, requirePhoto: true },
        ],
      },
    },
  });

  console.log('✅ Seed completed:');
  console.log('   - 2 zones, 2 stores');
  console.log('   - 6 users (owner, zone manager, store manager, 3 employees)');
  console.log('   - 10 tasks (various statuses)');
  console.log('   - 7 KPI scores');
  console.log('   - 1 checklist template');
  console.log('   Default password: 123456');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());

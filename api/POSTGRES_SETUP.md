# SalesHub — PostgreSQL trên Neon

## Cấu hình ngày 26/10/2026
- Neon project: SalesHub (`wild-mountain-49849449`), gói Free, Singapore, PostgreSQL 17.
- Database: `saleshub`; nhánh ứng dụng: `production` (`br-wandering-frost-azle4x6u`).
- Backend Render: `saleshub-qr-live-pilot` (`srv-dbf2jj8n74is73bata80`).
- `DATABASE_URL` lưu riêng trong môi trường Render, dùng kết nối pooled với TLS xác minh chứng chỉ. Không đưa chuỗi kết nối vào mã nguồn.
- `PILOT_MODE=false`. Thiếu database thì dừng khởi động, không tự quay về lưu RAM.
- Giữ nguyên `SESSION_SECRET` và `STAFF_PASSWORD` để bảo toàn QR bàn và phiên nhân viên.

## Khởi tạo và kiểm tra
- `api/schema.sql` quản lý 5 bảng và chỉ mục; khởi tạo trong transaction khi ứng dụng chạy.
- 6 bàn và 7 món chỉ được thêm khi bảng tương ứng chưa có dữ liệu.
- Health hợp lệ: `/api/health` trả `mode: postgres`, `database: ready`, `pilot: false`.
- Đặt đơn thử qua QR, kiểm tra bếp/bar, thay trạng thái, đối chiếu lịch sử và audit.
- Redeploy và xác minh đơn cùng trạng thái vẫn tồn tại.
- Nhánh `verify-postgres-20261026` dành riêng kiểm tra schema và chống gửi trùng, không dùng cho ứng dụng.

## Giới hạn
- Không lưu ảnh/PDF vào bảng đơn hàng. Theo dõi dung lượng, compute và băng thông trong Neon.
- Gói Free có hạn mức; chính sách có thể thay đổi, không phải cam kết miễn phí vĩnh viễn.
- Máy chủ Render Free có thể ngủ; lượt truy cập đầu tiên cần chờ khởi động.
- Các đơn RAM trước đó không tự được chuyển sang PostgreSQL.
- Cần bổ sung sao lưu định kỳ và kiểm tra phục hồi trước khi vận hành thương mại. Chưa có lịch sao lưu tự động.
- Đăng nhập nhân viên hiện dùng mật khẩu chung, chưa có phân quyền tài khoản riêng. Thanh toán trực tuyến chưa được tích hợp.

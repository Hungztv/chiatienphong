# TrọShare — Website Tính & Chia Tiền Phòng Trọ

Ứng dụng web gọn nhẹ giúp bạn và bạn cùng phòng quản lý toàn bộ chi tiêu hàng tháng, tính tiền phòng + điện nước theo công-tơ, tự động quyết toán ai trả cho ai, và copy tổng kết gửi qua Zalo/Messenger.

## Tính năng chính
- **Linh hoạt thành viên**: Mặc định 2 người, dễ dàng đổi tên, chọn màu, thêm/xóa thành viên.
- **Chi tiêu chung hằng ngày**: Thêm khoản chi (đi chợ, ăn uống, đồ dùng...), chia đều (có chọn người tham gia) hoặc chia tùy chỉnh số tiền từng người.
- **Tiền phòng & Điện nước hàng tháng**: Tính tiền điện theo chỉ số cũ/mới, tiền nước (khoán theo người hoặc theo đồng hồ m³), Wi-Fi, rác, gửi xe; có nút **Lấy từ tháng trước** tự đẩy chỉ số mới thành chỉ số cũ.
- **Quyết toán thông minh**: Tự động tối ưu số lần chuyển khoản ít nhất, ghi nhận "Đã trả" và xem lịch sử.
- **Thống kê & Biểu đồ**: Biểu đồ cơ cấu danh mục và biểu đồ so sánh số tiền đã ứng vs phần phải chịu.
- **Copy tổng kết Zalo & Chia sẻ link đồng bộ**: Xuất bản tổng kết đẹp mắt để dán vào Zalo, hoặc tạo link chia sẻ để gửi toàn bộ dữ liệu cho bạn cùng phòng mở xem ngay không cần server.

## Cách đẩy lên Vercel

### Cách 1: Dùng Vercel CLI (nhanh nhất)
Mở terminal tại thư mục dự án và chạy:
```bash
npx vercel --prod
```
Đăng nhập tài khoản Vercel (nếu lần đầu) và nhấn Enter theo các bước mặc định.

### Cách 2: Qua GitHub + Vercel Dashboard
1. Đẩy thư mục này lên một repository trên GitHub.
2. Vào [vercel.com/new](https://vercel.com/new), chọn repo vừa tạo.
3. Giữ nguyên cấu hình mặc định (Framework Preset: **Other**, Build Command: để trống, Output Directory: `.`) và bấm **Deploy**.

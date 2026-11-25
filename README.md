# Web Lê Ngọc Mai (lengocmai.com)

Trang showcase hàng sale của 3 brand: Lioness, I.AM.GIA, Alo Yoga. Khách bấm "Liên hệ" để nhắn Zalo/Messenger, không có giỏ hàng.

## Cấu trúc
- `public/` là toàn bộ trang web (Cloudflare Pages đăng thư mục này).
  - `index.html`: giao diện. Phần `CONFIG` ở đầu script là chỗ chỉnh Zalo, Messenger, ngày kết thúc sale.
  - `data/products.json`: dữ liệu sản phẩm, do chương trình đồng bộ tạo ra.
- `scripts/sync.mjs`: chương trình đồng bộ. Nó lấy mọi mẫu còn hàng của 3 web brand, tỉ giá bán Vietcombank, rồi tính giá:
  - Lioness, I.AM.GIA: giá AUD × tỉ giá bán VCB × 1.07 + 550.000đ, làm tròn lên bội số 50.000đ.
  - Alo Yoga: giá VND + 550.000đ, làm tròn lên bội số 50.000đ.
  - % sale hiện ở ô brand chỉnh tay trong `CFG.brandSale` (đầu file).
- `.github/workflows/sync.yml`: GitHub tự chạy đồng bộ mỗi tiếng một lần và để dữ liệu mới nhất ở nhánh `data` của repo. Web đọc thẳng file đó nên không cần Cloudflare build lại (Cloudflare miễn phí chỉ cho 500 lần build/tháng).

## Đưa web lên (làm một lần)
1. Tạo tài khoản GitHub, bấm **New repository**, đặt tên `lengocmai-site`, chọn **Public** (bắt buộc: web đọc dữ liệu từ repo, và repo công khai thì GitHub Actions chạy miễn phí không giới hạn phút. Repo không chứa mật khẩu hay thông tin riêng).
2. Kéo thả toàn bộ thư mục này lên repo (Add file > Upload files).
   GitHub thường bỏ qua thư mục ẩn `.github`, nên kiểm tra lại: nếu thiếu, bấm Add file > Create new file, gõ tên `.github/workflows/sync.yml`, dán nội dung file đó vào rồi Commit.
3. Mở `public/index.html` trên GitHub (bấm biểu tượng bút chì), sửa dòng `githubRepo:""` thành `githubRepo:"<tên-github-của-anh>/lengocmai-site"`, rồi Commit.
4. Vào tab **Actions** của repo, chọn "Dong bo san pham", bấm **Run workflow** để lấy dữ liệu lần đầu (mất vài phút). Từ đó GitHub tự chạy mỗi tiếng. Lưu ý: GitHub có thể chạy trễ vài phút lúc đông, và nếu repo 60 ngày không ai sửa gì, GitHub sẽ gửi email báo tạm dừng lịch chạy; bấm nút trong email hoặc tab Actions để bật lại.
5. Vào Cloudflare > **Workers & Pages** > Create > Pages > **Connect to Git**, chọn repo này.
   - Framework preset: None. Build command: để trống. Build output directory: `public`.
6. Sau khi chạy được ở địa chỉ `*.pages.dev`, vào Custom domains để gắn `lengocmai.com` (Cloudflare hướng dẫn đổi nameserver ở Namecheap).

## Ẩn hoặc ghim mẫu (tuỳ chọn)
Tạo Google Sheet có 2 cột `handle | thao_tac`. `handle` là phần sau `#sp-` trong link mẫu, `thao_tac` ghi `an` (ẩn) hoặc `ghim` (đưa lên đầu).
File > Chia sẻ > Xuất bản lên web > dạng CSV, copy link.
Trong repo: Settings > Secrets and variables > Actions > tab Variables, tạo biến `OVERRIDES_CSV` bằng link đó. Thay đổi có hiệu lực ở lần đồng bộ sau.

## Chạy tay trên máy
Cần Node.js 18 trở lên. Mở thư mục này trong terminal, chạy `node scripts/sync.mjs`.

## Xem thử trên máy (Windows)
Bấm đúp `xem-thu.bat` (cần Node.js). Trình duyệt mở http://localhost:8080 với dữ liệu thật và ảnh thật.

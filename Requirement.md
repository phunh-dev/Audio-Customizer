Bạn lên plan giúp tôi 1 tool thực hiện chức năng cho việc tùy chỉnh asset Audio.

Các tính năng:
- cắt, ghép, trộn lẫn âm thanh
- chỉnh sửa âm lượng, độ thăng/trầm, nhanh/chậm của âm thanh
- hỗ trợ ghép nối đầu - đuôi với nhau để tạo thành âm thanh loop được
- khử nhiễu
- thêm các kiểu pass khác nhau, equalizer cơ bản (16 channels)
- tối ưu kích thước âm thanh
- tối ưu sample rate
- nghe thử được output sau khi chỉnh sửa
- có timeline bar seek được, có 2 nút nhảy frame/step theo các đơn vị thời gian, nhảy trước và sau. Có button play/pause. Timeline seek đến đâu thì phát tiếp âm thanh đến đấy

Yêu cầu:
- đây là 1 app desktop, hoạt động local trên Windows, macOS và Linus, không phải là web, không cần server 
- các định dạng hỗ trợ: .mp3, .wav, .aiff / .aif, .ogg, .flac
- hoạt động dựa trên tab, sleep tab nếu không hoạt động, chỉ tập trung tab hiện tại, mỗi tab là 1 lượt làm việc
- có view hiển thị dải tần chính của cả bài nhạc từ đầu đến cuối, dải tần được update theo kết quả đầu cuối, chỉnh thế nào kết quả thế nấy
- cho phép trộn 1 hoặc nhiều âm thanh, có thể kéo trượt âm thanh trên dòng dải tần
- kéo thả 1 hoặc nhiều file, hoặc cả folder, hoặc là mở ô chọn file từ file explorer. Các file âm thanh scroll được theo chiều dọc nếu có nhiều âm thanh trong placeholder đấy. Có button X để xóa track khi cần thiết
- không được tự ý save file, có button export, hỏi vị trí save trước rồi mới được save
- UI/UI đẹp, trực quan, dễ hiểu
- có localization, 2 ngôn ngữ chính là English và Tiếng Việt. Gọi text theo ID, các file ngôn ngữ viết riêng để tôi dễ dàng hiệu đính về sau
- có tính năng Undo/Redo để tránh bị xóa nhầm
- các tính năng phải có đầy đủ thông số cần thiết

Bạn hãy tư vấn tech-stack + ngôn ngữ lập trình cho tôi. Sau đó tạo ra file git ignore tương ứng với bộ tech-stack đấy
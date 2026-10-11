# Audio Customizer

Ứng dụng desktop **chạy hoàn toàn offline** trên Windows, macOS và Linux để chỉnh sửa và tối ưu asset âm thanh (đặc biệt cho game): cắt, ghép, trộn, chỉnh âm lượng / cao độ / tốc độ, tạo loop liền mạch, khử nhiễu, lọc + EQ 16 băng, tối ưu dung lượng và sample rate, nghe thử chính xác kết quả cuối cùng trước khi xuất file.

> English summary: [see below](#english).

![icon](build/icons/128x128.png)

---

## Tính năng

| Nhóm | Chi tiết |
|---|---|
| Nhập file | Kéo thả 1/nhiều file hoặc cả thư mục (quét đệ quy), nút **Open files / Open folder**. Định dạng: `.wav`, `.aiff`/`.aif`, `.flac`, `.mp3`, `.ogg`. Danh sách track cuộn dọc, có nút **X** để xoá (undo được). |
| Cắt / ghép / trộn | Trim, split tại playhead, xoá vùng chọn (ripple), kéo trượt clip trên dải tần, ghép nối (gap / crossfade + curve), gain, pan, mute / solo cho từng track. |
| Âm lượng | Gain −60…+24 dB, normalize Peak (dBFS) hoặc Loudness (LUFS, EBU R128), limiter (ceiling, release). |
| Cao độ & tốc độ | Semitone ±24, cent ±100, tempo 25–400 %, chế độ giữ cao độ (stretch) hoặc varispeed. |
| Loop | Vùng loop, crossfade đầu–đuôi (ms) + curve, snap zero-crossing, cân bằng loudness. |
| Khử nhiễu | Spectral gate hoặc RNNoise; reduction, sensitivity, smoothing, attack / release, học noise profile từ vùng chọn. |
| Filter & EQ | HPF / LPF / BPF / Notch / Low & High shelf (cutoff, Q, slope 12/24/48 dB/oct, gain); EQ 16 băng (25 Hz…20 kHz, ±18 dB, Q từng băng, preset). |
| Tối ưu | Định dạng, sample rate (8 k…96 k), mono / stereo, bit depth, CBR / VBR, trim silence, **ước tính dung lượng chính xác** trước khi xuất. |
| Nghe thử & timeline | Play / Pause / Stop / Loop, timeline seek được (seek tới đâu phát tiếp tới đó), 2 nút step ◀ / ▶ theo đơn vị (1 sample, 1 / 10 / 100 ms, 1 s, frame @24/30/60 fps). Spectrogram + waveform luôn hiển thị **kết quả cuối cùng**. |
| Tab | Mỗi tab là một phiên làm việc riêng (undo/redo riêng); tab không hoạt động sẽ "ngủ" để giải phóng bộ nhớ. |
| Xuất file | Không bao giờ tự lưu: nút **Export** → chọn thông số → hộp thoại hỏi vị trí lưu → mới ghi file. |
| Khác | Undo / Redo (Ctrl+Z / Ctrl+Y, ⌘ trên macOS), giao diện sáng / tối (thanh tiêu đề native đổi màu theo), đa ngôn ngữ **English / Tiếng Việt**. |

## Tech stack

- **UI**: Electron 44 + React 19 + TypeScript, Tailwind CSS 4, Radix UI, lucide-react, Zustand + immer (undo/redo), i18next.
- **Audio engine**: Rust (crate `audio-core`) — symphonia (decode), rubato (resample), rustfft, cpal (phát âm thanh), các encoder WAV / AIFF / FLAC / MP3 / OGG Vorbis — đóng gói thành native addon Node-API bằng **napi-rs** (crate `audio-napi` → `native/audio_napi.node`).
- **Build**: electron-vite (bundle), electron-builder (NSIS `.exe`, `.dmg`, AppImage + `.deb`).
- **Test**: `cargo test`, Vitest (+ Testing Library), Playwright cho Electron (E2E), GitHub Actions (Windows / macOS / Linux).

## Yêu cầu

| | Windows | macOS | Linux |
|---|---|---|---|
| Node.js | 24.x (kèm npm) | 24.x | 24.x |
| Rust | stable (toolchain **MSVC**) | stable | stable |
| Công cụ build C/C++ | Visual Studio Build Tools (workload "Desktop development with C++") | Xcode Command Line Tools (`xcode-select --install`) | `build-essential`, `pkg-config`, **`libasound2-dev`** (ALSA cho cpal) |

Linux (Debian/Ubuntu): `sudo apt-get install -y build-essential pkg-config libasound2-dev` (thêm `xvfb` nếu chạy E2E trên máy không có màn hình).

## Cài đặt

```bash
npm ci
# npm có thể bỏ qua script cài đặt của electron (allowScripts). Nếu `npx electron --version` báo lỗi
# thì tải binary Electron thủ công:
node node_modules/electron/install.js
# build engine Rust -> native/audio_napi.node
npm run build:native
```

> Trong terminal của VS Code, biến môi trường `ELECTRON_RUN_AS_NODE=1` có thể được đặt sẵn khiến Electron chạy như Node thuần. Hãy `unset ELECTRON_RUN_AS_NODE` (PowerShell: `Remove-Item Env:ELECTRON_RUN_AS_NODE`) trước khi chạy `npm run dev` / `npm run icons`. (`npm run test:e2e` tự xử lý việc này.)

## Lệnh thường dùng

| Lệnh | Tác dụng |
|---|---|
| `npm run dev` | Chạy app ở chế độ phát triển (HMR cho renderer). |
| `npm run build` | Bundle main / preload / renderer vào `out/`. |
| `npm run build:native` | Build addon Rust (release) và chép vào `native/audio_napi.node` (`-- --debug` cho bản debug). |
| `cargo test --workspace` | Unit + integration test của engine Rust. |
| `npm test` | Vitest (main, preload, shared, renderer) + kiểm tra khóa i18n. |
| `npm run coverage` | Vitest kèm coverage (ngưỡng 80 %). |
| `npm run typecheck` | Kiểm tra kiểu TypeScript (main, preload, renderer, e2e). |
| `npm run test:e2e` | E2E Playwright với app Electron thật: build addon nếu thiếu, sinh fixture nếu thiếu, `electron-vite build`, rồi chạy `e2e/**`. Tham số thêm được chuyển cho Playwright, ví dụ `npm run test:e2e -- -g export`. |
| `npm run test:e2e:packaged` | Chạy cùng bộ E2E với app đã đóng gói trong `release/*-unpacked` (sau `npm run dist`). |
| `npm run fixtures` | Sinh lại file âm thanh mẫu trong `tests/fixtures/` (`-- --force` để ghi đè). |
| `npm run icons` | Sinh lại icon từ `build/icon.svg` (`build/icon.png`, `build/icon.ico`, `build/icons/*.png`). |
| `npm run dist` | Đóng gói cho hệ điều hành hiện tại vào `release/`. |
| `npm run dist:win` / `dist:mac` / `dist:linux` | NSIS `.exe` (x64) / `.dmg` (kiến trúc của máy build) / AppImage + `.deb`. Mỗi nền tảng phải build trên chính nền tảng đó (addon native). |

### Ghi chú về E2E

- Dialog mở / lưu file native được thay thế trong main process (`dialog.showOpenDialog` / `showSaveDialog`) từ test; mọi thứ còn lại đi qua đường thật UI → preload → IPC → engine Rust.
- Biến môi trường `AUDIO_CUSTOMIZER_E2E_SAVE_PATH` (chỉ dùng cho test) khiến Export ghi thẳng vào đường dẫn đó thay vì hiện hộp thoại lưu.
- Nếu máy không có thiết bị âm thanh (CI), các khẳng định về phát nhạc được bỏ qua có ghi log khi engine trả về `ERR_NO_AUDIO_DEVICE`.
- Test chạy app với `--user-data-dir` tạm riêng, không đụng vào dữ liệu thật.

### Đóng gói & icon

- Addon `audio_napi.node` **không nằm trong `app.asar`** (file `.node` không load được từ archive): electron-builder chép nó vào `resources/native/` qua `extraResources`; main process tìm nó ở `process.resourcesPath/native` khi đã đóng gói và ở `<repo>/native` khi phát triển.
- Icon ứng dụng (sóng âm, không phải icon mặc định của Electron) nằm ở `build/`: `icon.ico` cho file `.exe` + trình cài đặt NSIS, `icon.png` cho macOS, `build/icons/` cho Linux; `build/icons/256x256.png` cũng được dùng làm icon cửa sổ / taskbar (chép vào `resources/icons/`).
- Bản macOS chưa ký số: để phát hành ra ngoài cần Apple Developer ID (sign + notarize).

## Cấu trúc dự án

```
Audio-Customizer/
├─ crates/
│  ├─ audio-core/          # Rust thuần: decode, dsp/ (fade, gain, biquad, filter, eq, stretch,
│  │                       #   denoise, loop_builder, silence, resample), project, chain, mix,
│  │                       #   render, analysis (STFT, peaks, LUFS), encode, playback, engine
│  └─ audio-napi/          # binding napi-rs (index.d.ts = API của addon)
├─ src/
│  ├─ main/                # Electron main: cửa sổ, dialog, IPC handlers, export flow, transport pump
│  ├─ preload/             # contextBridge -> window.api (AudioApi), đồng bộ theme thanh tiêu đề
│  ├─ shared/              # kiểu dùng chung main/renderer (types.ts = Project JSON, api.ts = AudioApi)
│  └─ renderer/            # React UI
│     ├─ components/       # shell (title bar, tabs, toolbar), tracks, editor (timeline, spectrogram), transport, ui kit
│     ├─ features/         # effects (Volume, Pitch/Tempo, Filters, EQ, Denoise, Loop, Optimize), export
│     ├─ store/            # Zustand store: tabs, project, history (undo/redo), engine binding
│     ├─ locales/<lang>/   # file ngôn ngữ (en, vi)
│     └─ i18n/             # khởi tạo i18next + test parity
├─ e2e/                    # Playwright E2E (Electron)
├─ tests/fixtures/         # âm thanh mẫu < 1 s cho 5 định dạng (scripts/make-fixtures.mjs)
├─ scripts/                # build-native, ensure-native, make-fixtures, make-icon, e2e runner
├─ build/                  # icon + tài nguyên đóng gói
├─ native/                 # audio_napi.node (sinh ra, không commit)
├─ docs/CONTRACTS.md       # hợp đồng giao tiếp (Project JSON, DSP API, IPC API)
├─ electron-builder.yml, electron.vite.config.ts, playwright.config.ts, vitest.config.ts
└─ .github/workflows/ci.yml
```

## Đa ngôn ngữ (localization)

- Mọi chuỗi hiển thị được gọi theo ID: `t('app.tabs.new')`, không viết cứng text trong component.
- File ngôn ngữ: `src/renderer/locales/<ngôn ngữ>/<nhóm>.json`, ví dụ `locales/vi/export.json`. Tên file là nhóm khóa: `locales/en/app.json` chứa `{ "tabs": { "new": "New tab" } }` → khóa `app.tabs.new`.
- **Hiệu đính bản dịch**: chỉ cần sửa giá trị trong `locales/vi/*.json` (hoặc `en`), giữ nguyên khóa và các biến `{{...}}`.
- **Thêm khóa mới**: thêm cùng khóa vào **tất cả** ngôn ngữ (`en` và `vi`), rồi dùng `t('nhom.khoa')` trong code.
- **Kiểm tra parity**: `npm run test:i18n` (cũng chạy trong `npm test`) đảm bảo mọi ngôn ngữ có cùng bộ file và bộ khóa, không có giá trị rỗng, có đủ thông báo cho mọi mã lỗi `errors.ERR_*`.
- **Thêm ngôn ngữ mới**: tạo thư mục `locales/<mã>/` với đủ các file của `en`, thêm mã vào `LANGUAGES` trong `src/renderer/i18n/index.ts` (và kiểu `Language` của store, nút chuyển ngôn ngữ), cập nhật danh sách ngôn ngữ mong đợi trong `src/renderer/i18n/i18n.test.ts`.

## Kiến trúc

```
Renderer (React)  ──window.api (preload, contextBridge)──>  Electron main (TS)  ──Node-API──>  Rust audio-core
  UI, store, undo/redo, i18n,                                dialog mở/lưu, IPC handlers,        decode, DSP, mix, render,
  vẽ canvas (spectrogram, waveform)                          export flow, đẩy trạng thái phát    phân tích, encode, phát (cpal)
```

- **Không phá huỷ**: mỗi tab giữ một *Project JSON* (tracks → clip → chuỗi hiệu ứng). File gốc không bao giờ bị sửa.
- **Render**: `source → resample → clip → denoise → pitch/tempo → filters → EQ → volume → fades → gain/pan → mix → master effects → loop → trim silence`. Kết quả render vừa là dữ liệu cho spectrogram / waveform vừa là buffer phát → "chỉnh thế nào nghe thế nấy". Có thể áp dụng thông số export vào bản nghe thử.
- **Phát & seek**: transport trong Rust giữ con trỏ phát; seek khi đang phát dùng micro-fade ~5 ms để không có tiếng click; trạng thái được đẩy về UI ~30 Hz.
- **Lỗi**: engine trả về mã lỗi `ERR_*`, UI dịch qua khóa `errors.ERR_*`.
- Chi tiết hợp đồng giữa các phần: [docs/CONTRACTS.md](docs/CONTRACTS.md).

---

## English

**Audio Customizer** is an offline desktop audio asset editor for Windows, macOS and Linux (Electron + React UI, Rust audio engine via napi-rs). It cuts, joins and mixes tracks; adjusts volume (gain, peak/LUFS normalize, limiter), pitch and tempo; builds seamless loops; removes noise; applies pass filters and a 16-band EQ; optimizes size and sample rate with exact size estimates; and previews the exact final result (spectrogram + waveform of the master output, seekable timeline, step buttons, play/pause). Files: `.wav .aiff/.aif .flac .mp3 .ogg`. Tab-based sessions (inactive tabs sleep), undo/redo, English / Vietnamese UI, never saves without asking for a location.

**Requirements**: Node 24, Rust stable (MSVC on Windows), Visual Studio Build Tools / Xcode CLT / `build-essential` + `libasound2-dev` on Linux.

**Setup**: `npm ci` → `node node_modules/electron/install.js` (if npm skipped Electron's install script) → `npm run build:native`.

**Commands**: `npm run dev` · `cargo test --workspace` · `npm test` · `npm run typecheck` · `npm run test:e2e` (Playwright against the real Electron app) · `npm run dist` / `dist:win` / `dist:mac` / `dist:linux` (installers in `release/`) · `npm run test:e2e:packaged` (E2E against the packaged app) · `npm run icons` · `npm run fixtures`.

**Localization**: strings live in `src/renderer/locales/<lang>/<group>.json` and are referenced by ID (`t('group.key')`); keep the same keys in every language — `npm run test:i18n` enforces parity.

**Packaging notes**: the native addon ships in `resources/native/` (outside `app.asar`); the custom app icon comes from `build/` (`icon.ico`, `icon.png`, `icons/`).

Architecture and interface contracts: [docs/CONTRACTS.md](docs/CONTRACTS.md).
